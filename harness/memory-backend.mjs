// Reference implementation of the HAX backend platform contract (spec/13), in memory.
// It loads plugin folders (tiers, validation, deployment config, dependencies, conflicts, requirements),
// enforces route security from each plugin's OpenAPI document, dispatches hooks (priority, cascade, entity
// inheritance, aliases, config scope, veto, timeouts, discard on error or invalid return, overwrite warnings),
// runs the render pipeline and transactions, and builds the ctx object. Plugin code runs in Node directly, or in
// PHP through harness/php/bridge.php, so the same cases can run against both runtimes.
// It is a test double for plugins and for the spec, not a server: no HTTP, no disk writes, no network.
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const readAny = (p) => (p.endsWith(".json") ? JSON.parse(readFileSync(p, "utf8")) : parse(readFileSync(p, "utf8")));
const CORE_HOOKS = JSON.parse(readFileSync(join(root, "schema/hook-contracts.json"), "utf8"));
const SPEC_VERSION = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const USER_TOKEN_REQUIRED = "X-HAXCMS-User-Token header is required for this endpoint";
const TIERS = { "haxiam-core": 1, "haxiam-contrib": 2, "system-core": 3, "system-contrib": 4, site: 5 };
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateManifest = ajv.compile(JSON.parse(readFileSync(join(root, "schema/plugin.schema.json"), "utf8")));

const studly = (id) => id.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join("") + "Plugin";
const camelHook = (name) => name.split(".").map((p, i) => (i ? p[0].toUpperCase() + p.slice(1) : p)).join("");
const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const cmpVersion = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1; } return 0; };
const LIMITED_USER = ["id", "name", "displayName", "roles", "avatar"];
async function withTimeout(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms); })]); }
  finally { clearTimeout(timer); }
}

export class MemoryBackend {
  constructor({ haxcmsVersion = "26.10.1", runtime = "nodejs", site = { id: "00000000-0000-4000-8000-000000000001", name: "test-site", path: "/sites/test-site" }, user = { id: "u1", name: "admin", displayName: "Admin", roles: ["admin"], avatar: null, email: "admin@example.invalid", passwordHash: "never-exposed" }, hookTimeout = 5000 } = {}) {
    this.haxcms = { version: haxcmsVersion, runtime };
    this.runtime = runtime;
    this.site = site;
    this.user = user;
    this.hookTimeout = hookTimeout;
    this.plugins = []; // in cascade order
    this.memory = new Map(); // store contents by key
    this.installed = new Set(); // "<plugin>:<scope>" that ran install
    this.entityParents = {}; // entity type -> parent type
    this.log = [];
    // core records plugins reach through ctx.entities: the site's site.json, pages, files
    this.records = { site: { [site.id]: { id: site.id, title: site.name, metadata: { plugins: {} }, items: [] } }, page: {}, file: {} };
  }

  seed(records = {}) {
    if (records.site) this.records.site[this.site.id] = { id: this.site.id, metadata: { plugins: {} }, items: [], ...structuredClone(records.site) };
    for (const type of Object.keys(records)) if (type !== "site") for (const r of records[type]) { this.records[type] = this.records[type] || {}; this.records[type][r.id || r.uuid] = structuredClone(r); }
  }

  // ---- loading (spec/13 section 2) ----
  // dirs: paths, or { path, tier } objects. options: settings, stores (by plugin id), disabled, blocked, required.
  async load(dirs, { settings = {}, stores = {}, disabled = [], blocked = [], required = [], records } = {}) {
    if (records) this.seed(records);
    const found = [];
    for (const d of dirs) {
      const spec = typeof d === "string" ? { path: d, tier: "system-core" } : d;
      const dir = resolve(spec.path);
      let m;
      try { m = readAny(join(dir, "plugin.yaml")); } catch (e) { this.log.push({ level: "error", plugin: spec.path, message: `cannot read plugin.yaml: ${e.message}` }); continue; }
      found.push({ id: m && m.id, dir, manifest: m || {}, tier: spec.tier || "system-core", ops: {}, stores: {}, hookDefs: {}, entities: {}, settings: {}, entry: null, status: "enabled", reason: null, unmet: [] });
    }
    // higher tier wins a name collision
    found.sort((a, b) => TIERS[a.tier] - TIERS[b.tier]);
    const byId = new Map();
    for (const p of found) {
      if (byId.has(p.id)) this.log.push({ level: "warn", plugin: p.id, message: `${p.tier} copy (${p.manifest.version}) overrides ${byId.get(p.id).tier} copy (${byId.get(p.id).manifest.version})` });
      byId.set(p.id, p);
    }
    for (const p of byId.values()) {
      const m = p.manifest;
      const refuse = (reason) => { p.status = "refused"; p.reason = reason; this.log.push({ level: "error", plugin: p.id, message: reason }); };
      if (!validateManifest(m)) { refuse(`invalid manifest: ${validateManifest.errors.map((e) => `${e.instancePath || "/"} ${e.message}${e.params && e.params.additionalProperty ? ` (${e.params.additionalProperty})` : ""}`).join("; ")}`); }
      else if (cmpVersion(m.specVersion, SPEC_VERSION) > 0) refuse(`specVersion ${m.specVersion} is newer than this backend supports (${SPEC_VERSION})`);
      else if (blocked.includes(p.id)) refuse("blocked by deployment config");
      else if (disabled.includes(p.id) && !m.required && !required.includes(p.id)) { p.status = "disabled"; p.reason = "disabled"; }
      if (p.status === "refused") { this.plugins.push(p); continue; }
      if (m.openapi) {
        const api = readAny(join(p.dir, m.openapi));
        for (const [path, verbs] of Object.entries(api.paths || {})) for (const [verb, op] of Object.entries(verbs)) {
          if (!op || !op.operationId) continue;
          p.ops[op.operationId] = { path, verb, scope: op["x-hax-scope"] || api["x-hax-scope"] || "site", public: op["x-hax-public"] === true, security: op.security || api.security || [] };
        }
      }
      if (m.datastores) for (const s of readAny(join(p.dir, m.datastores)).stores) p.stores[s.id] = s;
      if (m.entities) { const e = readAny(join(p.dir, m.entities)); p.entities = e.entities || {}; for (const [name, def] of Object.entries(p.entities)) if (def.extends) this.entityParents[name] = def.extends; }
      if (m.hookDefinitions) for (const h of readAny(join(p.dir, m.hookDefinitions))) p.hookDefs[h.name] = h;
      if (m.settings && existsSync(join(p.dir, m.settings))) for (const f of readAny(join(p.dir, m.settings)).configure || []) if (f.value !== undefined) p.settings[f.property] = f.value;
      Object.assign(p.settings, settings[p.id] || {});
      p.storeOverrides = { ...(stores[p.id] || {}) };
      if (m.kind !== "pack" && this.runtime === "nodejs" && m.entry && m.entry.nodejs) {
        try { const mod = await import(pathToFileURL(join(p.dir, m.entry.nodejs)).href); p.entry = mod.default || mod; }
        catch (e) { p.status = "failed"; p.reason = `entry failed to load: ${e.message}`; this.log.push({ level: "error", plugin: p.id, message: p.reason }); }
      }
      this.plugins.push(p);
    }
    // dependencies: a missing or unusable dependency keeps the plugin disabled
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of this.plugins) {
        if (p.status !== "enabled") continue;
        for (const dep of p.manifest.dependencies || []) {
          const d = this.get(dep.split("@")[0]);
          if (!d || d.status !== "enabled") { p.status = "disabled"; p.reason = `missing dependency ${dep}`; this.log.push({ level: "warn", plugin: p.id, message: p.reason }); changed = true; break; }
        }
      }
    }
    for (const p of this.plugins) if (p.status === "enabled") for (const c of p.manifest.conflicts || []) if (this.get(c) && this.get(c).status === "enabled") this.log.push({ level: "warn", plugin: p.id, message: `conflicts with ${c}; both are enabled` });
    // cascade order: dependencies before dependents, then required, then tier, then id
    const depth = (p, seen = new Set()) => (seen.has(p.id) ? 0 : 1 + Math.max(0, ...(p.manifest.dependencies || []).map((d) => this.get(d.split("@")[0])).filter(Boolean).map((d) => depth(d, new Set([...seen, p.id])))));
    this.plugins.sort((a, b) => depth(a) - depth(b) || (a.manifest.required ? 0 : 1) - (b.manifest.required ? 0 : 1) || TIERS[a.tier] - TIERS[b.tier] || a.id.localeCompare(b.id));
    for (const p of this.plugins) if (p.status === "enabled") await this.refreshStatus(p);
    return this;
  }

  get(id) { return this.plugins.find((x) => x.id === id); }
  status() { return this.plugins.map((p) => ({ id: p.id, status: p.status, reason: p.reason, unmet: p.unmet })); }
  active(id) { const p = this.get(id); return !!p && p.status === "active"; }
  hookContract(name) { return CORE_HOOKS.find((c) => c.name === name) || this.plugins.map((p) => p.hookDefs[name]).find(Boolean); }

  async refreshStatus(p) {
    const before = await this.fire("plugin.before.requirements", [], { only: p.id, includeInactive: true });
    p.unmet = before.subject || [];
    const prev = p.status;
    p.status = p.unmet.length ? "inactive" : "active";
    await this.fire("plugin.after.requirements", { id: p.id, scope: "system", status: p.status, unmet: p.unmet }, { only: p.id, includeInactive: true, previous: prev });
  }

  // ---- enable / disable (spec/03) ----
  async enable(id) {
    const p = this.get(id);
    if (!p) return { status: 404, body: { error: "not installed" } };
    if (p.status === "refused") return { status: 409, body: { error: p.reason } };
    const subject = { id, version: p.manifest.version, scope: "system" };
    const wasStatus = p.status;
    p.status = "active"; // hooks of the plugin itself run during its own enable
    try {
      const first = !this.installed.has(`${id}:system`);
      for (const name of [...(first ? ["plugin.before.install"] : []), "plugin.before.enable"]) {
        const r = await this.fire(name, subject, { strict: true });
        if (r.veto) throw new Error(r.veto.message);
      }
      if (first) { this.installed.add(`${id}:system`); await this.fire("plugin.after.install", subject, { strict: true }); }
      await this.fire("plugin.after.enable", subject, { strict: true });
      await this.refreshStatus(p);
      return { status: 200, body: { id, status: p.status } };
    } catch (e) {
      p.status = "failed"; p.reason = e.message;
      this.log.push({ level: "error", plugin: id, message: `enable failed: ${e.message}` });
      return { status: 409, body: { error: e.message, status: "failed", previous: wasStatus } };
    }
  }

  async disable(id) {
    const p = this.get(id);
    if (!p) return { status: 404, body: { error: "not installed" } };
    if (p.manifest.required) return { status: 409, body: { error: "required plugins cannot be disabled" } };
    const dependents = this.plugins.filter((x) => (x.status === "active" || x.status === "inactive") && (x.manifest.dependencies || []).some((d) => d.split("@")[0] === id)).map((x) => x.id);
    if (dependents.length) return { status: 409, body: { error: "other plugins depend on it", dependents } };
    const subject = { id, version: p.manifest.version, scope: "system" };
    const r = await this.fire("plugin.before.disable", subject);
    if (r.veto) return { status: 409, body: { error: r.veto.message } };
    await this.fire("plugin.after.disable", subject);
    p.status = "disabled"; p.reason = "disabled";
    return { status: 200, body: { id, status: "disabled" } };
  }

  // ---- settings (spec/13 section 7) ----
  async saveConfig(id, values) {
    const p = this.get(id);
    const subject = { plugin: id, scope: "system", values: { ...p.settings, ...values } };
    const before = await this.fire("config.before.save", subject, { previous: { ...p.settings }, configOf: id });
    if (before.veto) return { status: 409, body: { error: before.veto.message } };
    const prev = { ...p.settings };
    p.settings = { ...before.subject.values };
    await this.fire("config.after.save", { ...before.subject }, { previous: prev, configOf: id });
    if (p.status === "active" || p.status === "inactive") await this.refreshStatus(p);
    return { status: 200, body: { status: p.status } };
  }

  // ---- stores ----
  storeKey(p, id) {
    const s = p.stores[id];
    if (!s) throw new Error(`${p.id}: unknown store "${id}"`);
    return `${p.id}:${s.scope}:${["site", "siteData", "manifest"].includes(s.scope) ? this.site.id : "-"}:${id}`;
  }
  readStore(p, id) {
    const s = p.stores[id];
    if (!s) throw new Error(`${p.id}: unknown store "${id}"`);
    if (p.storeOverrides && id in p.storeOverrides) return structuredClone(p.storeOverrides[id]);
    if (s.scope === "package") return readAny(join(p.dir, "data", s.file));
    if (s.scope === "manifest") { const v = getPath(this.records.site[this.site.id], `metadata.plugins.${p.id}.${id}`); return v === undefined ? null : structuredClone(v); }
    const v = this.memory.get(this.storeKey(p, id));
    return v === undefined ? null : structuredClone(v);
  }
  writeStore(p, id, value) {
    if (p.stores[id] && p.stores[id].scope === "package") throw new Error(`${p.id}: store "${id}" is read-only (package scope)`);
    if (p.storeOverrides) delete p.storeOverrides[id];
    if (p.stores[id] && p.stores[id].scope === "manifest") { const site = this.records.site[this.site.id]; site.metadata = site.metadata || {}; site.metadata.plugins = site.metadata.plugins || {}; site.metadata.plugins[p.id] = { ...(site.metadata.plugins[p.id] || {}), [id]: structuredClone(value) }; return; }
    this.memory.set(this.storeKey(p, id), structuredClone(value));
  }

  // ---- ctx (spec/13 section 4) ----
  userFor(p) {
    if (!this.user) return null;
    const full = (p.manifest.capabilities || []).includes("users:full");
    const out = {};
    for (const [k, v] of Object.entries(this.user)) if (k !== "passwordHash" && k !== "tokens" && (full || LIMITED_USER.includes(k))) out[k] = v;
    return out;
  }

  makeCtx(p, extras = {}) {
    const backend = this;
    const warnings = [];
    const tx = extras.transaction || backend.currentTx || { id: `t${Date.now()}`, origin: "implicit", bulk: false, operations: [], marks: {} };
    const ctx = {
      subject: extras.subject,
      previous: extras.previous,
      request: extras.request,
      veto: (message, status = 409) => ({ __veto: true, message, status }),
      warn: (message, severity = "warning") => { warnings.push({ message, severity }); },
      respond: (html) => ({ __respond: html }),
      settings: Object.freeze({ ...p.settings }),
      storage: { read: async (id) => backend.readStore(p, id), write: async (id, v) => backend.writeStore(p, id, v) },
      package: {
        read: async (path, { binary = false } = {}) => {
          const full = normalize(join(p.dir, path));
          if (!full.startsWith(join(p.dir, "data") + sep)) throw new Error("package.read is limited to the plugin's data/ folder");
          return binary ? readFileSync(full) : readFileSync(full, "utf8");
        },
      },
      haxcms: { ...backend.haxcms },
      plugin: { id: p.id, version: p.manifest.version, scope: "system" },
      site: backend.site,
      user: backend.userFor(p),
      log: Object.fromEntries(["info", "warn", "error"].map((level) => [level, (message, data) => backend.log.push({ level, plugin: p.id, message, data })])),
      fetch: async (url) => {
        const host = new URL(url).hostname;
        if (!(p.manifest.capabilities || []).includes("network:egress") || !(p.manifest.egress || []).includes(host)) throw new Error(`fetch to ${host} not allowed`);
        throw new Error("network is disabled in the harness");
      },
      entities: {
        get: async (type, id) => { backend.requireCap(p, type, "read"); const r = (backend.records[type] || {})[type === "site" ? id || backend.site.id : id]; return r ? structuredClone(r) : null; },
        list: async (type, query = {}) => { backend.requireCap(p, type, "read"); return Object.values(backend.records[type] || {}).filter((r) => Object.entries(query).every(([k, v]) => r[k] === v)).map((r) => structuredClone(r)); },
        save: async (type, record) => { backend.requireCap(p, type, "write"); return backend.saveEntity(type, record); },
      },
      pluginEnabled: (id) => backend.active(id),
      transaction: Object.defineProperty(tx, "run", { value: (fn, opts = {}) => backend.transaction(fn, opts), enumerable: false, configurable: true }),
      hooks: {
        fire: async (name, subject, opts = {}) => {
          if (!p.hookDefs[name]) throw new Error(`${p.id} can only fire hooks it defines (not "${name}")`);
          return backend.fire(name, subject, { ...opts, transaction: tx });
        },
      },
      __warnings: warnings,
    };
    return ctx;
  }

  // ---- core entities (spec/13 ctx.entities) ----
  requireCap(p, type, action) {
    const area = { site: "site", page: "items", file: "files" }[type];
    if (!area) return;
    const caps = p.manifest.capabilities || [];
    const ok = caps.includes(`${area}:${action}`) || (action === "read" && caps.includes(`${area}:write`));
    if (!ok) throw new Error(`${p.id} needs the ${area}:${action} capability to ${action} ${type} records`);
  }
  async saveEntity(type, record) {
    const id = type === "site" ? record.id || this.site.id : record.id || record.uuid;
    const store = (this.records[type] = this.records[type] || {});
    const previous = store[id] ? structuredClone(store[id]) : undefined;
    const op = previous ? "update" : "create";
    const before = await this.fire(`entity.before.${op}`, { ...record, id }, { entity: type, previous });
    if (before.veto) return { record: previous || null, veto: before.veto };
    store[id] = structuredClone(before.subject);
    const after = await this.fire(`entity.after.${op}`, structuredClone(store[id]), { entity: type, previous });
    return { record: after.subject };
  }

  // ---- personal data (spec/04): core exports and erases personalData stores by user id ----
  personalStores() {
    const out = [];
    for (const p of this.plugins) for (const s of Object.values(p.stores)) if (s.personalData && s.scope !== "package") out.push({ p, s, key: s.userKey || "userId" });
    return out;
  }
  exportUser(userId) {
    const out = {};
    for (const { p, s, key } of this.personalStores()) {
      const v = this.readStore(p, s.id);
      const rows = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : [];
      const mine = rows.filter((r) => r && r[key] === userId);
      if (mine.length) out[`${p.id}.${s.id}`] = mine;
    }
    return out;
  }
  eraseUser(userId) {
    let removed = 0;
    for (const { p, s, key } of this.personalStores()) {
      const v = this.readStore(p, s.id);
      if (Array.isArray(v)) { const keep = v.filter((r) => !(r && r[key] === userId)); removed += v.length - keep.length; this.writeStore(p, s.id, keep); }
      else if (v && typeof v === "object") { const keep = Object.fromEntries(Object.entries(v).filter(([, r]) => !(r && r[key] === userId))); removed += Object.keys(v).length - Object.keys(keep).length; this.writeStore(p, s.id, keep); }
    }
    return { removed };
  }

  // ---- upgrade steps (spec/13): every step newer than the installed version, in order ----
  async upgrade(id, fromVersion) {
    const p = this.get(id);
    let versions;
    if (this.runtime === "nodejs") versions = Object.keys((p.entry && p.entry.upgrades) || {});
    else versions = ((await this.invoke(p, "list", "__list_upgrades", this.makeCtx(p))).value || []).map((m) => m.replace(/^upgrade_/, "").replace(/_/g, "."));
    versions = versions.filter((v) => cmpVersion(v, fromVersion) > 0 && cmpVersion(v, p.manifest.version) <= 0).sort(cmpVersion);
    const subject = { id, version: p.manifest.version, scope: "system" };
    try {
      await this.transaction(async (tx) => {
        const b = await this.fire("plugin.before.upgrade", subject, { previous: fromVersion, strict: true, transaction: tx });
        if (b.veto) throw new Error(b.veto.message);
        for (const v of versions) {
          const ctx = this.makeCtx(p, { transaction: tx, previous: fromVersion });
          const r = this.runtime === "nodejs" ? { value: await p.entry.upgrades[v](ctx) } : await this.invoke(p, "upgrade", `upgrade_${v.replace(/\./g, "_")}`, ctx);
          this.log.push({ level: "info", plugin: id, message: `upgrade step ${v} ran` });
          if (r && r.missing) throw new Error(`upgrade step ${v} missing`);
        }
        await this.fire("plugin.after.upgrade", subject, { previous: fromVersion, transaction: tx });
      }, { bulk: true, origin: "upgrade" });
      return { status: 200, body: { id, ran: versions } };
    } catch (e) {
      p.status = "failed"; p.reason = `upgrade failed: ${e.message}`;
      this.log.push({ level: "error", plugin: id, message: p.reason });
      return { status: 409, body: { error: e.message, status: "failed" } };
    }
  }

  // ---- transactions (spec/06): nested ones join the outer one ----
  async transaction(fn, { bulk = true, origin = "harness" } = {}) {
    if (this.currentTx) return fn(this.currentTx);
    const tx = { id: `t${this.log.length}-${Date.now()}`, origin, bulk, operations: [], marks: {} };
    this.currentTx = tx;
    try {
      await this.fire("transaction.before.start", tx, { transaction: tx });
      await this.fire("transaction.after.start", tx, { transaction: tx });
      const result = await fn(tx);
      const end = await this.fire("transaction.before.end", tx, { transaction: tx });
      tx.ok = !end.veto;
      await this.fire("transaction.after.end", tx, { transaction: tx });
      return result;
    } finally {
      this.currentTx = null;
    }
  }

  // ---- invoking plugin code in the configured runtime ----
  async invoke(p, kind, name, ctx, args = []) {
    if (this.runtime === "nodejs") {
      if (!p.entry) return { missing: true };
      const fn = kind === "operation" ? p.entry.operations && p.entry.operations[name] : kind === "hook" ? p.entry.hooks && p.entry.hooks[name] : p.entry[name];
      if (!fn) return { missing: true };
      return { value: await fn(ctx, ...args) };
    }
    const storeState = {};
    for (const id of Object.keys(p.stores)) if (p.stores[id].scope !== "package") storeState[id] = this.readStore(p, id);
    const input = {
      entry: join(p.dir, p.manifest.entry.php), class: studly(p.id), method: kind === "hook" ? camelHook(name) : name, args,
      capabilities: p.manifest.capabilities || [], records: this.records, currentSite: this.site.id, pluginId: p.id,
      pluginDir: p.dir, packageStores: Object.fromEntries(Object.values(p.stores).filter((s) => s.scope === "package").map((s) => [s.id, s.file])),
      overrides: p.storeOverrides || {},
      ctx: { subject: ctx.subject, previous: ctx.previous, settings: ctx.settings, haxcms: ctx.haxcms, plugin: ctx.plugin, site: ctx.site, user: ctx.user, transaction: { id: ctx.transaction.id, origin: ctx.transaction.origin, bulk: ctx.transaction.bulk, marks: ctx.transaction.marks }, stores: storeState, enabled: this.plugins.filter((x) => x.status === "active").map((x) => x.id) },
    };
    const r = spawnSync("php", [join(here, "php/bridge.php")], { input: JSON.stringify(input), encoding: "utf8" });
    if (r.status !== 0) throw new Error(`php bridge failed: ${r.stderr || r.stdout}`);
    const out = JSON.parse(r.stdout);
    if (out.missing) return { missing: true };
    for (const [id, v] of Object.entries(out.stores || {})) this.writeStore(p, id, v);
    for (const [id, v] of Object.entries(out.manifestStores || {})) this.writeStore(p, id, v);
    for (const { type, record } of out.entitySaves || []) await this.saveEntity(type, record);
    for (const l of out.logs || []) this.log.push({ ...l, plugin: p.id });
    ctx.__warnings.push(...(out.warnings || []));
    Object.assign(ctx.transaction.marks, out.transaction && out.transaction.marks ? out.transaction.marks : {});
    return { value: out.result };
  }

  // ---- operations (spec/13 section 5) ----
  async call(operationId, request = {}, { credentials = "both" } = {}) {
    const p = this.plugins.find((x) => x.ops[operationId]);
    if (!p || p.status !== "active") return { status: 404, body: { error: "not found" } };
    const op = p.ops[operationId];
    if (!op.public) {
      const needsJwt = op.security.some((req) => "bearerAuth" in req);
      const needsUser = op.security.some((req) => "userTokenHeader" in req);
      if (needsJwt && credentials === "none") return { status: 401, body: { error: "unauthorized" } };
      if (needsUser && credentials !== "both") return { status: 401, body: { error: USER_TOKEN_REQUIRED } };
    }
    const req = { params: {}, query: {}, body: {}, headers: {}, files: [], ...request };
    const ctx = this.makeCtx(p, { request: req });
    try {
      const r = await this.invoke(p, "operation", operationId, ctx, [req]);
      if (r.missing) return { status: 501, body: { error: `operation ${operationId} is not implemented in ${this.runtime}` } };
      const v = r.value;
      const res = v && typeof v === "object" && "status" in v && "body" in v ? v : { status: 200, body: v };
      if (Buffer.isBuffer(res.body)) res.body = res.body.toString("utf8");
      return { ...res, warnings: ctx.__warnings };
    } catch (e) {
      this.log.push({ level: "error", plugin: p.id, message: String(e && e.message) });
      return { status: 500, body: { error: "internal error" } };
    }
  }

  // ---- hooks (spec/13 section 6) ----
  lineage(entity) { const out = []; let e = entity; while (e) { out.unshift(e); e = this.entityParents[e]; } return out; } // parent first
  subscribers(name, { entity, subject, previous, only, includeInactive, configOf } = {}) {
    const out = [];
    const lineage = entity ? this.lineage(entity) : [];
    this.plugins.forEach((p, order) => {
      if (only && p.id !== only) return;
      if (!(p.status === "active" || (includeInactive && p.status === "inactive") || (includeInactive && p.status === "enabled"))) return;
      for (const sub of p.manifest.hooks || []) {
        let depthMatch = 0;
        let matches = false;
        const entityOk = (list) => { if (!list || !entity) return true; const i = lineage.findIndex((t) => list.includes(t)); depthMatch = i; return i >= 0; };
        if (sub.name === name) matches = entityOk(sub.entities);
        else {
          const c = this.hookContract(sub.name);
          if (c && c.aliasOf) matches = c.aliasOf.some((a) => a.hook === name && entityOk(a.entities) && (!a.changed || a.changed.some((path) => JSON.stringify(getPath(subject, path)) !== JSON.stringify(getPath(previous, path)))));
        }
        if (matches && name.startsWith("config.")) {
          const scope = sub.config || [p.id];
          matches = scope.includes("*") || scope.includes(configOf);
        }
        if (matches) out.push({ p, sub, order, depth: depthMatch });
      }
    });
    return out.sort((a, b) => a.depth - b.depth || (b.sub.priority || 0) - (a.sub.priority || 0) || a.order - b.order);
  }

  requiredFieldsFor(entity) {
    for (const t of this.lineage(entity).reverse()) for (const p of this.plugins) if (p.entities[t] && p.entities[t].requiredFields) return p.entities[t].requiredFields;
    return null;
  }

  async fire(name, subject, opts = {}) {
    let current = structuredClone(subject);
    const warnings = [];
    const setBy = {}; // top-level field -> plugin that last set it
    const phase = (this.hookContract(name) || {}).phase || (name.includes(".after") || name.endsWith(".after") ? "after" : "before");
    for (const { p, sub } of this.subscribers(name, { ...opts, subject })) {
      const ctx = this.makeCtx(p, { subject: structuredClone(current), previous: opts.previous, transaction: opts.transaction });
      try {
        const limit = sub.timeout || this.hookTimeout;
        const r = await withTimeout(this.invoke(p, "hook", sub.name, ctx), limit, `${p.id} ${sub.name}`);
        warnings.push(...ctx.__warnings.map((w) => ({ ...w, plugin: p.id })));
        if (r.missing) continue;
        const v = r.value;
        if (v && v.__veto) {
          if (phase === "after") { this.log.push({ level: "warn", plugin: p.id, message: `${sub.name}: after hooks cannot veto; ignored` }); continue; }
          return { subject: current, veto: { message: v.message, status: v.status || 409, plugin: p.id }, warnings, transaction: opts.transaction };
        }
        if (v && v.__respond !== undefined) return { subject: current, respond: v.__respond, warnings };
        if (v !== undefined && v !== null) {
          const req = opts.entity && name.startsWith("entity.") ? this.requiredFieldsFor(opts.entity) : null;
          if (req && typeof v === "object" && req.some((f) => !(f in v))) { this.log.push({ level: "warn", plugin: p.id, message: `${sub.name}: returned ${opts.entity} is missing required fields; discarded` }); continue; }
          if (v && typeof v === "object" && current && typeof current === "object" && !Array.isArray(v)) {
            for (const k of Object.keys(v)) {
              if (JSON.stringify(v[k]) !== JSON.stringify(current[k])) {
                if (setBy[k] && setBy[k] !== p.id) this.log.push({ level: "warn", plugin: p.id, message: `${sub.name}: ${p.id} overwrote "${k}" set by ${setBy[k]}` });
                setBy[k] = p.id;
              }
            }
          }
          current = v;
        }
      } catch (e) {
        this.log.push({ level: "error", plugin: p.id, message: `${sub.name}: ${e && e.message}` });
        if (opts.strict) throw e;
      }
    }
    return { subject: current, warnings, transaction: opts.transaction };
  }

  // ---- render pipeline (spec/06): the same stages run for live pages and static publish ----
  async render(page, { theme = "clean-one" } = {}) {
    const ctx0 = { site: { id: this.site.id, name: this.site.name }, page, theme, head: [], content: page.content || "", body: { start: [], end: [] }, html: null };
    const before = await this.fire("render.before", ctx0);
    if (before.respond !== undefined) return { html: before.respond, cached: true };
    let c = before.subject;
    for (const stage of ["render.before.head", "render.after.head", "render.before.content", "render.after.content", "render.before.body", "render.after.body"]) c = (await this.fire(stage, c)).subject;
    c.html = `<!doctype html><html><head>${c.head.join("")}</head><body>${c.body.start.join("")}<main>${c.content}</main>${c.body.end.join("")}</body></html>`;
    c = (await this.fire("render.after", c)).subject;
    return { html: c.html, cached: false };
  }
}

// Reference implementation of the HAX backend platform contract (spec/13), in memory.
// It loads plugin folders (tiers, validation, deployment config, dependencies, conflicts, requirements),
// enforces route security from each plugin's OpenAPI document, dispatches hooks (priority, cascade, entity
// inheritance, aliases, config scope, veto, timeouts, discard on error or invalid return, overwrite warnings),
// runs the render pipeline and transactions, and builds the ctx object. Plugin code runs in Node directly, or in
// PHP through harness/php/bridge.php, so the same cases can run against both runtimes.
// It is a test double for plugins and for the spec, not a server: no HTTP, no disk writes, no network.
import { readFileSync, existsSync, mkdtempSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const readAny = (p) => (p.endsWith(".json") ? JSON.parse(readFileSync(p, "utf8")) : parse(readFileSync(p, "utf8")));
const CORE_CONTRACTS = parse(readFileSync(join(root, "schema/core-contracts.yaml"), "utf8")).contracts;
const contractMethod = (name, op) => name.split(".").map((p, i) => (i ? p[0].toUpperCase() + p.slice(1) : p)).join("") + op[0].toUpperCase() + op.slice(1);
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
    // a real, empty folder stands in for the site directory, so plugins that run commands there (git) can be tested
    if (!site.path || site.path === "/sites/test-site") site = { ...site, path: mkdtempSync(join(tmpdir(), "hax-site-")) };
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
    this.revs = new Map(); // "type:id" -> revision, bumped on every write (optimistic concurrency for ctx.entities.save)
    this.managed = new Map(); // managed files written by plugins: path -> { plugin, content }
    this.execCalls = [];
    this.fetchCalls = [];
    this.fetchFakes = {};
    this.execFakes = {};
    this.records = { config: { core: { appStore: { apiKeys: {} } } }, site: { [site.id]: { id: site.id, title: site.name, metadata: { plugins: {} }, items: [] } }, page: {}, file: {} };
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
      found.push({ id: m && m.id, dir, manifest: m || {}, tier: spec.tier || "system-core", ops: {}, stores: {}, hookDefs: {}, entities: {}, settings: {}, explicit: new Set(), form: [], entry: null, status: "enabled", reason: null, unmet: [] });
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
          p.ops[op.operationId] = { operationId: op.operationId, path, verb, scope: op["x-hax-scope"] || api["x-hax-scope"] || "site", public: op["x-hax-public"] === true, security: op.security || api.security || [], proxy: op["x-hax-proxy"] || null };
        }
      }
      if (m.datastores) for (const s of readAny(join(p.dir, m.datastores)).stores) p.stores[s.id] = s;
      if (m.entities) { const e = readAny(join(p.dir, m.entities)); p.entities = e.entities || {}; for (const [name, def] of Object.entries(p.entities)) if (def.extends) this.entityParents[name] = def.extends; }
      if (m.hookDefinitions) for (const h of readAny(join(p.dir, m.hookDefinitions))) p.hookDefs[h.name] = h;
      // defaults: config/settings.defaults.json next to the settings form (haxProperties fields carry no default)
      if (m.settings) { const dp = join(p.dir, dirname(m.settings), "settings.defaults.json"); if (existsSync(dp)) Object.assign(p.settings, readAny(dp)); }
      Object.assign(p.settings, settings[p.id] || {});
      p.explicit = new Set(Object.keys(settings[p.id] || {}));
      p.form = m.settings && existsSync(join(p.dir, m.settings)) ? readAny(join(p.dir, m.settings)).configure || [] : [];
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
  elements(p) {
    const d = join(p.dir, "registries/elements");
    return existsSync(d) ? readdirSync(d).filter((f) => /\.(ya?ml|json)$/.test(f)).sort().map((f) => readAny(join(d, f))) : [];
  }
  // legacy.settings (spec/02): a plugin setting still living at its old core location. `config:a.b` is the core
  // config; anything else is a path in the site's site.json.
  legacyLocation(path) {
    if (path.startsWith("config:")) return { type: "config", id: "core", keys: path.slice(7).split(".") };
    return { type: "site", id: this.site.id, keys: path.split(".") };
  }
  legacyValue(path) {
    const { type, id, keys } = this.legacyLocation(path);
    return keys.reduce((o, k) => (o == null ? undefined : o[k]), (this.records[type] || {})[id]);
  }
  // reads fall back to the old location until the move on first install has run
  // (a default does not count as a value; only one someone saved does)
  effectiveSettings(p) {
    const out = { ...p.settings };
    for (const [key, path] of Object.entries((p.manifest.legacy || {}).settings || {})) {
      if (p.explicit.has(key)) continue;
      const v = this.legacyValue(path);
      if (v !== undefined && v !== null && v !== "") out[key] = this.coerceSetting(p, key, v);
    }
    return out;
  }
  // old values were often strings ("1", "true"); they take the type of the settings form field they move into
  coerceSetting(p, key, v) {
    const f = p.form.find((x) => x.property === key);
    if (!f) return v;
    if (f.inputMethod === "boolean") return v === true || v === 1 || ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
    if (f.inputMethod === "number") return Number(v);
    return v;
  }
  // first install: core moves each legacy setting into the plugin's settings and removes the old copy, through the
  // normal config and entity hooks, so a plugin needs no install code for it
  async moveLegacySettings(p) {
    const moved = {};
    for (const [key, path] of Object.entries((p.manifest.legacy || {}).settings || {})) {
      const v = this.legacyValue(path);
      if (v === undefined || v === null || v === "") continue;
      if (!p.explicit.has(key)) moved[key] = this.coerceSetting(p, key, v);
      const { type, id, keys } = this.legacyLocation(path);
      const rec = structuredClone(this.records[type][id]);
      // remove the key, then any parent it leaves empty
      const chain = [rec];
      for (const k of keys.slice(0, -1)) chain.push(chain[chain.length - 1][k]);
      delete chain[chain.length - 1][keys[keys.length - 1]];
      for (let i = chain.length - 1; i > 0; i--) if (chain[i] && typeof chain[i] === "object" && !Object.keys(chain[i]).length) delete chain[i - 1][keys[i - 1]]; else break;
      await this.saveEntity(type, rec);
    }
    if (Object.keys(moved).length) {
      const r = await this.saveConfig(p.id, moved);
      if (r.status !== 200) throw new Error(`moving legacy settings failed: ${r.body.error}`);
      this.log.push({ level: "info", plugin: p.id, message: `moved ${Object.keys(moved).join(", ")} from the core location into plugin settings` });
    }
  }
  // ctx.fetch in the harness: egress is checked, the call recorded, and the answer comes from the case's `fetch`
  // fakes by host; without a fake the network is simply off
  async fetchFor(p, url, init = {}) {
    const host = new URL(url).hostname;
    if (!(p.manifest.capabilities || []).includes("network:egress") || !(p.manifest.egress || []).includes(host)) throw new Error(`fetch to ${host} not allowed`);
    this.fetchCalls.push({ plugin: p.id, method: (init.method || "GET").toUpperCase(), url });
    const fake = (this.fetchFakes || {})[host];
    if (!fake) throw new Error("network is disabled in the harness");
    const body = typeof fake.body === "string" ? fake.body : JSON.stringify(fake.body ?? null);
    return { status: fake.status ?? 200, ok: (fake.status ?? 200) < 400, headers: new Map(Object.entries(fake.headers || {})), text: async () => body, json: async () => JSON.parse(body) };
  }
  // x-hax-proxy (spec/05): a GET operation answered by core from the declaration, with no plugin code. Templates may
  // read settings ({{settings.apiKey}}) and only the listed query parameters pass through from the caller.
  async proxy(p, op, req) {
    const d = op.proxy;
    const fill = (v) => String(v).replace(/\{\{settings\.(\w+)\}\}/g, (m, k) => String(this.effectiveSettings(p)[k] ?? ""));
    const u = new URL(fill(d.url));
    for (const [k, v] of Object.entries(d.query || {})) u.searchParams.set(k, fill(v));
    for (const k of d.pass || []) if (req.query[k] !== undefined) u.searchParams.set(k, String(req.query[k]));
    try {
      const res = await this.fetchFor(p, u.toString());
      const text = await res.text();
      let body; try { body = JSON.parse(text); } catch { body = text; }
      return { status: res.status, body };
    } catch (e) {
      this.log.push({ level: "warn", plugin: p.id, message: `${op.operationId || "proxy"}: ${e.message}` });
      return { status: 502, body: { error: `${u.hostname} could not be reached` } };
    }
  }
  // ctx.exec in the harness: checks the exec list, records the call (file names only, never their content) and
  // answers from the case's `exec` fakes; nothing runs
  async execFor(p, cmd, args, opts = {}) {
    if (!(p.manifest.capabilities || []).includes("exec:run") || !(p.manifest.exec || []).includes(cmd)) throw new Error(`${p.id} may not run "${cmd}" (not in its exec list)`);
    if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) throw new Error("exec args must be a list of strings (no shell)");
    const call = { plugin: p.id, cmd, args: args.map((a) => a.replace(/\{tmp\}/g, "<tmp>")), files: Object.keys(opts.files || {}).sort() };
    this.execCalls.push(call);
    const fake = (this.execFakes || {})[cmd];
    if (!fake) throw new Error(`exec "${cmd}" has no fake in this case (run.exec)`);
    return { code: fake.code ?? 0, stdout: fake.stdout ?? "", stderr: fake.stderr ?? "" };
  }
  // privacy.consentSetting: requiresConsent counts only where that boolean setting is on (spec/05)
  effectivePrivacy(p) {
    const pr = p.manifest.privacy; if (!pr) return null;
    if (!pr.consentSetting || p.settings[pr.consentSetting] === true) return pr;
    return { ...pr, requiresConsent: [] };
  }
  status() { return this.plugins.map((p) => ({ id: p.id, status: p.status, reason: p.reason, unmet: p.unmet })); }
  active(id) { const p = this.get(id); return !!p && p.status === "active"; }
  hookContract(name) { return CORE_HOOKS.find((c) => c.name === name) || this.plugins.map((p) => p.hookDefs[name]).find(Boolean); }

  // a required settings field without a value is an unmet requirement on its own (spec/03); hooks add the rest
  requiredUnmet(p) {
    const eff = this.effectiveSettings(p);
    return p.form.filter((f) => f.required && (eff[f.property] === undefined || eff[f.property] === null || eff[f.property] === "")).map((f) => ({ key: `settings.${f.property}`, message: `Set ${f.title || f.property}` }));
  }
  async refreshStatus(p) {
    const before = await this.fire("plugin.before.requirements", this.requiredUnmet(p), { only: p.id, includeInactive: true });
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
      if (first) { this.installed.add(`${id}:system`); await this.moveLegacySettings(p); await this.fire("plugin.after.install", subject, { strict: true }); }
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
    if (r.veto) return { status: r.veto.status || 409, body: { error: r.veto.message } };
    await this.fire("plugin.after.disable", subject);
    p.status = "disabled"; p.reason = "disabled";
    // blocks already placed keep rendering (the registry keeps every element); authors just can no longer insert or
    // edit them, so the owner is told where they are (spec/07)
    const tags = this.elements(p).filter((e) => e.role === "block").map((e) => e.tag);
    const inUse = Object.values(this.records.page || {}).map((pg) => ({ page: pg.id, tags: tags.filter((t) => new RegExp(`<${t}[\\s>/]`).test(pg.content || "")) })).filter((x) => x.tags.length);
    return { status: 200, body: { id, status: "disabled", ...(inUse.length ? { inUse } : {}) } };
  }

  // ---- settings (spec/13 section 7) ----
  async saveConfig(id, values) {
    const p = this.get(id);
    const subject = { plugin: id, scope: "system", values: { ...p.settings, ...values } };
    const before = await this.fire("config.before.save", subject, { previous: { ...p.settings }, configOf: id });
    if (before.veto) return { status: before.veto.status || 409, body: { error: before.veto.message } };
    const prev = { ...p.settings };
    p.settings = { ...before.subject.values };
    for (const k of Object.keys(values)) p.explicit.add(k);
    await this.fire("config.after.save", { ...before.subject }, { previous: prev, configOf: id });
    if (p.status === "active" || p.status === "inactive") await this.refreshStatus(p);
    return { status: 200, body: { status: p.status }, warnings: before.warnings || [] };
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
    if (p.stores[id] && p.stores[id].scope === "manifest") { this.bump("site", this.site.id); const site = this.records.site[this.site.id]; site.metadata = site.metadata || {}; site.metadata.plugins = site.metadata.plugins || {}; site.metadata.plugins[p.id] = { ...(site.metadata.plugins[p.id] || {}), [id]: structuredClone(value) }; return; }
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
    const readRevs = new Map();
    const tx = extras.transaction || backend.currentTx || { id: `t${Date.now()}`, origin: "implicit", bulk: false, operations: [], marks: {} };
    const ctx = {
      subject: extras.subject,
      previous: extras.previous,
      request: extras.request,
      veto: (message, status = 409) => ({ __veto: true, message, status }),
      warn: (message, severity = "warning") => { warnings.push({ message, severity }); },
      respond: (html) => ({ __respond: html }),
      settings: Object.freeze(backend.effectiveSettings(p)),
      storage: { read: async (id) => backend.readStore(p, id), write: async (id, v) => backend.writeStore(p, id, v) },
      package: {
        read: async (path, { binary = false } = {}) => {
          const full = normalize(join(p.dir, path));
          if (!full.startsWith(join(p.dir, "data") + sep)) throw new Error("package.read is limited to the plugin's data/ folder");
          return binary ? readFileSync(full) : readFileSync(full, "utf8");
        },
        // files under a folder of data/, recursively, as paths relative to that folder
        list: async (path) => {
          const base = normalize(join(p.dir, path));
          if (base !== join(p.dir, "data") && !base.startsWith(join(p.dir, "data") + sep)) throw new Error("package.list is limited to the plugin's data/ folder");
          const walk = (d, pre = "") => (existsSync(d) ? readdirSync(d).sort().flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f), `${pre}${f}/`) : [`${pre}${f}`])) : []);
          return walk(base);
        },
      },
      haxcms: { ...backend.haxcms },
      plugin: { id: p.id, version: p.manifest.version, scope: "system" },
      site: backend.site,
      user: backend.userFor(p),
      log: Object.fromEntries(["info", "warn", "error"].map((level) => [level, (message, data) => backend.log.push({ level, plugin: p.id, message, data })])),
      fetch: async (url, init = {}) => backend.fetchFor(p, url, init),
      config: { save: async (values) => backend.saveConfig(p.id, values) },
      // the only sanctioned way to run a process (spec/13): commands outside the exec list are refused
      exec: async (cmd, args = [], opts = {}) => backend.execFor(p, cmd, args, opts),
      plugins: { list: async () => backend.activeList(), skills: async (audience) => backend.pluginSkills(audience), operations: async (filter = {}) => backend.pluginOperations(filter), prompts: async () => backend.pluginPrompts() },
      files: {
        writeManaged: async (path, content) => backend.writeManaged(p, path, content),
        readManaged: async (path) => (backend.managed.get(path) || {}).content ?? null,
        // a site's own files (uploads) live under files/; needs files:write
        put: async (path, data) => backend.putSiteFile(p, path, data),
        remove: async (path) => backend.removeSiteFile(p, path),
      },
      assets: { url: (path) => backend.assetUrl(p, path) },
      entities: {
        get: async (type, id) => {
          backend.requireCap(p, type, "read");
          const key = type === "site" ? id || backend.site.id : id;
          const r = (backend.records[type] || {})[key];
          readRevs.set(`${type}:${key}`, backend.rev(type, key));
          return r ? structuredClone(r) : null;
        },
        list: async (type, query = {}) => { backend.requireCap(p, type, "read"); return Object.values(backend.records[type] || {}).filter((r) => Object.entries(query).every(([k, v]) => r[k] === v)).map((r) => structuredClone(r)); },
        delete: async (type, id) => { backend.requireCap(p, type, "write"); return backend.deleteEntity(type, id); },
        save: async (type, record) => {
          backend.requireCap(p, type, "write");
          const key = type === "site" ? record.id || backend.site.id : record.id || record.uuid;
          const seen = readRevs.get(`${type}:${key}`);
          // a copy read before someone else changed the record is refused rather than silently overwriting their change
          if (seen !== undefined && seen !== backend.rev(type, key)) {
            backend.log.push({ level: "error", plugin: p.id, message: `stale ${type} ${key}: changed since it was read; re-read and try again` });
            return { record: structuredClone((backend.records[type] || {})[key]), conflict: true };
          }
          const r = await backend.saveEntity(type, record);
          readRevs.set(`${type}:${key}`, backend.rev(type, key));
          return r;
        },
      },
      pluginEnabled: (id) => backend.active(id),
      transaction: Object.defineProperty(tx, "run", { value: (fn, opts = {}) => backend.transaction(fn, opts), enumerable: false, configurable: true }),
      hooks: {
        fire: async (name, subject, opts = {}) => {
          const core = CORE_HOOKS.find((c) => c.name === name);
          if (!p.hookDefs[name] && !(core && core.definedBy === p.id)) throw new Error(`${p.id} can only fire hooks it defines (not "${name}")`);
          return backend.fire(name, subject, { ...opts, transaction: tx });
        },
      },
      __warnings: warnings,
    };
    return ctx;
  }

  // skills of active plugins for one audience, with their files (SKILL.md first); .md/.json/.txt only
  pluginSkills(audience) {
    const out = [];
    for (const x of this.plugins.filter((q) => q.status === "active")) for (const sk of x.manifest.skills || []) {
      if (sk.audience !== audience) continue;
      const dir = join(x.dir, "skills", sk.name);
      if (!existsSync(join(dir, "SKILL.md"))) continue;
      const md = readFileSync(join(dir, "SKILL.md"), "utf8");
      const fm = /^---\n([\s\S]*?)\n---/.exec(md);
      const meta = fm ? parse(fm[1]) : {};
      const walk = (d, pre = "") => readdirSync(d).sort().flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f), `${pre}${f}/`) : [`${pre}${f}`]));
      const files = walk(dir).filter((f) => /\.(md|json|txt)$/.test(f)).sort((a, b) => (a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : a.localeCompare(b))).map((f) => ({ path: f, content: readFileSync(join(dir, f), "utf8") }));
      out.push({ plugin: x.id, name: sk.name, description: meta.description || "", files });
    }
    return out;
  }
  // managed files: only with output:managedFiles and only paths matching the manifest's managedFiles patterns
  writeManaged(p, path, content) {
    const caps = p.manifest.capabilities || [];
    if (!caps.includes("output:managedFiles")) throw new Error(`${p.id} needs output:managedFiles to write ${path}`);
    const ok = (p.manifest.managedFiles || []).some((pat) => new RegExp("^" + pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$").test(path));
    if (!ok || path.includes("..")) throw new Error(`${p.id} may not write ${path}: not in its managedFiles`);
    const owner = this.managed.get(path);
    if (owner && owner.plugin !== p.id) throw new Error(`${path} is managed by ${owner.plugin}`);
    this.managed.set(path, { plugin: p.id, content: String(content) });
    return { path };
  }
  sitePath(p, path) {
    const clean = String(path).replace(/^\/+/, "");
    if (!/^files\/[A-Za-z0-9._\/-]+$/.test(clean) || clean.includes("..")) throw new Error(`${p.id}: site files live under files/ (${path})`);
    return join(this.site.path, clean);
  }
  putSiteFile(p, path, data) {
    this.requireCap(p, "file", "write");
    const full = this.sitePath(p, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, Buffer.isBuffer(data) ? data : Buffer.from(String(data), "base64"));
    return { path };
  }
  removeSiteFile(p, path) {
    this.requireCap(p, "file", "write");
    const full = this.sitePath(p, path);
    try { rmSync(full); return { removed: true }; } catch { return { removed: false }; }
  }
  // operations of active plugins, for discovery (the MCP plugin lists those with x-hax-mcp)
  pluginOperations({ mcp } = {}) {
    const out = [];
    for (const x of this.plugins.filter((q) => q.status === "active")) {
      if (!x.manifest.openapi) continue;
      const api = readAny(join(x.dir, x.manifest.openapi));
      for (const [path, verbs] of Object.entries(api.paths || {})) for (const [verb, op] of Object.entries(verbs)) {
        if (!op || !op.operationId) continue;
        if (mcp && op["x-hax-mcp"] !== true) continue;
        const scope = op["x-hax-scope"] || api["x-hax-scope"] || "site";
        out.push({ plugin: x.id, operationId: op.operationId, method: verb.toUpperCase(), path: `${scope === "system" ? "/system/api" : "/x/api"}/v1/plugins/${x.id}${path}`, summary: op.summary || "", readOnly: verb === "get", mcp: op["x-hax-mcp"] === true });
      }
    }
    return out;
  }
  // prompts of active plugins: docs/prompts.yaml, then register.before.prompts (spec/07, plugin screen)
  staticPrompts() {
    const list = [];
    for (const x of this.plugins.filter((q) => q.status === "active")) if (x.manifest.docs && x.manifest.docs.prompts && existsSync(join(x.dir, x.manifest.docs.prompts))) list.push(...(readAny(join(x.dir, x.manifest.docs.prompts)).prompts || []).map((pr) => ({ plugin: x.id, ...pr })));
    return list;
  }
  async pluginPrompts() {
    if (this.collectingPrompts) return this.collectingPrompts; // a prompts hook asking for prompts gets the list so far
    let list = this.staticPrompts();
    this.collectingPrompts = list;
    try { list = (await this.fire("register.before.prompts", list)).subject; } finally { this.collectingPrompts = null; }
    return list;
  }
  activeList() {
    return this.plugins.filter((x) => x.status === "active").map((x) => ({ id: x.id, version: x.manifest.version, privacy: this.effectivePrivacy(x), capabilities: x.manifest.capabilities || [], skills: x.manifest.skills || [] }));
  }
  assetUrl(p, path) {
    if (!/^frontend\/dist\/[A-Za-z0-9._\/-]+$/.test(path) || path.includes("..")) throw new Error(`${p.id}: assets.url only serves files under frontend/dist`);
    return `x/api/v1/plugins/${p.id}/assets/${path.slice("frontend/dist/".length)}`;
  }

  // ---- rebuild (spec/07 managed files): plugins mark fragment pages, then write their own files ----
  async rebuild(reason = "save") {
    const before = await this.fire("rebuild.before", { scope: "site", siteId: this.site.id, reason, fragments: [] });
    if (before.veto) return { status: before.veto.status || 409, body: { error: before.veto.message } };
    const fragments = [...new Set(before.subject.fragments || [])];
    const pages = Object.values(this.records.page || {});
    const listed = pages.filter((pg) => !fragments.includes(pg.id) && pg.published !== false);
    const llms = listed.map((pg) => `- [${pg.title}](${pg.slug || pg.id})`).join("\n");
    // authoring side: the block list comes from active plugins only; the element registry keeps every installed
    // element so placed blocks keep hydrating after their pack is turned off (spec/07)
    const blocks = this.plugins.filter((x) => x.status === "active").flatMap((x) => this.elements(x).filter((e) => e.role === "block").map((e) => e.tag)).sort();
    const registry = Object.fromEntries(this.plugins.filter((x) => x.status !== "refused").flatMap((x) => this.elements(x).map((e) => [e.tag, e.path.startsWith("frontend/dist/") ? this.assetUrl(x, e.path) : e.path])).sort(([a], [b]) => a.localeCompare(b)));
    await this.fire("rebuild.after", { scope: "site", siteId: this.site.id, reason, files: ["llms.txt", "wc-registry.json", "appstore.json"] });
    const appstore = this.plugins.filter((x) => x.status === "active").flatMap((x) => { const d = join(x.dir, "registries/appstore"); return existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).sort().flatMap((f) => readAny(join(d, f)).apps || []) : []; });
    return { status: 200, body: { fragments, llms, blocks, registry, apps: appstore.map((a) => a.details && a.details.title).filter(Boolean) } };
  }

  // ---- core entities (spec/13 ctx.entities) ----
  requireCap(p, type, action) {
    const area = { site: "site", page: "items", file: "files", config: "settings" }[type];
    if (!area) return;
    const caps = p.manifest.capabilities || [];
    const ok = caps.includes(`${area}:${action}`) || (action === "read" && caps.includes(`${area}:write`));
    if (!ok) throw new Error(`${p.id} needs the ${area}:${action} capability to ${action} ${type} records`);
  }
  // pages and site.json are files in a HAXcms site; writing them lets plugins that work with files (git) see real changes
  writeToDisk(type, record) {
    try {
      if (type === "page") { const d = join(this.site.path, "pages", String(record.id)); mkdirSync(d, { recursive: true }); writeFileSync(join(d, "index.html"), String(record.content ?? record.title ?? "")); }
      if (type === "site") writeFileSync(join(this.site.path, "site.json"), JSON.stringify(record, null, 2));
    } catch { /* the folder is a stand-in; ignore */ }
  }
  bump(type, id) { const k = `${type}:${id}`; this.revs.set(k, (this.revs.get(k) || 0) + 1); }
  rev(type, id) { return this.revs.get(`${type}:${id}`) || 0; }
  async saveEntity(type, record) {
    const id = type === "site" ? record.id || this.site.id : record.id || record.uuid;
    const store = (this.records[type] = this.records[type] || {});
    const previous = store[id] ? structuredClone(store[id]) : undefined;
    const op = previous ? "update" : "create";
    const before = await this.fire(`entity.before.${op}`, { ...record, id }, { entity: type, previous });
    if (before.veto) return { record: previous || null, veto: before.veto, warnings: before.warnings || [] };
    store[id] = structuredClone(before.subject);
    this.bump(type, id);
    this.writeToDisk(type, store[id]);
    const after = await this.fire(`entity.after.${op}`, structuredClone(store[id]), { entity: type, previous });
    // before-hook warnings travel back to whoever saved (the editor shows them; spec/06)
    return { record: after.subject, warnings: before.warnings || [] };
  }

  async deleteEntity(type, id) {
    const store = this.records[type] || {};
    const previous = store[id];
    if (!previous) return { deleted: false };
    const before = await this.fire("entity.before.delete", structuredClone(previous), { entity: type });
    if (before.veto) return { deleted: false, veto: before.veto };
    delete store[id];
    this.bump(type, id);
    await this.fire("entity.after.delete", structuredClone(previous), { entity: type });
    return { deleted: true };
  }

  // ---- personal data (spec/04): core exports and erases personalData stores by user id ----
  personalStores() {
    const out = [];
    for (const p of this.plugins) for (const s of Object.values(p.stores)) if (s.personalData && s.scope !== "package") out.push({ p, s, key: s.userKey || "userId" });
    return out;
  }
  // export and erase are core operations with before/after hooks (spec/04); plugins that keep personal data outside
  // personalData stores answer through the privacy.export / privacy.delete contracts
  async exportUser(userId) {
    const before = await this.fire("user.before.export", { userId });
    if (before.veto) return { status: before.veto.status || 409, body: { error: before.veto.message } };
    const out = {};
    for (const { p, s, key } of this.personalStores()) {
      const v = this.readStore(p, s.id);
      const rows = Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : [];
      const mine = rows.filter((r) => r && r[key] === userId);
      if (mine.length) out[`${p.id}.${s.id}`] = mine;
    }
    for (const r of await this.callContract("privacy.export", "export", { userId })) if (r.result != null) out[r.plugin] = r.result;
    await this.fire("user.after.export", { userId, stores: Object.keys(out) });
    return { status: 200, body: out };
  }
  // one transaction, so a before hook can leave marks for its after hook (the records are gone by then)
  async eraseUser(userId) { return this.transaction(() => this.eraseUserNow(userId), { bulk: false, origin: "privacy" }); }
  async eraseUserNow(userId) {
    const before = await this.fire("user.before.erase", { userId });
    if (before.veto) return { status: before.veto.status || 409, body: { error: before.veto.message } };
    let removed = 0;
    const by = {};
    for (const { p, s, key } of this.personalStores()) {
      const v = this.readStore(p, s.id);
      let n = 0;
      if (Array.isArray(v)) { const keep = v.filter((r) => !(r && r[key] === userId)); n = v.length - keep.length; if (n) this.writeStore(p, s.id, keep); }
      else if (v && typeof v === "object") { const keep = Object.fromEntries(Object.entries(v).filter(([, r]) => !(r && r[key] === userId))); n = Object.keys(v).length - Object.keys(keep).length; if (n) this.writeStore(p, s.id, keep); }
      if (n) by[`${p.id}.${s.id}`] = n;
      removed += n;
    }
    for (const r of await this.callContract("privacy.delete", "delete", { userId })) { const n = (r.result && r.result.removed) || 0; if (n) by[r.plugin] = n; removed += n; }
    await this.fire("user.after.erase", { userId, removed: by });
    return { status: 200, body: { removed } };
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
      let fn;
      if (kind === "operation") fn = p.entry.operations && p.entry.operations[name];
      else if (kind === "hook") fn = p.entry.hooks && p.entry.hooks[name];
      else if (kind === "contract") { const [c, op] = name.split("#"); fn = p.entry.contracts && p.entry.contracts[c] && p.entry.contracts[c][op]; }
      else fn = p.entry[name];
      if (!fn) return { missing: true };
      return { value: await fn(ctx, ...args) };
    }
    const storeState = {};
    for (const id of Object.keys(p.stores)) if (p.stores[id].scope !== "package") storeState[id] = this.readStore(p, id);
    const input = {
      entry: join(p.dir, p.manifest.entry.php), class: studly(p.id), method: kind === "hook" ? camelHook(name) : kind === "contract" ? contractMethod(...name.split("#")) : name, args,
      capabilities: p.manifest.capabilities || [], records: this.records, currentSite: this.site.id, pluginId: p.id, activePlugins: this.activeList(), operations: this.pluginOperations({}), prompts: this.staticPrompts(), skillsByAudience: { site: this.pluginSkills("site"), system: this.pluginSkills("system") }, managedFiles: Object.fromEntries([...this.managed].map(([k, v]) => [k, v.content])),
      pluginDir: p.dir, packageStores: Object.fromEntries(Object.values(p.stores).filter((s) => s.scope === "package").map((s) => [s.id, s.file])),
      overrides: p.storeOverrides || {},
      fetch: { egress: (p.manifest.capabilities || []).includes("network:egress") ? p.manifest.egress || [] : [], fakes: this.fetchFakes || {} },
      exec: { allowed: (p.manifest.capabilities || []).includes("exec:run") ? p.manifest.exec || [] : [], fakes: this.execFakes || {} },
      ctx: { subject: ctx.subject, previous: ctx.previous, settings: ctx.settings, haxcms: ctx.haxcms, plugin: ctx.plugin, site: ctx.site, user: ctx.user, transaction: { id: ctx.transaction.id, origin: ctx.transaction.origin, bulk: ctx.transaction.bulk, marks: ctx.transaction.marks }, stores: storeState, enabled: this.plugins.filter((x) => x.status === "active").map((x) => x.id) },
    };
    const r = spawnSync("php", [join(here, "php/bridge.php")], { input: JSON.stringify(input), encoding: "utf8" });
    if (r.status !== 0) throw new Error(`php bridge failed: ${r.stderr || r.stdout}`);
    const out = JSON.parse(r.stdout);
    if (out.missing) return { missing: true };
    for (const [id, v] of Object.entries(out.stores || {})) this.writeStore(p, id, v);
    for (const [id, v] of Object.entries(out.manifestStores || {})) this.writeStore(p, id, v);
    for (const [path, b64] of Object.entries(out.sitePuts || {})) this.putSiteFile(p, path, b64);
    for (const path of out.siteRemoves || []) this.removeSiteFile(p, path);
    const apply = async () => {
      for (const { type, id } of out.entityDeletes || []) await this.deleteEntity(type, id);
      for (const { type, record } of out.entitySaves || []) await this.saveEntity(type, record);
    };
    if (out.bulk) await this.transaction(apply, { bulk: true, origin: out.bulk.origin || "plugin" }); else await apply();
    for (const values of out.configSaves || []) await this.saveConfig(p.id, values);
    for (const [path, content] of Object.entries(out.managedWrites || {})) this.writeManaged(p, path, content);

    for (const call of out.execCalls || []) this.execCalls.push({ plugin: p.id, ...call });
    for (const call of out.fetchCalls || []) this.fetchCalls.push({ plugin: p.id, ...call });
    if (out.execError) throw new Error(out.execError);
    for (const l of out.logs || []) this.log.push({ ...l, plugin: p.id });
    ctx.__warnings.push(...(out.warnings || []));
    Object.assign(ctx.transaction.marks, out.transaction && out.transaction.marks ? out.transaction.marks : {});
    return { value: out.result };
  }

  // ---- contracts: core (or a plugin) calls every active implementer (spec/06, spec/13) ----
  async callContract(name, op, input, { only } = {}) {
    const results = [];
    for (const p of this.plugins.filter((x) => x.status === "active" && (x.manifest.implements || []).includes(name) && (!only || x.id === only))) {
      const ctx = this.makeCtx(p, { subject: input });
      try {
        const r = await this.invoke(p, "contract", `${name}#${op}`, ctx, [input]);
        if (!r.missing) results.push({ plugin: p.id, result: r.value ?? null });
      } catch (e) { this.log.push({ level: "error", plugin: p.id, message: `${name}.${op}: ${e.message}` }); }
    }
    return results;
  }
  // entries written since the last flush go to log.sink implementers (never their own entries, to avoid loops)
  async flushLog() {
    const start = this.flushed || 0;
    this.flushed = this.log.length;
    const sinks = this.plugins.filter((x) => x.status === "active" && (x.manifest.implements || []).includes("log.sink"));
    if (!sinks.length) return;
    for (const entry of this.log.slice(start, this.flushed)) for (const sink of sinks) {
      if (entry.plugin === sink.id) continue;
      await this.callContract("log.sink", "write", { time: new Date(0).toISOString(), scope: "system", ...entry }, { only: sink.id });
    }
    this.flushed = this.log.length;
  }

  // ---- operations (spec/13 section 5) ----
  async call(operationId, request = {}, { credentials = "both" } = {}) {
    const p = this.plugins.find((x) => x.ops[operationId]);
    if (!p || p.status !== "active") return { status: 404, body: { error: "not found" } };
    const op = p.ops[operationId];
    // `optional` auth (spec/05): an empty requirement {} next to the others lets anonymous calls through; the
    // handler sees ctx.user = null and applies its own setting-based filter
    const optional = op.security.some((req) => req && Object.keys(req).length === 0);
    if (!op.public && !(optional && credentials === "none")) {
      const needsJwt = op.security.some((req) => "bearerAuth" in req);
      const needsUser = op.security.some((req) => "userTokenHeader" in req || "siteTokenHeader" in req);
      if (needsJwt && credentials === "none") return { status: 401, body: { error: "unauthorized" } };
      if (needsUser && credentials !== "both") return { status: 401, body: { error: op.security.some((req) => "siteTokenHeader" in req) ? "X-HAXCMS-Site-Token header is required for this endpoint" : USER_TOKEN_REQUIRED } };
    }
    let req = { params: {}, query: {}, body: {}, headers: {}, files: [], ...request };
    const before = await this.fire("rest.before.request", { method: op.verb.toUpperCase(), path: op.path, operationId, plugin: p.id, ...req });
    if (before.veto) return { status: before.veto.status || 403, body: { error: before.veto.message } };
    req = { ...req, ...before.subject };
    if (op.proxy) {
      const res = await this.proxy(p, op, req);
      const after = await this.fire("rest.after.request", { status: res.status, headers: {}, body: res.body });
      return { ...res, ...after.subject };
    }
    const ctx = this.makeCtx(p, { request: req });
    if (credentials === "none") ctx.user = null; // no credentials, no user, even on a public route
    try {
      const r = await this.invoke(p, "operation", operationId, ctx, [req]);
      if (r.missing) return { status: 501, body: { error: `operation ${operationId} is not implemented in ${this.runtime}` } };
      const v = r.value;
      // a response envelope has a numeric status and only status/headers/body keys (spec/13); anything else is a body,
      // so a record with its own status and body fields (a comment: status "pending") is not mistaken for one
      const envelope = v && typeof v === "object" && !Array.isArray(v) && Number.isInteger(v.status) && Object.keys(v).every((k) => ["status", "headers", "body"].includes(k));
      const res = envelope ? v : { status: 200, body: v };
      if (Buffer.isBuffer(res.body)) res.body = res.body.toString("utf8");
      const after = await this.fire("rest.after.request", { status: res.status, headers: res.headers || {}, body: res.body });
      return { ...res, ...after.subject, warnings: ctx.__warnings };
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
      const ownConfig = name.startsWith("config.") && configOf === p.id && p.status === "inactive";
      if (!(p.status === "active" || ownConfig || (includeInactive && p.status === "inactive") || (includeInactive && p.status === "enabled"))) return;
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
  // mode: dynamic (served by the server), preview (the editor's preview) or publish (static output); spec/06
  async render(page, { theme = "clean-one", mode = "dynamic" } = {}) {
    const ctx0 = { site: { id: this.site.id, name: this.site.name }, page, theme, mode, head: [], content: page.content || "", body: { start: [], end: [] }, html: null };
    const before = await this.fire("render.before", ctx0);
    if (before.respond !== undefined) return { html: before.respond, cached: true };
    let c = before.subject;
    for (const stage of ["render.before.head", "render.after.head", "render.before.content", "render.after.content", "render.before.body", "render.after.body"]) c = (await this.fire(stage, c)).subject;
    c.html = `<!doctype html><html><head>${c.head.join("")}</head><body>${c.body.start.join("")}<main>${c.content}</main>${c.body.end.join("")}</body></html>`;
    c = (await this.fire("render.after", c)).subject;
    return { html: c.html, cached: false };
  }
}

// Reference implementation of the HAX backend platform contract (spec/13), in memory.
// It loads plugin folders, enforces route security from each plugin's OpenAPI document, dispatches hooks
// (priority, aliases, entity filters, veto, discard on error) and builds the ctx object. Plugin code runs in
// Node directly, or in PHP through harness/php/bridge.php, so the same cases can run against both runtimes.
// It is a test double for plugins, not a server: no HTTP, no disk writes, no network.
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const readAny = (p) => (p.endsWith(".json") ? JSON.parse(readFileSync(p, "utf8")) : parse(readFileSync(p, "utf8")));
const CORE_HOOKS = JSON.parse(readFileSync(join(root, "schema/hook-contracts.json"), "utf8"));
const USER_TOKEN_REQUIRED = "X-HAXCMS-User-Token header is required for this endpoint";

const studly = (id) => id.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join("") + "Plugin";
const camelHook = (name) => name.split(".").map((p, i) => (i ? p[0].toUpperCase() + p.slice(1) : p)).join("");
const getPath = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

export class MemoryBackend {
  constructor({ haxcmsVersion = "26.10.1", runtime = "nodejs", site = { id: "00000000-0000-4000-8000-000000000001", name: "test-site", path: "/sites/test-site" }, user = { id: "u1", name: "admin", displayName: "Admin", roles: ["admin"], avatar: null } } = {}) {
    this.haxcms = { version: haxcmsVersion, runtime };
    this.runtime = runtime;
    this.site = site;
    this.user = user;
    this.plugins = []; // in cascade order
    this.memory = new Map(); // store contents by key
    this.log = [];
  }

  // ---- loading (spec/13 section 2, simplified: one tier, no deployment config) ----
  async load(dirs, { settings = {}, stores = {} } = {}) {
    for (const d of dirs) {
      const dir = resolve(d);
      const m = readAny(join(dir, "plugin.yaml"));
      const p = { id: m.id, dir, manifest: m, ops: {}, stores: {}, hookDefs: {}, settings: {}, entry: null, status: "active", unmet: [] };
      if (m.openapi) {
        const api = readAny(join(dir, m.openapi));
        for (const [path, verbs] of Object.entries(api.paths || {})) for (const [verb, op] of Object.entries(verbs)) {
          if (!op || !op.operationId) continue;
          p.ops[op.operationId] = { path, verb, scope: op["x-hax-scope"] || api["x-hax-scope"] || "site", public: op["x-hax-public"] === true, security: op.security || api.security || [] };
        }
      }
      if (m.datastores) for (const s of readAny(join(dir, m.datastores)).stores) p.stores[s.id] = s;
      if (m.hookDefinitions) for (const h of readAny(join(dir, m.hookDefinitions))) p.hookDefs[h.name] = h;
      if (m.settings && existsSync(join(dir, m.settings))) for (const f of readAny(join(dir, m.settings)).configure || []) if (f.value !== undefined) p.settings[f.property] = f.value;
      Object.assign(p.settings, settings[m.id] || {});
      for (const [id, value] of Object.entries(stores[m.id] || {})) p.storeOverrides = { ...(p.storeOverrides || {}), [id]: value };
      if (this.runtime === "nodejs" && m.entry && m.entry.nodejs) {
        const mod = await import(pathToFileURL(join(dir, m.entry.nodejs)).href);
        p.entry = mod.default || mod;
      }
      this.plugins.push(p);
    }
    // dependencies before dependents, then required first, then id
    const rank = (p) => (p.manifest.required ? 0 : 1);
    this.plugins.sort((a, b) => ((b.manifest.dependencies || []).some((d) => d.split("@")[0] === a.id) ? -1 : (a.manifest.dependencies || []).some((d) => d.split("@")[0] === b.id) ? 1 : rank(a) - rank(b) || a.id.localeCompare(b.id)));
    // status: requirements (spec/06)
    for (const p of this.plugins) {
      const r = await this.fire("plugin.before.requirements", [], { only: p.id });
      p.unmet = r.subject || [];
      p.status = p.unmet.length ? "inactive" : "active";
    }
    return this;
  }

  status() {
    return this.plugins.map((p) => ({ id: p.id, status: p.status, unmet: p.unmet }));
  }

  active(id) {
    const p = this.plugins.find((x) => x.id === id);
    return !!p && p.status === "active";
  }

  hookContract(name) {
    return CORE_HOOKS.find((c) => c.name === name) || this.plugins.map((p) => p.hookDefs[name]).find(Boolean);
  }

  // ---- stores ----
  storeKey(p, id) {
    const s = p.stores[id];
    if (!s) throw new Error(`${p.id}: unknown store "${id}"`);
    return `${p.id}:${s.scope}:${s.scope === "site" || s.scope === "siteData" || s.scope === "manifest" ? this.site.id : "-"}:${id}`;
  }
  readStore(p, id) {
    const s = p.stores[id];
    if (!s) throw new Error(`${p.id}: unknown store "${id}"`);
    if (p.storeOverrides && id in p.storeOverrides) return structuredClone(p.storeOverrides[id]);
    if (s.scope === "package") return readAny(join(p.dir, "data", s.file));
    const v = this.memory.get(this.storeKey(p, id));
    return v === undefined ? null : structuredClone(v);
  }
  writeStore(p, id, value) {
    if (p.stores[id] && p.stores[id].scope === "package") throw new Error(`${p.id}: store "${id}" is read-only (package scope)`);
    this.memory.set(this.storeKey(p, id), structuredClone(value));
  }

  // ---- ctx (spec/13 section 4) ----
  makeCtx(p, extras = {}) {
    const backend = this;
    const warnings = [];
    const tx = extras.transaction || { id: "t1", origin: "harness", bulk: false, operations: [], marks: {} };
    tx.run = tx.run || (async (fn, opts = {}) => fn({ ...tx, ...opts })); // nested transactions join the outer one
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
      user: backend.user,
      log: Object.fromEntries(["info", "warn", "error"].map((level) => [level, (message, data) => backend.log.push({ level, plugin: p.id, message, data })])),
      fetch: async (url) => {
        const host = new URL(url).hostname;
        if (!(p.manifest.capabilities || []).includes("network:egress") || !(p.manifest.egress || []).includes(host)) throw new Error(`fetch to ${host} not allowed`);
        throw new Error("network is disabled in the harness");
      },
      pluginEnabled: (id) => backend.active(id),
      transaction: tx,
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

  // ---- invoking plugin code in the configured runtime ----
  async invoke(p, kind, name, ctx, args = []) {
    if (this.runtime === "nodejs") {
      const fn = kind === "operation" ? p.entry.operations && p.entry.operations[name] : kind === "hook" ? p.entry.hooks && p.entry.hooks[name] : p.entry[name];
      if (!fn) return { missing: true };
      return { value: await fn(ctx, ...args) };
    }
    // php: hand the plugin call to the bridge with the current state, then merge back what it changed
    const storeState = {};
    for (const id of Object.keys(p.stores)) if (p.stores[id].scope !== "package") storeState[id] = this.readStore(p, id);
    const input = {
      entry: join(p.dir, p.manifest.entry.php), class: studly(p.id), method: kind === "hook" ? camelHook(name) : name, args,
      pluginDir: p.dir, packageStores: Object.fromEntries(Object.values(p.stores).filter((s) => s.scope === "package").map((s) => [s.id, s.file])),
      overrides: p.storeOverrides || {},
      ctx: { subject: ctx.subject, previous: ctx.previous, settings: ctx.settings, haxcms: ctx.haxcms, plugin: ctx.plugin, site: ctx.site, user: ctx.user, transaction: { ...ctx.transaction, run: undefined }, stores: storeState, enabled: this.plugins.filter((x) => x.status === "active").map((x) => x.id) },
    };
    const r = spawnSync("php", [join(here, "php/bridge.php")], { input: JSON.stringify(input), encoding: "utf8" });
    if (r.status !== 0) throw new Error(`php bridge failed: ${r.stderr || r.stdout}`);
    const out = JSON.parse(r.stdout);
    if (out.missing) return { missing: true };
    for (const [id, v] of Object.entries(out.stores || {})) this.writeStore(p, id, v);
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
  subscribers(name, { entity, subject, previous, only } = {}) {
    const out = [];
    this.plugins.forEach((p, order) => {
      if (only && p.id !== only) return;
      if (p.status !== "active" && name !== "plugin.before.requirements" && name !== "plugin.after.requirements") return;
      for (const sub of p.manifest.hooks || []) {
        let matches = false;
        if (sub.name === name) matches = !sub.entities || !entity || sub.entities.includes(entity);
        else {
          const c = this.hookContract(sub.name);
          if (c && c.aliasOf) matches = c.aliasOf.some((a) => a.hook === name && (!a.entities || !entity || a.entities.includes(entity)) && (!a.changed || a.changed.some((path) => JSON.stringify(getPath(subject, path)) !== JSON.stringify(getPath(previous, path)))));
        }
        if (matches) out.push({ p, sub, order });
      }
    });
    return out.sort((a, b) => (b.sub.priority || 0) - (a.sub.priority || 0) || a.order - b.order);
  }

  async fire(name, subject, opts = {}) {
    let current = structuredClone(subject);
    const warnings = [];
    for (const { p, sub } of this.subscribers(name, { ...opts, subject })) {
      const ctx = this.makeCtx(p, { subject: structuredClone(current), previous: opts.previous, transaction: opts.transaction });
      try {
        const r = await this.invoke(p, "hook", sub.name, ctx);
        warnings.push(...ctx.__warnings);
        if (r.missing) continue;
        const v = r.value;
        if (v && v.__veto) return { subject: current, veto: { message: v.message, status: v.status || 409, plugin: p.id }, warnings, transaction: opts.transaction };
        if (v && v.__respond !== undefined) return { subject: current, respond: v.__respond, warnings };
        if (v !== undefined && v !== null) current = v;
      } catch (e) {
        this.log.push({ level: "error", plugin: p.id, message: `${sub.name}: ${e && e.message}` });
      }
    }
    return { subject: current, warnings, transaction: opts.transaction };
  }
}

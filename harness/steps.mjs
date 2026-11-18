// One step of an executable case, shared by plugin test cases (harness/run-cases.mjs) and spec conformance
// cases (conformance/run.mjs). Returns { out, errors }.
import { check } from "./expect.mjs";

// vars: values captured by earlier steps (`capture: { name: "body.token" }`), substituted into later steps as {{name}}
export async function step(backend, raw, vars = {}) {
  const s = JSON.parse(JSON.stringify(raw).replace(/\{\{\$(\w+)\}\}/g, (m, k) => (k in vars ? JSON.stringify(String(vars[k])).slice(1, -1) : m)));
  const out = {};
  const execFrom = (backend.execCalls || []).length;
  const fetchFrom = (backend.fetchCalls || []).length;
  if (s.call) Object.assign(out, await backend.call(s.call.operation, { params: s.call.params || {}, query: s.call.query || {}, body: s.call.body || {}, headers: s.call.headers || {} }, { credentials: s.call.credentials || "both", client: s.call.client || null }));
  // asset: what GET .../plugins/<id>/assets/<path> would answer (spec/07)
  else if (s.asset) { const r = await backend.asset(s.asset.plugin, s.asset.path); Object.assign(out, { status: r.status, body: r.status === 200 ? { type: r.type } : null }); }
  else if (s.fire) {
    const tx = s.fire.transaction ? { id: "t-fire", origin: s.fire.transaction.origin || "case", bulk: !!s.fire.transaction.bulk, operations: [], marks: {} } : undefined;
    const r = await backend.fire(s.fire.hook, s.fire.subject ?? null, { previous: s.fire.previous, entity: s.fire.entity, transaction: tx });
    Object.assign(out, { subject: r.subject, veto: r.veto || null, warnings: r.warnings || [], marks: tx ? tx.marks : backend.currentTx ? backend.currentTx.marks : undefined });
  } else if (s.render) Object.assign(out, await backend.render(s.render.page, s.render));
  else if (s.enable) Object.assign(out, await backend.enable(s.enable));
  else if (s.disable) Object.assign(out, await backend.disable(s.disable));
  else if (s.config) Object.assign(out, await backend.saveConfig(s.config.plugin, s.config.values));
  else if (s.upgrade) Object.assign(out, await backend.upgrade(s.upgrade.plugin, s.upgrade.from));
  else if (s.save) { const r = await backend.saveEntity(s.save.type, s.save.record); Object.assign(out, { subject: r.record, veto: r.veto || null, warnings: r.warnings || [] }); }
  else if (s.delete) { const r = await backend.deleteEntity(s.delete.type, s.delete.id); Object.assign(out, { body: { deleted: r.deleted }, veto: r.veto || null }); }
  // reload: a backend with durable storage re-reads its records from it (spec/13 section 9), so a case can check that
  // what is on disk matches; the in-memory reference has nothing to re-read
  else if (s.reload) { if (backend.reload) await backend.reload(); }
  else if (s.record) Object.assign(out, { subject: structuredClone((backend.records[s.record.type] || {})[s.record.id || backend.site.id] || null) });
  // registry: the plugin registry a backend serves (spec/03): status, needs, how it fits each target
  else if (s.registry) Object.assign(out, { status: 200, body: Object.fromEntries((await backend.registry()).map((e) => [e.id, e])) });
  // openapi: the contract a backend serves for its plugins (spec/13 section 5), for one plugin or all, as what a
  // case can check: each operation's verb and mounted path, and whether anything server-side leaked into it
  else if (s.openapi) {
    const o = s.openapi === true ? {} : s.openapi;
    const doc = await backend.unifiedContract({ ...(o.scope ? { scope: o.scope } : {}), ...(o.plugin ? { plugin: o.plugin } : {}) });
    const operations = {};
    let leaked = false;
    for (const [path, verbs] of Object.entries(doc.paths || {})) for (const [verb, op] of Object.entries(verbs)) { operations[op.operationId] = `${verb} ${path}`; if (op["x-hax-proxy"] !== undefined) leaked = true; }
    const none = Object.keys(operations).length === 0;
    Object.assign(out, o.plugin && none ? { status: 404, body: { error: "not found" } } : { status: 200, body: { title: doc.info.title, count: Object.keys(operations).length, operations, leaked } });
  }
  else if (s.advertised) Object.assign(out, { status: 200, body: await backend.advertisedContracts() });
  else if (s.siteFile) { const { existsSync } = await import("node:fs"); const { join } = await import("node:path"); Object.assign(out, { body: { exists: existsSync(join(backend.site.path, s.siteFile)) } }); }
  else if (s.rebuild) Object.assign(out, await backend.rebuild(s.rebuild.reason));
  else if (s.contract) {
    // input.files[].file: a path next to the case (tests/fixtures/...), read and sent as base64 like an upload
    let input = s.contract.input ?? {};
    if (Array.isArray(input.files) && input.files.some((f) => f && f.file)) {
      const { readFileSync } = await import("node:fs"); const { join, basename } = await import("node:path");
      input = { ...input, files: input.files.map((f) => { if (!f || !f.file) return f; const full = join(backend.caseDir || ".", f.file); const { file, ...rest } = f; void file; return { name: basename(full), ...rest, data: readFileSync(full).toString("base64") }; }) };
    }
    try { Object.assign(out, { status: 200, body: await backend.callContract(s.contract.name, s.contract.op, input, { only: s.contract.plugin }) }); } catch (e) { Object.assign(out, { status: 400, body: { error: e.message } }); }
  }
  else if (s.schedule) Object.assign(out, await backend.runSchedule(s.schedule.plugin, s.schedule.id));
  else if (s.importFile) {
    const f = { ...s.importFile };
    // file: a path next to the case (tests/fixtures/...), read and sent as base64 like an upload
    if (f.file) { const { readFileSync } = await import("node:fs"); const { join, basename } = await import("node:path"); const full = join(backend.caseDir || ".", f.file); f.data = readFileSync(full).toString("base64"); f.name = f.name || basename(full); delete f.file; }
    Object.assign(out, await backend.importFile(f));
  }
  // implementers: a contract name, or { name, surface } for what one surface (admin, cli, mcp) offers
  else if (s.implementers) Object.assign(out, { status: 200, body: await (typeof s.implementers === "string" ? backend.contractImplementers(s.implementers) : backend.contractImplementers(s.implementers.name, { surface: s.implementers.surface })) });
  // choices: what the contributions responses, the CLI and MCP offer on one surface for contracts the caller chooses
  else if (s.choices) Object.assign(out, { status: 200, body: await backend.contractChoices(s.choices) });
  else if (s.managed) Object.assign(out, { body: (backend.managed.get(s.managed) || {}).content ?? null, status: backend.managed.has(s.managed) ? 200 : 404 });
  else if (s.exportUser) Object.assign(out, await backend.exportUser(s.exportUser));
  else if (s.eraseUser) Object.assign(out, await backend.eraseUser(s.eraseUser));
  else if (s.asUser !== undefined && "asUser" in s) { backend.user = s.asUser; }
  else if (s.clock) { backend.now = Date.parse(s.clock); }
  else if (s.transaction) {
    let marks;
    await backend.transaction(async (tx) => { for (const inner of s.transaction.steps || []) { const r = await step(backend, inner, vars); if (r.errors.length) throw new Error(r.errors.join("; ")); } marks = tx.marks; }, { bulk: s.transaction.bulk !== false, origin: s.transaction.origin || "case" });
    out.marks = marks;
  }
  if (backend.flushLog) await backend.flushLog();
  out.statusOf = Object.fromEntries(backend.status().map((x) => [x.id, x.status]));
  out.log = backend.log;
  if (backend.execCalls && backend.execCalls.length > execFrom) out.exec = backend.execCalls.slice(execFrom);
  if (backend.fetchCalls && backend.fetchCalls.length > fetchFrom) out.fetch = backend.fetchCalls.slice(fetchFrom);
  // `capture: { code: "body.redirect ~ code=([^&]+)" }` keeps the first group of a regular expression over the value
  for (const [name, spec] of Object.entries(s.capture || {})) {
    const [path, re] = String(spec).split(" ~ ");
    const value = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), out);
    const m = re !== undefined && value != null ? new RegExp(re).exec(String(value)) : null;
    vars[name] = re === undefined ? value : m ? m[1] : undefined;
  }
  return { out, errors: check(out, s.expect || {}) };
}

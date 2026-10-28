// One step of an executable case, shared by plugin test cases (harness/run-cases.mjs) and spec conformance
// cases (conformance/run.mjs). Returns { out, errors }.
import { check } from "./expect.mjs";

// vars: values captured by earlier steps (`capture: { name: "body.token" }`), substituted into later steps as {{name}}
export async function step(backend, raw, vars = {}) {
  const s = JSON.parse(JSON.stringify(raw).replace(/\{\{\$(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]).replace(/"/g, '\\"') : m)));
  const out = {};
  const execFrom = (backend.execCalls || []).length;
  const fetchFrom = (backend.fetchCalls || []).length;
  if (s.call) Object.assign(out, await backend.call(s.call.operation, { params: s.call.params || {}, query: s.call.query || {}, body: s.call.body || {}, headers: s.call.headers || {} }, { credentials: s.call.credentials || "both" }));
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
  else if (s.record) Object.assign(out, { subject: structuredClone((backend.records[s.record.type] || {})[s.record.id || backend.site.id] || null) });
  else if (s.rebuild) Object.assign(out, await backend.rebuild(s.rebuild.reason));
  else if (s.contract) { try { Object.assign(out, { status: 200, body: await backend.callContract(s.contract.name, s.contract.op, s.contract.input ?? {}, { only: s.contract.plugin }) }); } catch (e) { Object.assign(out, { status: 400, body: { error: e.message } }); } }
  else if (s.schedule) Object.assign(out, await backend.runSchedule(s.schedule.plugin, s.schedule.id));
  else if (s.importFile) {
    const f = { ...s.importFile };
    // file: a path next to the case (tests/fixtures/...), read and sent as base64 like an upload
    if (f.file) { const { readFileSync } = await import("node:fs"); const { join, basename } = await import("node:path"); const full = join(backend.caseDir || ".", f.file); f.data = readFileSync(full).toString("base64"); f.name = f.name || basename(full); delete f.file; }
    Object.assign(out, await backend.importFile(f));
  }
  else if (s.implementers) Object.assign(out, { status: 200, body: backend.contractImplementers(s.implementers) });
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
  for (const [name, path] of Object.entries(s.capture || {})) vars[name] = path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), out);
  return { out, errors: check(out, s.expect || {}) };
}

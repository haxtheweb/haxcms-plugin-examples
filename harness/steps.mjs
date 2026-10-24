// One step of an executable case, shared by plugin test cases (harness/run-cases.mjs) and spec conformance
// cases (conformance/run.mjs). Returns { out, errors }.
import { check } from "./expect.mjs";

export async function step(backend, s) {
  const out = {};
  if (s.call) Object.assign(out, await backend.call(s.call.operation, { params: s.call.params || {}, query: s.call.query || {}, body: s.call.body || {} }, { credentials: s.call.credentials || "both" }));
  else if (s.fire) {
    const tx = s.fire.transaction ? { id: "t-fire", origin: s.fire.transaction.origin || "case", bulk: !!s.fire.transaction.bulk, operations: [], marks: {} } : undefined;
    const r = await backend.fire(s.fire.hook, s.fire.subject ?? null, { previous: s.fire.previous, entity: s.fire.entity, transaction: tx });
    Object.assign(out, { subject: r.subject, veto: r.veto || null, warnings: r.warnings || [], marks: tx ? tx.marks : backend.currentTx ? backend.currentTx.marks : undefined });
  } else if (s.render) Object.assign(out, await backend.render(s.render.page, s.render));
  else if (s.enable) Object.assign(out, await backend.enable(s.enable));
  else if (s.disable) Object.assign(out, await backend.disable(s.disable));
  else if (s.config) Object.assign(out, await backend.saveConfig(s.config.plugin, s.config.values));
  else if (s.upgrade) Object.assign(out, await backend.upgrade(s.upgrade.plugin, s.upgrade.from));
  else if (s.save) { const r = await backend.saveEntity(s.save.type, s.save.record); Object.assign(out, { subject: r.record, veto: r.veto || null }); }
  else if (s.record) Object.assign(out, { subject: structuredClone((backend.records[s.record.type] || {})[s.record.id || backend.site.id] || null) });
  else if (s.rebuild) Object.assign(out, await backend.rebuild(s.rebuild.reason));
  else if (s.contract) Object.assign(out, { body: await backend.callContract(s.contract.name, s.contract.op, s.contract.input ?? {}, { only: s.contract.plugin }) });
  else if (s.managed) Object.assign(out, { body: (backend.managed.get(s.managed) || {}).content ?? null, status: backend.managed.has(s.managed) ? 200 : 404 });
  else if (s.exportUser) Object.assign(out, { body: backend.exportUser(s.exportUser) });
  else if (s.eraseUser) Object.assign(out, { body: backend.eraseUser(s.eraseUser) });
  else if (s.asUser) { backend.user = s.asUser; }
  else if (s.transaction) {
    let marks;
    await backend.transaction(async (tx) => { for (const inner of s.transaction.steps || []) { const r = await step(backend, inner); if (r.errors.length) throw new Error(r.errors.join("; ")); } marks = tx.marks; }, { bulk: s.transaction.bulk !== false, origin: s.transaction.origin || "case" });
    out.marks = marks;
  }
  if (backend.flushLog) await backend.flushLog();
  out.statusOf = Object.fromEntries(backend.status().map((x) => [x.id, x.status]));
  out.log = backend.log;
  return { out, errors: check(out, s.expect || {}) };
}

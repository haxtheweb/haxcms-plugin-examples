// Shared expectation checks for executable cases (plugin tests and spec conformance).
export function subset(got, want, path = "") {
  if (want === null || typeof want !== "object") return Object.is(got, want) || got === want ? null : `${path || "value"}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`;
  if (got === null || typeof got !== "object") return `${path || "value"}: expected an object, got ${JSON.stringify(got)}`;
  for (const k of Object.keys(want)) { const e = subset(got[k], want[k], path ? `${path}.${k}` : k); if (e) return e; }
  return null;
}
export const hasKey = (v, key) => !!v && typeof v === "object" && (key in v || Object.values(v).some((x) => hasKey(x, key)));
// PHP cannot tell [] from {}; compare with empty objects and arrays treated alike
export const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) && !Object.keys(x).length ? [] : x));

// out: { status, body, subject, veto, marks, html, cached, statusOf, log }
export function check(out, e = {}) {
  const errors = [];
  const target = out.html !== undefined ? out.html : out.body !== undefined ? out.body : out.subject;
  const text = typeof target === "string" ? target : JSON.stringify(target);
  if (e.status !== undefined && out.status !== e.status) errors.push(`status ${out.status}, expected ${e.status}`);
  if (e.body !== undefined) { const m = subset(out.body, e.body, "body"); if (m) errors.push(m); }
  if (e.subject !== undefined) { const m = subset(out.subject, e.subject, "subject"); if (m) errors.push(m); }
  for (const k of e.absent || []) if (hasKey(target, k)) errors.push(`"${k}" should be absent`);
  for (const s of e.contains || []) if (!String(text).includes(s)) errors.push(`should contain ${JSON.stringify(s)}`);
  for (const s of e.notContains || []) if (String(text).includes(s)) errors.push(`should not contain ${JSON.stringify(s)}`);
  if (e.veto !== undefined && !!out.veto !== e.veto) errors.push(e.veto ? "expected a veto" : `unexpected veto: ${out.veto && out.veto.message}`);
  if (e.message !== undefined) { const msg = (out.veto && out.veto.message) || (out.body && out.body.error) || ""; if (!String(msg).includes(e.message)) errors.push(`message ${JSON.stringify(msg)} does not include ${JSON.stringify(e.message)}`); }
  if (e.marks !== undefined) { const m = subset(out.marks || {}, e.marks, "marks"); if (m) errors.push(m); }
  if (e.cached !== undefined && !!out.cached !== e.cached) errors.push(`cached ${!!out.cached}, expected ${e.cached}`);
  if (e.status_of !== undefined) { const m = subset(out.statusOf, e.status_of, "status"); if (m) errors.push(m); }
  if (e.log) {
    const lines = (out.log || []).map((l) => `${l.level}: ${l.message}`);
    const all = lines.join("\n");
    for (const s of e.log.contains || []) if (!all.includes(s)) errors.push(`log should contain ${JSON.stringify(s)}`);
    for (const s of e.log.notContains || []) if (all.includes(s)) errors.push(`log should not contain ${JSON.stringify(s)}`);
    if (e.log.order) { let i = -1; for (const s of e.log.order) { const j = lines.findIndex((l, k) => k > i && l.includes(s)); if (j < 0) { errors.push(`log order: ${JSON.stringify(s)} missing or out of order`); break; } i = j; } }
    for (const [s, n] of Object.entries(e.log.count || {})) { const c = lines.filter((l) => l.includes(s)).length; if (c !== n) errors.push(`log "${s}" appears ${c} times, expected ${n}`); }
  }
  if (e.exec) {
    const calls = JSON.stringify(out.exec || []);
    if (e.exec.count !== undefined && (out.exec || []).length !== e.exec.count) errors.push(`exec ran ${(out.exec || []).length} times, expected ${e.exec.count}`);
    for (const s of e.exec.contains || []) if (!calls.includes(s)) errors.push(`exec calls should contain ${JSON.stringify(s)}`);
    for (const s of e.exec.notContains || []) if (calls.includes(s)) errors.push(`exec calls should not contain ${JSON.stringify(s)}`);
  }
  for (const w of e.warnings || []) if (!(out.warnings || []).some((x) => String(x.message).includes(w))) errors.push(`warnings should include ${JSON.stringify(w)}`);
  if (e.errors) for (const s of e.errors) if (!(out.errors || []).some((x) => x.includes(s))) errors.push(`validator should report ${JSON.stringify(s)} (got ${JSON.stringify(out.errors)})`);
  return errors;
}

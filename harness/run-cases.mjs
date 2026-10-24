#!/usr/bin/env node
// hax-plugin-test: run a plugin's executable test cases (tests/cases/*.yaml with a `run` block) through the
// reference harness, in Node, in PHP, or both. With both, every case must also give the same result in each.
// Usage: node harness/run-cases.mjs <plugin folder> [--runtime nodejs|php|both] [--json]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { MemoryBackend } from "./memory-backend.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith("--")) || ".");
const runtimeArg = (args.find((a) => a.startsWith("--runtime=")) || "").split("=")[1] || (args.includes("--runtime") ? args[args.indexOf("--runtime") + 1] : "both");
const asJson = args.includes("--json");
const manifest = parse(readFileSync(join(dir, "plugin.yaml"), "utf8"));
const hasPhp = spawnSync("php", ["-v"]).status === 0;
let runtimes = runtimeArg === "both" ? (manifest.runtimes || ["nodejs"]) : [runtimeArg];
const skipped = [];
if (runtimes.includes("php") && !hasPhp) { runtimes = runtimes.filter((r) => r !== "php"); skipped.push("php (not installed)"); }

// deep subset: every key/element in `want` must match `got`
function subset(got, want, path = "") {
  if (want === null || typeof want !== "object") return Object.is(got, want) || got === want ? null : `${path || "value"}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`;
  if (got === null || typeof got !== "object") return `${path || "value"}: expected an object, got ${JSON.stringify(got)}`;
  for (const k of Object.keys(want)) { const e = subset(got[k], want[k], path ? `${path}.${k}` : k); if (e) return e; }
  return null;
}
const hasKey = (v, key) => v && typeof v === "object" && (key in v || Object.values(v).some((x) => hasKey(x, key)));
// PHP cannot tell [] from {}; compare with empty objects and arrays treated alike
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) && !Object.keys(x).length ? [] : x));

async function runCase(c, runtime) {
  const r = c.run;
  const backend = new MemoryBackend({ haxcmsVersion: r.haxcmsVersion || "26.10.1", runtime });
  await backend.load([dir, ...(r.with || []).map((w) => join(root, w))], { settings: { [manifest.id]: r.settings || {} }, stores: { [manifest.id]: r.stores || {} } });
  const out = { statusOf: Object.fromEntries(backend.status().map((s) => [s.id, s.status])) };
  if (r.call) {
    const res = await backend.call(r.call.operation, { params: r.call.params || {}, query: r.call.query || {}, body: r.call.body || {} }, { credentials: r.call.credentials || "both" });
    Object.assign(out, { status: res.status, body: res.body });
  } else if (r.fire) {
    const tx = r.fire.transaction ? { id: "t1", origin: r.fire.transaction.origin || "harness", bulk: !!r.fire.transaction.bulk, operations: [], marks: {} } : undefined;
    const res = await backend.fire(r.fire.hook, r.fire.subject ?? null, { previous: r.fire.previous, entity: r.fire.entity, transaction: tx });
    Object.assign(out, { subject: res.subject, veto: res.veto || null, marks: tx ? tx.marks : undefined });
  }
  const e = r.expect || {};
  const errors = [];
  const subjectOrBody = out.body !== undefined ? out.body : out.subject;
  if (e.status !== undefined && out.status !== e.status) errors.push(`status ${out.status}, expected ${e.status}`);
  if (e.body !== undefined) { const m = subset(out.body, e.body, "body"); if (m) errors.push(m); }
  if (e.subject !== undefined) { const m = subset(out.subject, e.subject, "subject"); if (m) errors.push(m); }
  for (const k of e.absent || []) if (hasKey(subjectOrBody, k)) errors.push(`"${k}" should be absent`);
  for (const s of e.contains || []) if (!JSON.stringify(subjectOrBody).includes(s)) errors.push(`should contain ${JSON.stringify(s)}`);
  for (const s of e.notContains || []) if (JSON.stringify(subjectOrBody).includes(s)) errors.push(`should not contain ${JSON.stringify(s)}`);
  if (e.veto !== undefined && !!out.veto !== e.veto) errors.push(e.veto ? "expected a veto" : `unexpected veto: ${out.veto && out.veto.message}`);
  if (e.message !== undefined) { const msg = (out.veto && out.veto.message) || (out.body && out.body.error) || ""; if (!msg.includes(e.message)) errors.push(`message ${JSON.stringify(msg)} does not include ${JSON.stringify(e.message)}`); }
  if (e.marks !== undefined) { const m = subset(out.marks || {}, e.marks, "marks"); if (m) errors.push(m); }
  if (e.status_of !== undefined) { const m = subset(out.statusOf, e.status_of, "status"); if (m) errors.push(m); }
  return { out, errors };
}

const results = [];
const casesDir = join(dir, "tests/cases");
const files = existsSync(casesDir) ? readdirSync(casesDir).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
for (const f of files) {
  const cases = parse(readFileSync(join(casesDir, f), "utf8")) || [];
  for (const c of cases) {
    if (!c.run) continue;
    const rts = runtimes.filter((rt) => !c.runtimes || c.runtimes.includes(rt));
    const per = {};
    for (const rt of rts) {
      try { per[rt] = await runCase(c, rt); } catch (err) { per[rt] = { out: null, errors: [String(err && err.stack || err)] }; }
      results.push({ id: c.id, runtime: rt, ok: !per[rt].errors.length, errors: per[rt].errors });
    }
    if (rts.length === 2 && per.nodejs.out && per.php.out) {
      const a = canon(per.nodejs.out), b = canon(per.php.out);
      results.push({ id: c.id, runtime: "parity", ok: a === b, errors: a === b ? [] : [`nodejs ${a.slice(0, 300)}\n      php    ${b.slice(0, 300)}`] });
    }
  }
}
const failed = results.filter((r) => !r.ok);
if (asJson) console.log(JSON.stringify({ plugin: manifest.id, runtimes, skipped, results }, null, 2));
else {
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${manifest.id} ${r.id} [${r.runtime}]${r.ok ? "" : "\n      " + r.errors.join("\n      ")}`);
  for (const s of skipped) console.log(`skip ${manifest.id} ${s}`);
  console.log(`${failed.length ? "FAIL" : "ok  "} ${manifest.id}: ${results.length - failed.length}/${results.length} executable checks passed`);
}
process.exit(failed.length ? 1 : 0);

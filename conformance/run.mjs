#!/usr/bin/env node
// Runs the executable spec conformance cases (conformance/cases/*.yaml with a `run` block) against the
// reference harness. A real backend runs the same cases through its own adapter (spec/13 section 9).
// Usage: node conformance/run.mjs [--json] [--case <id>] [--runtime nodejs|php] [--backend <adapter module>]
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { MemoryBackend } from "../harness/memory-backend.mjs";
import { check } from "../harness/expect.mjs";
import { step } from "../harness/steps.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const backendArg = args.includes("--backend") ? args[args.indexOf("--backend") + 1] : null;
const backendFactory = backendArg ? await import((await import("node:url")).pathToFileURL((await import("node:path")).resolve(backendArg)).href) : null;
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
// --runtime php runs the fixtures' PHP entries (through harness/php/bridge.php in the reference); default nodejs
const runtime = args.includes("--runtime") ? args[args.indexOf("--runtime") + 1] : "nodejs";
const fx = (p) => (typeof p === "string" ? join(root, p.includes("/") ? p : `conformance/fixtures/${p}`) : { ...p, path: join(root, p.path.includes("/") ? p.path : `conformance/fixtures/${p.path}`) });

async function runCase(c) {
  const r = c.run;
  if (r.validate) {
    const res = spawnSync(process.execPath, [join(root, "scripts/validate.mjs"), "--json", fx(r.validate)], { encoding: "utf8" });
    const report = JSON.parse(res.stdout)[0];
    const out = { errors: report.errors.map((e) => `${e.path}: ${e.message}`) };
    const errs = check(out, r.expect || {});
    if (r.expect && r.expect.valid === false && !out.errors.length) errs.push("expected the validator to reject it");
    return errs;
  }
  // system: true runs the case on the system engine (no site; spec/13 section 9)
  const opts = { haxcmsVersion: r.haxcmsVersion || "26.10.1", hookTimeout: r.hookTimeout || 5000, runtime, ...(r.user ? { user: r.user } : {}), ...(r.target ? { target: r.target } : {}), ...(r.system ? { site: null } : {}) };
  // --backend <module>: a real backend's adapter (spec/13 section 9) exporting createBackend(opts); default is the reference
  const backend = backendFactory ? await backendFactory.createBackend(opts) : new MemoryBackend(opts);
  // a case may hold for one runtime only (`runtimes: [php]`); the backend says which runtime it is
  const backendRuntime = backend.runtime || runtime;
  if (c.runtimes && !c.runtimes.includes(backendRuntime)) {
    if (backend.close) backend.close();
    return null;
  }
  await backend.load((r.plugins || []).map(fx), r.load || {});
  backend.execFakes = r.exec || {};
  backend.fetchFakes = r.fetch || {};
  backend.urlAliases = r.urlAliases || [];
  if (r.now) backend.now = Date.parse(r.now);
  const errors = [];
  if (r.expect) errors.push(...check({ statusOf: Object.fromEntries(backend.status().map((x) => [x.id, x.status])), log: backend.log }, r.expect));
  const vars = {};
  for (const [i, s] of (r.steps || []).entries()) { const res = await step(backend, s, vars); errors.push(...res.errors.map((e) => `step ${i + 1}: ${e}`)); }
  return errors;
}

let executable = 0, prose = 0, failed = 0, skipped = 0;
const results = [];
for (const f of readdirSync(join(root, "conformance/cases")).filter((n) => n.endsWith(".yaml")).sort()) {
  for (const c of parse(readFileSync(join(root, "conformance/cases", f), "utf8"))) {
    if (only && c.id !== only) continue;
    if (!c.run) { prose++; continue; }
    executable++;
    let errors;
    try { errors = await runCase(c); } catch (e) { errors = [String(e && e.stack || e)]; }
    if (errors === null) { executable--; skipped++; continue; }
    if (errors.length) failed++;
    results.push({ id: c.id, ok: !errors.length, errors });
  }
}
if (args.includes("--json")) console.log(JSON.stringify({ executable, prose, failed, skipped, results }, null, 2));
else {
  for (const r of results) if (!r.ok) console.log(`FAIL ${r.id}\n      ${r.errors.join("\n      ")}`);
  console.log(`${failed ? "FAIL" : "ok  "} conformance: ${executable - failed}/${executable} executable cases pass against ${backendArg ? backendArg : "the reference harness"}${skipped ? ` (${skipped} for another runtime)` : ""}; ${prose} still prose only`);
}
process.exit(failed ? 1 : 0);

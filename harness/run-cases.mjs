#!/usr/bin/env node
// hax-plugin-test: run a plugin's executable test cases (tests/cases/*.yaml with a `run` block) through the
// reference harness, in Node, in PHP, or both. With both, every case must also give the same result in each.
// Usage: node harness/run-cases.mjs <plugin folder> [--runtime nodejs|php|both] [--target <target>] [--json [--outputs]] [--backend <adapter module>]
// --target runs the cases as that deployment target (spec/14); a case written for one target (run.target) runs only there.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parse } from "yaml";
import { MemoryBackend } from "./memory-backend.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const backendArg = args.includes("--backend") ? args[args.indexOf("--backend") + 1] : null;
const backendFactory = backendArg ? await import((await import("node:url")).pathToFileURL((await import("node:path")).resolve(backendArg)).href) : null;
const dir = resolve(args.find((a, i) => !a.startsWith("--") && !["--backend", "--runtime", "--target"].includes(args[i - 1])) || ".");
const targetArg = args.includes("--target") ? args[args.indexOf("--target") + 1] : null;
const runtimeArg = (args.find((a) => a.startsWith("--runtime=")) || "").split("=")[1] || (args.includes("--runtime") ? args[args.indexOf("--runtime") + 1] : "both");
const asJson = args.includes("--json");
// --outputs (with --json): include every case's step outputs, so two backends can be compared case by case
const withOutputs = args.includes("--outputs");
const manifest = parse(readFileSync(join(dir, "plugin.yaml"), "utf8"));
const hasPhp = spawnSync("php", ["-v"]).status === 0;
let runtimes = runtimeArg === "both" ? (manifest.runtimes || ["nodejs"]) : [runtimeArg];
const skipped = [];
if (runtimes.includes("php") && !hasPhp) { runtimes = runtimes.filter((r) => r !== "php"); skipped.push("php (not installed)"); }

import { canon } from "./expect.mjs";
import { backendNeeds, targetSummary } from "../scripts/backend-needs.mjs";

// With --target: a case that brings other plugins along (run.with) and fails on a target one of them cannot run
// on says nothing about this plugin there, so it is listed as not run instead of failed. A case that passes
// anyway counts. Returns the first companion that cannot run on the target, or null.
const notRun = [];
function companionThatCannotRun(c) {
  if (!targetArg) return null;
  for (const w of c.run.with || []) {
    try {
      const d = join(root, w);
      const m = parse(readFileSync(join(d, "plugin.yaml"), "utf8"));
      const f = m.openapi && existsSync(join(d, m.openapi)) ? join(d, m.openapi) : null;
      const api = f ? (f.endsWith(".json") ? JSON.parse(readFileSync(f, "utf8")) : parse(readFileSync(f, "utf8"))) : null;
      if (targetSummary(m, backendNeeds(m, api))[targetArg] === "no") return m.id || w;
    } catch { /* the load reports a companion that cannot be read */ }
  }
  return null;
}
import { step } from "./steps.mjs";

async function runCase(c, runtime) {
  const r = c.run;
  const opts = { haxcmsVersion: r.haxcmsVersion || "26.10.1", runtime, ...(r.user ? { user: r.user } : {}), ...(r.target || targetArg ? { target: r.target || targetArg } : {}) };
  // --backend <module>: a real backend's adapter (spec/13 section 9) exporting createBackend(opts); default is the reference
  const backend = backendFactory ? await backendFactory.createBackend(opts) : new MemoryBackend(opts);
  await backend.load([dir, ...(r.with || []).map((w) => join(root, w))], { settings: { [manifest.id]: r.settings || {} }, stores: { [manifest.id]: r.stores || {} }, records: r.records });
  backend.execFakes = r.exec || {};
  backend.caseDir = dir;
  backend.fetchFakes = r.fetch || {};
  backend.urlAliases = r.urlAliases || [];
  if (r.now) backend.now = Date.parse(r.now);
  // a single call/fire with expect, or a list of steps each with its own expect
  const steps = r.steps || [{ ...(r.call ? { call: r.call } : {}), ...(r.fire ? { fire: r.fire } : {}), expect: r.expect || {} }];
  const errors = [];
  const outs = [];
  const vars = {};
  for (const [i, s] of steps.entries()) {
    const res = await step(backend, s, vars);
    errors.push(...res.errors.map((e) => (steps.length > 1 ? `step ${i + 1}: ${e}` : e)));
    const { log, statusOf, ...rest } = res.out;
    outs.push(rest);
  }
  return { out: outs, errors };
}

const results = [];
const casesDir = join(dir, "tests/cases");
const files = existsSync(casesDir) ? readdirSync(casesDir).filter((f) => /\.ya?ml$/.test(f)).sort() : [];
for (const f of files) {
  const cases = parse(readFileSync(join(casesDir, f), "utf8")) || [];
  for (const c of cases) {
    if (!c.run) continue;
    if (targetArg && c.run.target && c.run.target !== targetArg) continue;
    const blocked = companionThatCannotRun(c);
    const rts = runtimes.filter((rt) => !c.runtimes || c.runtimes.includes(rt));
    const per = {};
    for (const rt of rts) {
      try { per[rt] = await runCase(c, rt); } catch (err) { per[rt] = { out: null, errors: [String(err && err.stack || err)] }; }
      if (blocked && per[rt].errors.length) { notRun.push({ id: c.id, runtime: rt, reason: `needs ${blocked}, which cannot run on the ${targetArg} target` }); continue; }
      // outputs leave out the case's parityIgnore keys (values that legitimately differ per run: tokens, commit hashes)
      results.push({ id: c.id, runtime: rt, ok: !per[rt].errors.length, errors: per[rt].errors, ...(withOutputs ? { out: JSON.parse(JSON.stringify(per[rt].out, (k, x) => ((c.parityIgnore || []).includes(k) ? undefined : x))) } : {}) });
    }
    if (rts.length === 2 && per.nodejs.out && per.php.out) {
      const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => ((c.parityIgnore || []).includes(k) ? undefined : x)));
      const a = canon(strip(per.nodejs.out)), b = canon(strip(per.php.out));
      results.push({ id: c.id, runtime: "parity", ok: a === b, errors: a === b ? [] : [`nodejs ${a.slice(0, 300)}\n      php    ${b.slice(0, 300)}`] });
    }
  }
}
const failed = results.filter((r) => !r.ok);
if (asJson) console.log(JSON.stringify({ plugin: manifest.id, runtimes, skipped, ...(targetArg ? { target: targetArg, notRun } : {}), results }, null, 2));
else {
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${manifest.id} ${r.id} [${r.runtime}]${r.ok ? "" : "\n      " + r.errors.join("\n      ")}`);
  for (const s of skipped) console.log(`skip ${manifest.id} ${s}`);
  for (const n of notRun) console.log(`skip ${manifest.id} ${n.id}: ${n.reason}`);
  console.log(`${failed.length ? "FAIL" : "ok  "} ${manifest.id}: ${results.length - failed.length}/${results.length} executable checks passed`);
}
// exitCode, not exit(): a long --json report written to a pipe is cut off when the process exits at once
process.exitCode = failed.length ? 1 : 0;

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

import { canon } from "./expect.mjs";
import { step } from "./steps.mjs";

async function runCase(c, runtime) {
  const r = c.run;
  const backend = new MemoryBackend({ haxcmsVersion: r.haxcmsVersion || "26.10.1", runtime, ...(r.user ? { user: r.user } : {}) });
  await backend.load([dir, ...(r.with || []).map((w) => join(root, w))], { settings: { [manifest.id]: r.settings || {} }, stores: { [manifest.id]: r.stores || {} }, records: r.records });
  // a single call/fire with expect, or a list of steps each with its own expect
  const steps = r.steps || [{ ...(r.call ? { call: r.call } : {}), ...(r.fire ? { fire: r.fire } : {}), expect: r.expect || {} }];
  const errors = [];
  const outs = [];
  for (const [i, s] of steps.entries()) {
    const res = await step(backend, s);
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
    const rts = runtimes.filter((rt) => !c.runtimes || c.runtimes.includes(rt));
    const per = {};
    for (const rt of rts) {
      try { per[rt] = await runCase(c, rt); } catch (err) { per[rt] = { out: null, errors: [String(err && err.stack || err)] }; }
      results.push({ id: c.id, runtime: rt, ok: !per[rt].errors.length, errors: per[rt].errors });
    }
    if (rts.length === 2 && per.nodejs.out && per.php.out) {
      const strip = (v) => JSON.parse(JSON.stringify(v, (k, x) => ((c.parityIgnore || []).includes(k) ? undefined : x)));
      const a = canon(strip(per.nodejs.out)), b = canon(strip(per.php.out));
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

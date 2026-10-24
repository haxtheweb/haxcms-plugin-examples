// Runs each example plugin's own tests: Node unit tests (tests/nodejs/*.test.mjs) and, when the plugin ships both
// parity runners and PHP is installed, compares Node and PHP output for tests/parity-calls.json.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;
const hasPhp = spawnSync("php", ["-v"]).status === 0;
for (const name of [...readdirSync(join(root, "examples")).map((n) => `examples/${n}`), ...readdirSync(join(root, "core-plugins")).map((n) => `core-plugins/${n}`)]) {
  const dir = join(root, name);
  const nodeTests = join(dir, "tests/nodejs");
  if (existsSync(nodeTests)) {
    const files = readdirSync(nodeTests).filter((f) => f.endsWith(".test.mjs")).map((f) => join(nodeTests, f));
    if (files.length) {
      const r = spawnSync(process.execPath, ["--test", ...files], { encoding: "utf8" });
      const ok = r.status === 0;
      if (!ok) { failures++; console.log(r.stdout.split("\n").filter((l) => /not ok|Error|expected|actual/.test(l)).slice(0, 20).join("\n")); }
      console.log(`${ok ? "ok  " : "FAIL"} ${name}: node tests (${(r.stdout.match(/^# pass (\d+)/m) || [])[1] || 0} passed)`);
    }
  }
  const nodeParity = join(dir, "tests/nodejs/run-parity.mjs");
  const phpParity = join(dir, "tests/php/run-parity.php");
  if (existsSync(nodeParity) && existsSync(phpParity)) {
    if (!hasPhp) { console.log(`skip ${name}: parity (php not installed)`); continue; }
    const n = JSON.parse(execFileSync(process.execPath, [nodeParity], { encoding: "utf8" }));
    const p = JSON.parse(execFileSync("php", [phpParity], { encoding: "utf8" }));
    const diffs = n.map((v, i) => (isDeepStrictEqual(v, p[i]) ? null : i)).filter((i) => i !== null);
    if (diffs.length || n.length !== p.length) failures++;
    console.log(`${diffs.length ? "FAIL" : "ok  "} ${name}: node/php parity (${n.length} calls${diffs.length ? `, differ at ${diffs.join(", ")}` : ""})`);
  }
}
// executable cases through the reference harness (Node and PHP, plus parity)
for (const name of [...readdirSync(join(root, "examples")).map((n) => `examples/${n}`), ...readdirSync(join(root, "core-plugins")).map((n) => `core-plugins/${n}`)]) {
  const dir = join(root, name);
  if (!existsSync(join(dir, "tests/cases"))) continue;
  const r = spawnSync(process.execPath, [join(root, "harness/run-cases.mjs"), dir], { encoding: "utf8" });
  const summary = r.stdout.trim().split("\n").pop();
  if (r.status !== 0) { failures++; console.log(r.stdout.split("\n").filter((l) => l.startsWith("FAIL") || l.startsWith("      ")).join("\n")); }
  console.log(summary.replace(/^(ok  |FAIL) /, `$1harness: `));
}
process.exit(failures ? 1 : 0);

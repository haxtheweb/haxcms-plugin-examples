#!/usr/bin/env node
// Proves each hax-plugin-check gate catches what it should: runs the checker on
// harness/check/fixtures/broken-plugin (which breaks every gate on purpose) and
// requires each expected failure. A layer whose tool is missing here (no PHP,
// no Chrome) is reported as skipped instead of asserted. Part of `npm test`.
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "broken-plugin");
const r = spawnSync(process.execPath, [join(here, "run.mjs"), "--json", fixture], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const report = JSON.parse(r.stdout)[0];

const expected = {
  manifest: ["not-the-folder-name"],
  node: ["Optional chaining", "'unused' is assigned"],
  php: ["broken_plugin_no_such_function"],
  frontend: ["broken-low-contrast: [light] axe color-contrast", "broken-dark-ignored: ignores dark mode", "broken-spinning: [reduced motion]", "broken-throws: [light] uncaught error"],
};
let failed = 0;
if (r.status !== 1 || report.ok) {
  console.log("FAIL the checker passed a plugin that breaks every gate");
  failed++;
}
for (const [layer, needles] of Object.entries(expected)) {
  const l = report.layers[layer];
  if (l.status === "skip") {
    console.log(`skip ${layer}: ${l.notes.join("; ")}`);
    continue;
  }
  const text = l.errors.join("\n");
  const missing = needles.filter((n) => !text.includes(n));
  if (l.status !== "fail" || missing.length) {
    failed++;
    console.log(`FAIL ${layer}: expected it to catch ${missing.map((m) => JSON.stringify(m)).join(", ") || "a failure"}; got ${l.status}\n${text}`);
  } else console.log(`ok   ${layer}: caught ${needles.length} problem(s)`);
}
process.exit(failed ? 1 : 0);

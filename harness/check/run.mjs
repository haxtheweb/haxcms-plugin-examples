#!/usr/bin/env node
// hax-plugin-check: every check a plugin needs, in one command.
//
// A plugin can carry code for three places at once: src/nodejs runs in
// haxcms-nodejs, src/php runs in haxcms-php, and frontend/dist ships web
// components to the browser like the webcomponents repo. This runs the same
// kinds of checks those three repositories run, on whichever parts the plugin
// has, plus the plugin's own contract:
//
//   manifest  is it a valid plugin? scripts/validate.mjs (hax-plugin-validate):
//             plugin.yaml, registries, haxProperties, hook docblocks
//   cases     its executable cases (tests/cases) through the reference harness,
//             in Node and PHP, with Node/PHP parity
//   node      ESLint with haxcms-nodejs's rules, its node --test files, and its
//             Node/PHP parity runners when it has them
//   php       php -l and PHPStan level 5, like haxcms-php (new errors block;
//             known ones are in harness/check/phpstan-baseline.neon)
//   frontend  its web components in Chrome: load, axe (WCAG 2.0/2.1 AA, incl.
//             contrast) in light and dark, dark mode, reduced motion, with
//             ESLint's webcomponents rules (harness/check/frontend.mjs)
//   live      only with --haxcms <haxcms-nodejs checkout>: installs it into a
//             real running haxcms-nodejs, creates a real site and checks it over
//             HTTP (harness/check/live-nodejs.cjs)
//
// Usage:
//   hax-plugin-check [options] [<plugin folder> ...]     (default: every plugin in this repo)
//     --only manifest,cases,node,php,frontend,live      run some layers
//     --haxcms <path>                                   a haxcms-nodejs with the plugin platform: adds "live"
//     --json                                            machine-readable report
//
// A layer the plugin has nothing for is "skip"; a layer whose tool is missing
// here (no PHP, no Chrome) is "skip" with the reason, and CI installs both.
// Exit code 1 when any layer fails.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const LAYERS = ["manifest", "cases", "node", "php", "frontend", "live"];

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const asJson = args.includes("--json");
const haxcms = opt("--haxcms") ? resolve(opt("--haxcms")) : null;
const only = opt("--only") ? opt("--only").split(",").map((s) => s.trim()) : null;
for (const l of only || []) if (!LAYERS.includes(l)) usage(`unknown layer "${l}" (layers: ${LAYERS.join(", ")})`);
const valued = new Set(["--only", "--haxcms"]);
let targets = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1])).map((p) => resolve(p));
if (!targets.length) {
  targets = ["examples", "core-plugins", "contrib-plugins"].flatMap((t) =>
    readdirSync(join(root, t)).map((n) => join(root, t, n)).filter((d) => existsSync(join(d, "plugin.yaml"))),
  );
}
for (const t of targets) if (!existsSync(join(t, "plugin.yaml"))) usage(`${t} has no plugin.yaml`);

const hasPhp = spawnSync("php", ["-v"]).status === 0;
const chrome = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p));
const wanted = (layer) => (only ? only.includes(layer) : layer !== "live" || !!haxcms);

function usage(message) {
  console.error(message);
  console.error("usage: hax-plugin-check [--only <layers>] [--haxcms <haxcms-nodejs checkout>] [--json] [<plugin folder> ...]");
  process.exit(2);
}

const files = (dir, test) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n === "vendor") return [];
    return statSync(p).isDirectory() ? files(p, test) : test(n) ? [p] : [];
  });
};
// ESLint (and the browser tools) are development dependencies of the spec package: loaded only when a layer
// needs them, so the other layers still run where they are not installed.
let eslintTools;
async function lint(dir, paths) {
  if (eslintTools === undefined) {
    try {
      const [{ ESLint }, { pluginConfigs }] = await Promise.all([import("eslint"), import("./eslint-config.mjs")]);
      eslintTools = { ESLint, pluginConfigs };
    } catch {
      eslintTools = null;
    }
  }
  if (!eslintTools) return { skipped: "ESLint not installed (npm install the spec package's devDependencies)", errors: [] };
  const eslint = new eslintTools.ESLint({ cwd: dir, overrideConfigFile: true, overrideConfig: eslintTools.pluginConfigs(["."]) });
  const errors = [];
  for (const res of await eslint.lintFiles(paths)) {
    for (const m of res.messages) if (m.severity === 2) errors.push(`${relative(dir, res.filePath)}:${m.line} ${m.ruleId || "parse"}: ${m.message}`);
  }
  return { errors };
}

const node = (script, scriptArgs, extra = {}) => spawnSync(process.execPath, [script, ...scriptArgs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...extra });
const tail = (s, n = 15) => String(s || "").trim().split("\n").slice(-n);

const checks = {
  manifest(dir) {
    const r = node(join(root, "scripts/validate.mjs"), ["--json", dir]);
    let report;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      return { status: "fail", errors: ["validator gave no JSON report", ...tail(r.stderr)] };
    }
    const errors = report.flatMap((f) => f.errors.map((e) => `${relative(dir, f.file) || f.file}${e.path && e.path !== "/" ? ` ${e.path}` : ""}: ${e.message}`));
    const notes = report.flatMap((f) => (f.warnings || []).map((w) => `warning: ${typeof w === "string" ? w : `${w.path || ""} ${w.message || ""}`.trim()}`));
    return { status: errors.length ? "fail" : "pass", errors, notes };
  },

  cases(dir) {
    if (!existsSync(join(dir, "tests", "cases"))) return { status: "skip", notes: ["no tests/cases"] };
    const r = node(join(root, "harness/run-cases.mjs"), [dir, "--runtime", hasPhp ? "both" : "nodejs"]);
    const lines = String(r.stdout).trim().split("\n");
    const notes = [lines[lines.length - 1]];
    if (!hasPhp) notes.push("PHP not installed here: Node runtime only, no parity");
    return { status: r.status === 0 ? "pass" : "fail", errors: r.status === 0 ? [] : lines.filter((l) => l.startsWith("FAIL") || l.startsWith("      ")).slice(0, 30), notes };
  },

  async node(dir) {
    const code = [...files(join(dir, "src", "nodejs"), (n) => /\.(m|c)?js$/.test(n)), ...files(join(dir, "tests", "nodejs"), (n) => /\.(m|c)?js$/.test(n))];
    if (!code.length) return { status: "skip", notes: ["no Node code"] };
    const errors = [];
    const notes = [];
    const linted = await lint(dir, code);
    errors.push(...linted.errors);
    notes.push(linted.skipped || `ESLint: ${code.length} file(s)`);
    const tests = files(join(dir, "tests", "nodejs"), (n) => n.endsWith(".test.mjs") || n.endsWith(".test.js"));
    if (tests.length) {
      const r = spawnSync(process.execPath, ["--test", ...tests], { encoding: "utf8" });
      const passed = (r.stdout.match(/^# pass (\d+)/m) || [])[1] || "0";
      if (r.status !== 0) errors.push(`node --test failed`, ...r.stdout.split("\n").filter((l) => /not ok|Error|expected|actual/.test(l)).slice(0, 20));
      notes.push(`node --test: ${passed} passed`);
    }
    const nodeParity = join(dir, "tests/nodejs/run-parity.mjs");
    const phpParity = join(dir, "tests/php/run-parity.php");
    if (existsSync(nodeParity) && existsSync(phpParity)) {
      if (!hasPhp) notes.push("parity runners: PHP not installed here");
      else {
        const n = JSON.parse(node(nodeParity, []).stdout);
        const p = JSON.parse(spawnSync("php", [phpParity], { encoding: "utf8" }).stdout);
        const diffs = n.map((v, i) => (isDeepStrictEqual(v, p[i]) ? null : i)).filter((i) => i !== null);
        if (diffs.length || n.length !== p.length) errors.push(`Node/PHP parity runners differ at call(s) ${diffs.join(", ")}`);
        notes.push(`parity runners: ${n.length} calls`);
      }
    }
    return { status: errors.length ? "fail" : "pass", errors, notes };
  },

  php(dir) {
    const code = files(join(dir, "src", "php"), (n) => n.endsWith(".php"));
    if (!code.length) return { status: "skip", notes: ["no PHP code"] };
    if (!hasPhp) return { status: "skip", notes: ["PHP not installed here"] };
    const errors = [];
    for (const f of code) {
      const r = spawnSync("php", ["-l", f], { encoding: "utf8" });
      if (r.status !== 0) errors.push(`php -l ${relative(dir, f)}: ${String(r.stdout || r.stderr).trim().split("\n")[0]}`);
    }
    const r = spawnSync("bash", [join(here, "phpstan.sh"), "--error-format=json", dir], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    let report = null;
    try {
      report = JSON.parse(r.stdout);
    } catch {
      report = null;
    }
    if (!report) errors.push("PHPStan did not run", ...tail(r.stderr, 8));
    else {
      for (const [f, v] of Object.entries(report.files || {})) for (const m of v.messages) errors.push(`PHPStan ${relative(dir, f)}:${m.line} ${m.message}`);
      for (const e of report.errors || []) errors.push(`PHPStan: ${e}`);
    }
    return { status: errors.length ? "fail" : "pass", errors, notes: [`php -l and PHPStan level 5: ${code.length} file(s)`] };
  },

  async frontend(dir) {
    const dist = files(join(dir, "frontend", "dist"), (n) => n.endsWith(".js"));
    const registered = existsSync(join(dir, "registries", "elements")) || existsSync(join(dir, "registries", "themes"));
    if (!dist.length && !registered) return { status: "skip", notes: ["no front-end code"] };
    const errors = [];
    const notes = [];
    if (dist.length) {
      const linted = await lint(dir, dist);
      errors.push(...linted.errors);
      if (linted.skipped) notes.push(linted.skipped);
    }
    if (!chrome) return { status: errors.length ? "fail" : "skip", errors, notes: ["Chrome not found (set CHROME_PATH): browser checks skipped"] };
    const r = node(join(here, "frontend.mjs"), ["--json", dir], { env: { ...process.env, CHROME_PATH: chrome } });
    let report;
    try {
      report = JSON.parse(r.stdout)[0];
    } catch {
      return { status: "fail", errors: [...errors, "browser checks gave no report", ...tail(r.stderr)], notes };
    }
    errors.push(...report.errors);
    notes.push(...report.notes);
    if (!report.checked.length && !errors.length) return { status: "skip", notes: notes.length ? notes : ["no front-end code"] };
    notes.unshift(`in Chrome: ${report.checked.join(", ")}`);
    return { status: errors.length ? "fail" : "pass", errors, notes };
  },

  live(dir) {
    if (!haxcms) return { status: "skip", notes: ["pass --haxcms <haxcms-nodejs checkout> to run"] };
    const r = node(join(here, "live-nodejs.cjs"), ["--haxcms", haxcms, "--json", dir], { timeout: 240000 });
    let report;
    try {
      report = JSON.parse(r.stdout)[0];
    } catch {
      return { status: "fail", errors: ["live check gave no report", ...tail(r.stderr)] };
    }
    return { status: report.ok ? "pass" : "fail", errors: report.errors, notes: [`${report.status || "not loaded"} in haxcms-nodejs`, ...report.notes] };
  },
};

const results = [];
for (const dir of targets) {
  const plugin = relative(root, dir) || dir;
  const layers = {};
  for (const layer of LAYERS) {
    if (!wanted(layer)) continue;
    try {
      layers[layer] = await checks[layer](dir);
    } catch (e) {
      layers[layer] = { status: "fail", errors: [String((e && e.stack) || e)] };
    }
    layers[layer].errors = layers[layer].errors || [];
    layers[layer].notes = layers[layer].notes || [];
  }
  const ok = Object.values(layers).every((l) => l.status !== "fail");
  results.push({ plugin, ok, layers });
  if (!asJson) {
    const line = Object.entries(layers).map(([k, v]) => `${k}:${v.status}`).join("  ");
    console.log(`${ok ? "ok  " : "FAIL"} ${plugin}  ${line}`);
    for (const [k, v] of Object.entries(layers)) for (const e of v.errors) console.log(`     ! ${k}: ${e}`);
  }
}
if (asJson) console.log(JSON.stringify(results, null, 2));
else {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} plugins pass${failed ? `; ${failed} fail` : ""}`);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);

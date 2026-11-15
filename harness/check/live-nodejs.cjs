#!/usr/bin/env node
// Live check: does a plugin work in a real, running haxcms-nodejs?
//
// The reference harness (harness/memory-backend.mjs) and the haxcms-nodejs adapter
// (haxcms-nodejs test/plugins/haxcms-adapter.mjs) run a plugin's cases against an
// engine. This goes one step further: it boots a real haxcms-nodejs server (the
// one in the checkout passed with --haxcms, booted the way its own e2e suite does:
// temp HAXCMS_ROOT, ephemeral port, real JWT login), installs the plugin through
// HAXCMS_PLUGIN_DIRS, creates a real site over the API, and then checks over HTTP:
//
//   1. the plugin shows up in GET system/api/v1/plugins, and is not in a failed
//      state ("inactive" with unmet requirements is reported, not failed: a plugin
//      that needs rsync on the server is correctly inactive in CI)
//   2. GET x/api/v1/plugins/contributions answers for the site
//   3. every GET operation in the plugin's OpenAPI document without path
//      parameters answers without crashing (no 500; 502/503/504 are how a plugin
//      says an outside service is unreachable or unconfigured), called with the
//      site, a JWT and the user token, the way the dashboard calls it. Required
//      settings come from the plugin's own test cases (run.settings).
//   4. a page created and saved through the real site API still succeeds with the plugin
//      enabled (200), or is vetoed by the plugin (409); anything else fails, and the
//      site stays readable afterwards
//
// Usage:
//   node harness/check/live-nodejs.cjs --haxcms <haxcms-nodejs checkout> <plugin folder> [...]
//   node harness/check/live-nodejs.cjs --haxcms ../haxcms-nodejs --json core-plugins/feeds
//
// The checkout must be a haxcms-nodejs with the plugin platform (today the
// draft/plugin-platform branch, haxcms-nodejs#138) and its dependencies
// installed. Each plugin runs in its own child process so nothing leaks between
// them. Exit code 1 when any plugin fails.
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const haxcmsIdx = args.indexOf("--haxcms");
const childIdx = args.indexOf("--child");

function usage(message) {
  if (message) console.error(message);
  console.error("usage: live-nodejs.cjs --haxcms <haxcms-nodejs checkout> [--json] <plugin folder> [...]");
  process.exit(2);
}

if (haxcmsIdx === -1 || !args[haxcmsIdx + 1]) usage("missing --haxcms");
const haxcmsRoot = path.resolve(args[haxcmsIdx + 1]);
const harnessPath = path.join(haxcmsRoot, "test", "e2e", "helpers", "harness.cjs");
if (!fs.existsSync(harnessPath)) usage(`not a haxcms-nodejs checkout (no ${harnessPath})`);
if (!fs.existsSync(path.join(haxcmsRoot, "src", "lib", "plugins", "pluginSystem.js"))) {
  usage(`${haxcmsRoot} has no plugin platform (src/lib/plugins/pluginSystem.js); use the draft/plugin-platform branch`);
}

if (childIdx !== -1) {
  runChild(path.resolve(args[childIdx + 1])).then(
    (result) => {
      process.stdout.write("\n@@RESULT@@" + JSON.stringify(result) + "\n");
      process.exit(0);
    },
    (e) => {
      process.stdout.write("\n@@RESULT@@" + JSON.stringify({ ok: false, errors: [String((e && e.stack) || e)], notes: [] }) + "\n");
      process.exit(0);
    },
  );
} else {
  const skip = new Set();
  [haxcmsIdx].forEach((i) => { skip.add(i); skip.add(i + 1); });
  const plugins = args.filter((a, i) => !skip.has(i) && !a.startsWith("--"));
  if (!plugins.length) usage("no plugin folder given");
  const results = [];
  for (const p of plugins) {
    const dir = path.resolve(p);
    const r = spawnSync(process.execPath, [__filename, "--haxcms", haxcmsRoot, "--child", dir], {
      encoding: "utf8",
      timeout: 180000,
      env: { ...process.env },
    });
    const out = String(r.stdout || "");
    const at = out.lastIndexOf("@@RESULT@@");
    let result;
    if (at === -1) {
      result = { ok: false, errors: [`no result (exit ${r.status}${r.signal ? ", " + r.signal : ""})`, String(r.stderr || "").slice(-2000)], notes: [] };
    } else {
      result = JSON.parse(out.slice(at + 10).trim());
    }
    result.plugin = path.relative(process.cwd(), dir) || dir;
    results.push(result);
    if (!asJson) {
      console.log(`${result.ok ? "ok  " : "FAIL"} ${result.plugin}${result.status ? ` (${result.status})` : ""}`);
      for (const n of result.notes) console.log(`       ${n}`);
      for (const e of result.errors) console.log(`     ! ${e}`);
    }
  }
  if (asJson) console.log(JSON.stringify(results, null, 2));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

async function runChild(pluginDir) {
  const errors = [];
  const notes = [];
  const manifestText = fs.readFileSync(path.join(pluginDir, "plugin.yaml"), "utf8");
  const id = (/^id:\s*(\S+)/m.exec(manifestText) || [])[1];
  if (!id) return { ok: false, errors: ["plugin.yaml has no id"], notes };

  // Install: the plugin folder, and the plugins it depends on (found by id in this
  // repository's plugin folders), are loaded as system-tier plugins, the way
  // `hax plugin install` would bring dependencies along.
  const deps = dependencyDirs(pluginDir, notes);
  if (deps.missing.length) errors.push(`dependencies not found in this repository: ${deps.missing.join(", ")}`);
  process.env.HAXCMS_PLUGIN_DIRS = [pluginDir, ...deps.dirs].join(path.delimiter);
  // Keep the server's own logging out of the result line.
  const quiet = process.env.HAX_PLUGIN_CHECK_VERBOSE ? null : silenceConsole();
  const harness = require(harnessPath);
  let runtime;
  try {
    runtime = await harness.setupE2ERuntime();
    const base = runtime.baseUrl;
    // Settings: required settings would leave a plugin inactive and its routes
    // unreachable. The values its own test cases use (run.settings) are written to
    // <HAXCMS_ROOT>/_config/plugins/config/<id>.json, where the deployment keeps them.
    for (const dir of [pluginDir, ...deps.dirs]) {
      const seeded = caseSettings(dir);
      if (!Object.keys(seeded.settings).length) continue;
      const cfgDir = path.join(runtime.runtimeRoot, "_config", "plugins", "config");
      fs.mkdirSync(cfgDir, { recursive: true });
      fs.writeFileSync(path.join(cfgDir, `${seeded.id}.json`), JSON.stringify(seeded.settings, null, 2));
      if (dir === pluginDir) notes.push(`settings from its test cases: ${Object.keys(seeded.settings).join(", ")}`);
    }
    const authHeaders = {
      accept: "application/json",
      authorization: `Bearer ${runtime.jwt}`,
      [runtime.userTokenHeader]: runtime.userToken,
    };
    const siteName = `plugin-check-${id}`.replace(/[^a-z0-9-]/g, "-").slice(0, 60);

    // a real site through the real createSite route
    const settings = runtime.dashboardSettings || {};
    const createPath = typeof settings.createSite === "string" && settings.createSite.trim() ? settings.createSite : "/system/api/v1/sites";
    const created = await request("POST", absolute(base, createPath), {
      headers: { ...authHeaders, "content-type": "application/json", ...(settings.createSiteHeaders || {}) },
      body: { jwt: runtime.jwt, token: settings.token, site: { name: siteName, description: `Live check for the ${id} plugin` } },
    });
    if (created.status !== 200) {
      errors.push(`createSite answered ${created.status}: ${snippet(created.text)}`);
      return { ok: false, errors, notes };
    }

    // 1. the plugin is loaded and not failed
    const listed = await request("GET", `${base}/system/api/v1/plugins?siteName=${encodeURIComponent(siteName)}`, { headers: authHeaders });
    let status = null;
    if (listed.status !== 200 || !listed.json || !Array.isArray(listed.json.data)) {
      errors.push(`GET system/api/v1/plugins answered ${listed.status}: ${snippet(listed.text)}`);
    } else {
      const entry = listed.json.data.find((p) => p && p.id === id);
      if (!entry) {
        errors.push(`${id} is not in the plugin list (loaded: ${listed.json.data.map((p) => p.id).join(", ") || "none"})`);
      } else {
        status = entry.status;
        if (entry.status === "inactive") {
          const unmet = (entry.unmet || []).map((u) => u.message || u.key).join("; ");
          notes.push(`inactive in this environment${unmet ? `: ${unmet}` : ""}`);
        } else if (entry.status !== "active") {
          errors.push(`status ${entry.status}${entry.reason ? `: ${entry.reason}` : ""}`);
        }
      }
    }

    // 2. contributions for the site
    const contrib = await request("GET", `${base}/_sites/${siteName}/x/api/v1/plugins/contributions`, { headers: authHeaders });
    if (contrib.status >= 500 || contrib.status === 404) {
      errors.push(`GET x/api/v1/plugins/contributions answered ${contrib.status}: ${snippet(contrib.text)}`);
    }

    // 3. the plugin's own GET operations answer without a server error
    if (status === "active") {
      for (const op of getOperations(pluginDir, manifestText)) {
        const url = `${base}/_sites/${siteName}/x/api/v1/plugins/${id}${op.path}`;
        const res = await request("GET", url, { headers: authHeaders });
        // 502/503/504: the plugin answered that an outside service is unreachable or not
        // configured, which is correct with no network or keys. A 500 is a crash.
        if (res.status >= 500 && ![502, 503, 504].includes(res.status)) errors.push(`GET ${op.path} (${op.operationId || "no operationId"}) answered ${res.status}: ${snippet(res.text)}`);
        else notes.push(`GET ${op.path} -> ${res.status}`);
      }
    }

    // 4. a page save through the real route still works with the plugin enabled
    const saved = await savePage(base, siteName, authHeaders, runtime);
    if (saved.error) errors.push(saved.error);
    else notes.push(saved.note);
    const after = await request("GET", `${base}/_sites/${siteName}/site.json`, { headers: { accept: "application/json" } });
    if (after.status !== 200) errors.push(`site.json not readable after the save (${after.status})`);

    return { ok: errors.length === 0, status, errors, notes };
  } finally {
    if (runtime) await harness.teardownE2ERuntime(runtime).catch(() => {});
    if (quiet) quiet();
  }
}

// a new page, then its content saved, through the site API the editor uses
// (createItem, then updateContentByIdOrSlug, with the site token from the
// site's connection settings, as haxcms-nodejs's API conformance suite does)
async function savePage(base, siteName, headers, runtime) {
  const settingsRes = await fetch(`${base}/system/api/v1/session/connection-settings`, {
    headers: { accept: "application/javascript", referer: `${base}/_sites/${siteName}/`, authorization: `Bearer ${runtime.jwt}` },
  });
  const siteSettings = parseAppSettings(await settingsRes.text());
  if (!siteSettings || !siteSettings.siteToken) return { error: `no site token from connection settings (${settingsRes.status})` };
  const siteHeaders = { ...headers, "content-type": "application/json", "X-HAXCMS-Site-Token": siteSettings.siteToken };
  const created = await request("POST", `${base}/_sites/${siteName}/x/api/v1/items`, {
    headers: siteHeaders,
    body: { site: { name: siteName }, node: { title: "Plugin check page" } },
  });
  if (created.status >= 500) return { error: `createItem answered ${created.status}: ${snippet(created.text)}` };
  if (created.status >= 400) return { note: `createItem was refused (${created.status}); no save to test` };
  const data = (created.json && created.json.data) || {};
  const pageId = data.id || (data.item && data.item.id) || (data.node && data.node.id);
  if (!pageId) return { note: "createItem answered without an id; no save to test" };
  // the editor sends the page-break header element first; only content after it is saved
  const body = '<page-break title="Plugin check page"></page-break><p>Plugin check: a paragraph with <strong>markup</strong>.</p>';
  const save = await request("PATCH", `${base}/_sites/${siteName}/x/api/v1/content/${encodeURIComponent(pageId)}`, {
    headers: siteHeaders,
    body: { site: { name: siteName }, body },
  });
  // 409 is a plugin veto (page.before.save): allowed, the plugin said no. Any other refusal is a failure.
  if (save.status === 409) return { note: `createItem -> ${created.status}, content save vetoed (409): ${snippet(save.text)}` };
  if (save.status !== 200) return { error: `updateContentByIdOrSlug answered ${save.status}: ${snippet(save.text)}` };
  return { note: `createItem -> ${created.status}, content save -> ${save.status}` };
}

// window.appSettings from the connection-settings script, without running it
function parseAppSettings(source) {
  const vm = require("node:vm");
  const sandbox = { window: {} };
  try {
    vm.runInNewContext(String(source || ""), sandbox, { timeout: 1000 });
  } catch {
    return null;
  }
  return sandbox.window && typeof sandbox.window.appSettings === "object" ? sandbox.window.appSettings : null;
}

// plugin folders for the manifest's dependencies (and theirs), by id
function dependencyDirs(pluginDir, notes) {
  const root = path.join(__dirname, "..", "..");
  const byId = new Map();
  for (const tier of ["core-plugins", "contrib-plugins", "examples", "harness/fixtures"]) {
    const t = path.join(root, tier);
    if (!fs.existsSync(t)) continue;
    for (const name of fs.readdirSync(t)) {
      const m = path.join(t, name, "plugin.yaml");
      if (fs.existsSync(m)) byId.set(manifestOf(m).id, path.join(t, name));
    }
  }
  const dirs = [];
  const missing = [];
  const seen = new Set([manifestOf(path.join(pluginDir, "plugin.yaml")).id]);
  const queue = [...(manifestOf(path.join(pluginDir, "plugin.yaml")).dependencies || [])];
  while (queue.length) {
    const id = String(queue.shift()).split("@")[0];
    if (seen.has(id)) continue;
    seen.add(id);
    const dir = byId.get(id);
    if (!dir) {
      missing.push(id);
      continue;
    }
    dirs.push(dir);
    notes.push(`with dependency ${id}`);
    queue.push(...(manifestOf(path.join(dir, "plugin.yaml")).dependencies || []));
  }
  return { dirs, missing };
}

// the settings a plugin's own executable cases run with, merged (later cases win)
function caseSettings(dir) {
  const id = manifestOf(path.join(dir, "plugin.yaml")).id;
  const settings = {};
  const casesDir = path.join(dir, "tests", "cases");
  if (fs.existsSync(casesDir)) {
    for (const f of fs.readdirSync(casesDir).filter((n) => n.endsWith(".yaml")).sort()) {
      let cases;
      try {
        cases = loadYaml(fs.readFileSync(path.join(casesDir, f), "utf8"));
      } catch {
        continue;
      }
      for (const c of Array.isArray(cases) ? cases : []) {
        if (c && c.run && c.run.settings && typeof c.run.settings === "object") Object.assign(settings, c.run.settings);
      }
    }
  }
  return { id, settings };
}

function manifestOf(file) {
  return loadYaml(fs.readFileSync(file, "utf8")) || {};
}

// GET operations with no path parameters, from the plugin's OpenAPI document
function getOperations(pluginDir, manifestText) {
  const rel = (/^openapi:\s*(\S+)/m.exec(manifestText) || [])[1];
  if (!rel) return [];
  const file = path.join(pluginDir, rel);
  if (!fs.existsSync(file)) return [];
  let doc;
  try {
    doc = loadYaml(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const out = [];
  for (const [p, item] of Object.entries((doc && doc.paths) || {})) {
    if (p.includes("{") || !item || !item.get) continue;
    out.push({ path: p, operationId: item.get.operationId });
  }
  return out;
}

function loadYaml(text) {
  // the spec package's own yaml dependency (installed next to this harness)
  return require(require.resolve("yaml", { paths: [path.join(__dirname, "..", "..")] })).parse(text);
}

async function request(method, url, { headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

function absolute(base, p) {
  return /^https?:\/\//i.test(p) ? p : `${base}${p.charAt(0) === "/" ? "" : "/"}${p}`;
}

function snippet(text) {
  return String(text || "").replace(/\s+/g, " ").slice(0, 200);
}

function silenceConsole() {
  const saved = {};
  for (const k of ["log", "info", "warn", "error", "debug"]) {
    saved[k] = console[k];
    console[k] = () => {};
  }
  return () => Object.assign(console, saved);
}

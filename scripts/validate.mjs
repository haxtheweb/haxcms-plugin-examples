#!/usr/bin/env node
// hax-plugin-validate: validate HAXcms plugin manifests and their registries.
// Usage: hax-plugin-validate [--json] [--strict] <plugin.yaml | plugin folder> [...]
// JSON output matches the other HAX validators: [{ file, errors: [{path,message}], warnings: [...] }]
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const strict = args.includes("--strict");
const targets = args.filter((a) => !a.startsWith("--"));
if (!targets.length) {
  console.error("usage: hax-plugin-validate [--json] [--strict] <plugin.yaml | plugin folder> [...]");
  process.exit(2);
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const readAny = (p) => (p.endsWith(".json") ? readJson(p) : parse(readFileSync(p, "utf8")));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const own = (n) => ajv.compile(readJson(join(root, "schema", n)));
const validators = {
  manifest: own("plugin.schema.json"),
  theme: own("theme-registry-entry.schema.json"),
  element: own("element-registry-entry.schema.json"),
  merlin: own("merlin-declaration.schema.json"),
  datastores: own("datastores.schema.json"),
  entities: own("entities.schema.json"),
  locale: own("locale-overlay.schema.json"),
};
const knownHooks = new Set(readJson(join(root, "schema/hooks.json")));
const knownCaps = new Set(readJson(join(root, "schema/capabilities.json")));

// Optional external schemas (resolved from this package, then the cwd)
const requireFrom = [join(here, "noop.js"), join(process.cwd(), "noop.js")];
function external(pkgFile) {
  for (const from of requireFrom) {
    try {
      return readJson(createRequire(from).resolve(pkgFile));
    } catch { /* try next */ }
  }
  return null;
}
const ext = {};
function extValidator(key, pkgFile, subpath, siblings = []) {
  if (key in ext) return ext[key];
  for (const sib of siblings) {
    const ss = external(sib);
    if (ss && !ajv.getSchema(ss.$id)) ajv.addSchema(ss);
  }
  const sc = external(pkgFile);
  if (!sc) return (ext[key] = null);
  if (!ajv.getSchema(sc.$id)) ajv.addSchema(sc);
  return (ext[key] = ajv.compile(subpath ? { $ref: `${sc.$id}${subpath}` } : { $ref: sc.$id }));
}
const optionSchema = () => {
  const sc = external("@haxtheweb/merlin-schema/merlin-option.schema.json");
  if (!sc) return null;
  if (!ajv.getSchema(sc.$id)) ajv.addSchema(sc);
  return ajv.getSchema(sc.$id);
};

function fmt(errors) {
  return (errors || []).map((e) => ({ path: e.instancePath || "/", message: `${e.message}${e.params && e.params.additionalProperty ? ` ("${e.params.additionalProperty}")` : ""}` }));
}
function listFiles(dir, exts) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => exts.some((x) => n.endsWith(x))).sort().map((n) => join(dir, n));
}

function validatePlugin(manifestPath) {
  const dir = dirname(manifestPath);
  const errors = [];
  const warnings = [];
  const err = (path, message) => errors.push({ path, message });
  const warn = (path, message) => warnings.push({ path, message });
  const rel = (f) => f.slice(dir.length + 1);
  const rel2 = rel;
  let m;
  try { m = readAny(manifestPath); } catch (e) { err("/", `cannot parse: ${e.message}`); return { file: manifestPath, errors, warnings }; }
  if (!validators.manifest(m)) fmt(validators.manifest.errors).forEach((e) => err(e.path, e.message));
  if (!m || typeof m !== "object") return { file: manifestPath, errors, warnings };
  if (m.id && basename(dir) !== m.id) err("/id", `id "${m.id}" must equal the plugin folder name "${basename(dir)}"`);
  for (const key of ["openapi", "entities", "contracts", "datastores", "settings", "admin"]) {
    if (m[key] && !existsSync(join(dir, m[key]))) err(`/${key}`, `file not found: ${m[key]}`);
  }
  for (const rt of m.runtimes || []) {
    const entry = m.entry && m.entry[rt];
    if (!entry) err("/entry", `runtime ${rt} declared but no entry.${rt}`);
    else if (!existsSync(join(dir, entry))) err(`/entry/${rt}`, `file not found: ${entry}`);
  }
  for (const rt of Object.keys(m.entry || {})) if (!(m.runtimes || []).includes(rt)) err("/entry", `entry.${rt} but runtime ${rt} is not in runtimes`);
  if (!m.core && m.runtimes && m.runtimes.length < 2 && m.kind !== "pack") warn("/runtimes", "single runtime: first-party plugins should provide both nodejs and php");
  if (m.openapi && m.staticCapable !== false) warn("/staticCapable", "plugin has routes: set staticCapable: false so it is tagged as needing a server (or explain how it degrades statically)");
  for (const [i, h] of (m.hooks || []).entries()) if (!knownHooks.has(h.name)) warn(`/hooks/${i}/name`, `unknown hook "${h.name}" (open vocabulary; the loader will warn)`);
  for (const [i, c] of (m.capabilities || []).entries()) if (!knownCaps.has(c)) warn(`/capabilities/${i}`, `unknown capability "${c}" (open vocabulary; the loader will warn)`);
  if (m.dependencies && m.id && m.dependencies.some((d) => d.split("@")[0] === m.id)) err("/dependencies", "a plugin cannot depend on itself");
  const prefix = m.tagPrefix;
  const checkTag = (where, tag) => {
    if (prefix && !tag.startsWith(prefix)) err(where, `tag "${tag}" must start with tagPrefix "${prefix}"`);
    if (!prefix) warn(where, `tag "${tag}" declared without a tagPrefix in plugin.yaml`);
  };
  // static scan: child processes must be declared (exec:run capability and the exec list)
  const execPattern = /\b(child_process|execSync|execFile|spawnSync|spawn\s*\(|shell_exec|proc_open|passthru|popen|exec\s*\(|system\s*\()/;
  for (const rt of ["nodejs", "php"]) {
    const srcDir = join(dir, "src", rt);
    const walk = (d) => (existsSync(d) ? readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)])) : []);
    for (const f of walk(srcDir).filter((x) => /\.(m?js|cjs|php)$/.test(x))) {
      const code = readFileSync(f, "utf8").replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "");
      if (execPattern.test(code) && !(m.capabilities || []).includes("exec:run")) err(rel2(f), "spawns a process but the manifest lacks the exec:run capability (and an exec list)");
    }
  }
  // registries
  for (const f of listFiles(join(dir, "registries/themes"), [".json", ".yaml", ".yml"])) {
    const t = readAny(f);
    if (!validators.theme(t)) fmt(validators.theme.errors).forEach((e) => err(`${rel(f)}${e.path === "/" ? "" : e.path}`, e.message));
    else checkTag(rel(f), t.element);
  }
  for (const f of listFiles(join(dir, "registries/elements"), [".json", ".yaml", ".yml"])) {
    const t = readAny(f);
    if (!validators.element(t)) { fmt(validators.element.errors).forEach((e) => err(`${rel(f)}${e.path === "/" ? "" : e.path}`, e.message)); continue; }
    checkTag(rel(f), t.tag);
    if (t.haxProperties) {
      const hp = join(dir, t.haxProperties);
      const v = extValidator("haxProperties", "@haxtheweb/hax-schema/schema/haxProperties.schema.json");
      if (!existsSync(hp)) err(rel(f), `haxProperties file not found: ${t.haxProperties}`);
      else if (!v) warn(rel(f), "@haxtheweb/hax-schema not installed; haxProperties not validated");
      else if (!v(readJson(hp))) fmt(v.errors).forEach((e) => err(`${t.haxProperties}${e.path === "/" ? "" : e.path}`, e.message));
    }
  }
  for (const f of listFiles(join(dir, "registries/skeletons"), [".json"])) {
    const v = extValidator("skeleton", "@haxtheweb/json-outline-schema-spec/schema/skeleton.schema.json", null, ["@haxtheweb/json-outline-schema-spec/schema/json-outline-schema.schema.json", "@haxtheweb/json-outline-schema-spec/schema/haxcms-site.schema.json"]);
    if (!v) { warn(rel(f), "@haxtheweb/json-outline-schema-spec not installed; skeleton not validated"); continue; }
    if (!v(readJson(f))) fmt(v.errors).forEach((e) => err(`${rel(f)}${e.path === "/" ? "" : e.path}`, e.message));
  }
  for (const f of listFiles(join(dir, "registries/merlin"), [".json", ".yaml", ".yml"])) {
    const d = readAny(f);
    if (!validators.merlin(d)) { fmt(validators.merlin.errors).forEach((e) => err(`${rel(f)}${e.path === "/" ? "" : e.path}`, e.message)); continue; }
    const ov = optionSchema();
    if (!ov) { warn(rel(f), "@haxtheweb/merlin-schema not installed; option not validated"); continue; }
    const option = structuredClone(d.option);
    if (option.eventName === "super-daemon-run-program") option.value.program = "host-supplied";
    if (!ov(option)) fmt(ov.errors).forEach((e) => err(`${rel(f)}/option${e.path === "/" ? "" : e.path}`, e.message));
  }
  for (const f of listFiles(join(dir, "registries/appstore"), [".json"])) {
    const v = extValidator("appstore", "@haxtheweb/appstore-spec/schema/appstore.schema.json");
    if (!v) { warn(rel(f), "@haxtheweb/appstore-spec not installed; appstore fragment not validated"); continue; }
    if (!v(readJson(f))) fmt(v.errors).forEach((e) => err(`${rel(f)}${e.path === "/" ? "" : e.path}`, e.message));
  }
  const checkFile = (key, v) => {
    if (!m[key] || !existsSync(join(dir, m[key]))) return;
    const doc = readAny(join(dir, m[key]));
    if (!v(doc)) fmt(v.errors).forEach((e) => err(`${m[key]}${e.path === "/" ? "" : e.path}`, e.message));
    return doc;
  };
  const stores = checkFile("datastores", validators.datastores);
  const ents = checkFile("entities", validators.entities);
  if (stores && ents && ents.entities) {
    const ids = new Set(stores.stores.map((x) => x.id));
    for (const [name, e] of Object.entries(ents.entities)) if (e.store && !ids.has(e.store)) err(`${m.entities}/entities/${name}/store`, `unknown store "${e.store}" (not in ${m.datastores})`);
  }
  for (const f of listFiles(join(dir, "registries/locales"), [".yaml", ".yml", ".json"])) {
    if (!validators.locale(readAny(f))) fmt(validators.locale.errors).forEach((e) => err(`${rel(f)}${e.path === "/" ? "" : e.path}`, e.message));
  }
  const settingsPath = m.settings && join(dir, m.settings);
  if (settingsPath && existsSync(settingsPath)) {
    const v = extValidator("settings", "@haxtheweb/hax-schema/schema/haxProperties.schema.json", "#/properties/settings");
    if (!v) warn(m.settings, "@haxtheweb/hax-schema not installed; settings not validated");
    else if (!v(readJson(settingsPath))) fmt(v.errors).forEach((e) => err(`${m.settings}${e.path === "/" ? "" : e.path}`, e.message));
  }
  return { file: manifestPath, errors, warnings };
}

const reports = [];
for (const t of targets) {
  const p = resolve(t);
  const manifest = existsSync(p) && statSync(p).isDirectory() ? join(p, "plugin.yaml") : p;
  if (!existsSync(manifest)) { reports.push({ file: manifest, errors: [{ path: "/", message: "plugin.yaml not found" }], warnings: [] }); continue; }
  reports.push(validatePlugin(manifest));
}
const failed = reports.some((r) => r.errors.length || (strict && r.warnings.length));
if (asJson) console.log(JSON.stringify(reports, null, 2));
else {
  for (const r of reports) {
    console.log(`${r.errors.length ? "FAIL" : "PASS"} ${r.file}`);
    r.errors.forEach((e) => console.log(`  error   ${e.path}: ${e.message}`));
    r.warnings.forEach((w) => console.log(`  warning ${w.path}: ${w.message}`));
  }
}
process.exit(failed ? 1 : 0);

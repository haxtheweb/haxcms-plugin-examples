import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const load = (n) => ajv.compile(JSON.parse(readFileSync(join(root, "schema", n), "utf8")));
const merlinOption = JSON.parse(readFileSync(join(root, "node_modules/@haxtheweb/merlin-schema/merlin-option.schema.json"), "utf8"));
ajv.addSchema(merlinOption);
const validateOption = ajv.getSchema(merlinOption.$id);
const addPkg = (pkgPath) => { const sc = JSON.parse(readFileSync(join(root, "node_modules", pkgPath), "utf8")); ajv.addSchema(sc); return sc; };
const haxProps = addPkg("@haxtheweb/hax-schema/schema/haxProperties.schema.json");
addPkg("@haxtheweb/json-outline-schema-spec/schema/json-outline-schema.schema.json");
const siteSchema = addPkg("@haxtheweb/json-outline-schema-spec/schema/haxcms-site.schema.json");
const skeletonSchema = addPkg("@haxtheweb/json-outline-schema-spec/schema/skeleton.schema.json");
const external = {
  "ext:skeleton": ajv.getSchema(skeletonSchema.$id),
  "ext:haxProperties": ajv.getSchema(haxProps.$id),
  "ext:site": ajv.getSchema(siteSchema.$id),
  "ext:settings": ajv.compile({ $ref: `${haxProps.$id}#/properties/settings` }),
};
const compiled = {};
const suites = [
  ["plugin.schema.json", "valid", true], ["plugin.schema.json", "invalid", false],
  ["ext:skeleton", "registries/skeletons/valid", true], ["ext:skeleton", "registries/skeletons/invalid", false],
  ["ext:haxProperties", "registries/elements/valid", true], ["ext:haxProperties", "registries/elements/invalid", false],
  ["ext:settings", "registries/settings/valid", true], ["ext:settings", "registries/settings/invalid", false],
  ["ext:site", "registries/site/valid", true], ["ext:site", "registries/site/invalid", false],
  ["theme-registry-entry.schema.json", "registries/themes/valid", true], ["theme-registry-entry.schema.json", "registries/themes/invalid", false],
  ["merlin-declaration.schema.json", "merlin/valid", true], ["merlin-declaration.schema.json", "merlin/invalid", false],
];
let failures = 0;
for (const [schemaFile, dir, expectValid] of suites) {
  const validate = (external[schemaFile] ?? (compiled[schemaFile] ??= load(schemaFile)));
  const base = join(root, "tests/fixtures", dir);
  for (const f of readdirSync(base).filter((n) => /\.(ya?ml|json)$/.test(n)).sort()) {
    const doc = (f.endsWith(".json") ? JSON.parse : parse)(readFileSync(join(base, f), "utf8"));
    let ok = validate(doc);
    if (ok && schemaFile.startsWith("merlin")) {
      // the host fills value.program for programs, then the real Merlin option schema applies
      const option = structuredClone(doc.option);
      if (option.eventName === "super-daemon-run-program") option.value.program = "host-supplied";
      ok = validateOption(option);
      if (!ok) validate.errors = validateOption.errors;
    }
    const pass = ok === expectValid;
    if (!pass) failures++;
    console.log(`${pass ? "ok  " : "FAIL"} ${dir}/${f}${pass || ok ? "" : ""}${!pass && !ok ? " " + JSON.stringify(validate.errors) : ""}`);
  }
}
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }

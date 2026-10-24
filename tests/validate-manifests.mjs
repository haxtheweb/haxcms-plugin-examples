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
const compiled = {};
const suites = [
  ["plugin.schema.json", "valid", true], ["plugin.schema.json", "invalid", false],
  ["merlin-declaration.schema.json", "merlin/valid", true], ["merlin-declaration.schema.json", "merlin/invalid", false],
];
let failures = 0;
for (const [schemaFile, dir, expectValid] of suites) {
  const validate = (compiled[schemaFile] ??= load(schemaFile));
  const base = join(root, "tests/fixtures", dir);
  for (const f of readdirSync(base).filter((n) => n.endsWith(".yaml")).sort()) {
    const doc = parse(readFileSync(join(base, f), "utf8"));
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

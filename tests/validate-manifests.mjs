import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync(join(root, "schema/plugin.schema.json"), "utf8")));
let failures = 0;
for (const [dir, expectValid] of [["valid", true], ["invalid", false]]) {
  const base = join(root, "tests/fixtures", dir);
  for (const f of readdirSync(base).filter((n) => n.endsWith(".yaml")).sort()) {
    const ok = validate(parse(readFileSync(join(base, f), "utf8")));
    const pass = ok === expectValid;
    if (!pass) failures++;
    console.log(`${pass ? "ok  " : "FAIL"} ${dir}/${f}${pass || ok ? "" : ""}${!pass && !ok ? " " + JSON.stringify(validate.errors) : ""}`);
  }
}
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }

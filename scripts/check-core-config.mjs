// Usage: node scripts/check-core-config.mjs <path to haxcms coreConfig directory>
// Checks the live core config files against the schemas this repo uses. Exits 1 on any failure.
import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2];
if (!dir) { console.error("usage: check-core-config.mjs <coreConfig dir>"); process.exit(2); }
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const haxProps = read(join(root, "node_modules/hax-schema/schema/haxProperties.schema.json"));
ajv.addSchema(haxProps);
const theme = ajv.compile(read(join(root, "schema/theme-registry-entry.schema.json")));
const field = ajv.compile({ $ref: `${haxProps.$id}#/$defs/field` });
let failures = 0;
const report = (ok, label, errs) => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : " " + JSON.stringify(errs).slice(0, 300)}`); };

const themesFile = join(dir, "themes.json");
if (existsSync(themesFile)) {
  const themes = read(themesFile);
  for (const [key, entry] of Object.entries(themes)) {
    const ok = theme(entry) && key === entry.element;
    report(ok, `themes.json/${key}`, theme.errors ?? [{ message: "key differs from element" }]);
  }
}
for (const [file, pick] of [["siteFields.json", (d) => d], ["nodeFields.json", (d) => d.fields]]) {
  const p = join(dir, file);
  if (!existsSync(p)) continue;
  [].concat(pick(read(p))).forEach((f, i) => report(field(f), `${file}[${i}]`, field.errors));
}
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }

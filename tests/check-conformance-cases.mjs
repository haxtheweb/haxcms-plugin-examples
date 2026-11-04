// Structural check of conformance/cases/*.yaml: required keys, unique ids, referenced spec files exist.
import { parse } from "yaml";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "conformance/cases");
const seen = new Set();
let failures = 0, count = 0;
const bad = (m) => { failures++; console.log(`FAIL ${m}`); };
for (const f of readdirSync(dir).filter((n) => n.endsWith(".yaml")).sort()) {
  const cases = parse(readFileSync(join(dir, f), "utf8"));
  if (!Array.isArray(cases)) { bad(`${f}: not a list`); continue; }
  for (const c of cases) {
    count++;
    for (const k of ["id", "title", "spec", "given", "when", "then"]) if (!c[k]) bad(`${f} ${c.id ?? "?"}: missing ${k}`);
    if (seen.has(c.id)) bad(`${f}: duplicate id ${c.id}`);
    seen.add(c.id);
    if (c.spec && !existsSync(join(root, c.spec))) bad(`${f} ${c.id}: spec file not found ${c.spec}`);
  }
}
console.log(`${failures ? "FAIL" : "ok  "} ${count} conformance cases checked`);
process.exit(failures ? 1 : 0);

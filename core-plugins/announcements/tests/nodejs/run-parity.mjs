// Prints the result of every call in tests/parity-calls.json as JSON. tests/php/run-parity.php prints the same;
// the repo's npm test compares the two outputs byte for byte (after JSON normalization).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as A from "../../src/nodejs/announcements.js";
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));
const data = { entries: read("data/announcements.json"), types: read("data/types.json") };
const es = read("data/locales/es.json");
const { running, date, calls } = read("tests/parity-calls.json");
const out = calls.map(([fn, args]) => {
  switch (fn) {
    case "latest": return A.latest(data, running, args[0] === "es" ? es : {});
    case "list": return A.list(data, running, args[0]);
    case "dailyTip": return A.dailyTip(data, running, new Date(date), { exclude: args[0], seed: args[1] });
    case "getEntry": return A.getEntry(data, running, args[0]);
    case "typesMap": return A.typesMap(data.types);
    case "compareVersions": return A.compareVersions(args[0], args[1]);
    case "fnv1a": return A.fnv1a(args[0]);
  }
});
process.stdout.write(JSON.stringify(out));

// Validates examples/* with the plugin validator and enforces hook coverage in the comprehensive example.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const validator = join(root, "scripts/validate.mjs");
let failures = 0;
const check = (ok, label, detail = "") => { if (!ok) failures++; console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : " " + detail}`); };
const run = (dir) => spawnSync(process.execPath, [validator, "--json", dir], { encoding: "utf8" });

// 1. every example validates cleanly
const examples = [...readdirSync(join(root, "examples")).map((n) => `examples/${n}`), ...readdirSync(join(root, "core-plugins")).map((n) => `core-plugins/${n}`), ...readdirSync(join(root, "contrib-plugins")).map((n) => `contrib-plugins/${n}`)];
for (const name of examples) {
  const r = run(join(root, name));
  const report = JSON.parse(r.stdout)[0];
  check(r.status === 0 && report.errors.length === 0, `${name} validates`, JSON.stringify(report.errors));
}

// 2. hook coverage in the comprehensive example
const hooks = JSON.parse(readFileSync(join(root, "schema/hooks.json"), "utf8"));
const ex = join(root, "examples/example");
const manifest = readFileSync(join(ex, "plugin.yaml"), "utf8");
const node = readFileSync(join(ex, "src/nodejs/index.js"), "utf8");
const php = readFileSync(join(ex, "src/php/Plugin.php"), "utf8");
for (const h of hooks) {
  check(manifest.includes(`name: ${h}\n`) || manifest.includes(`name: ${h}`), `hook ${h} in plugin.yaml`);
  check(node.includes(`"${h}"`), `hook ${h} in src/nodejs`);
  check(php.includes(`// hook: ${h}\n`), `hook ${h} in src/php`);
}

// 3. the validator rejects broken copies of the example
const broken = [
  ["missing entry file", (d) => rmSync(join(d, "src/php/Plugin.php"))],
  ["tag outside tagPrefix", (d) => writeFileSync(join(d, "registries/elements/awesome-counter.yaml"), "tag: other-counter\npath: frontend/dist/awesome-counter.js\nrole: injected\n")],
  ["block element without haxProperties", (d) => writeFileSync(join(d, "registries/elements/awesome-explosion.yaml"), "tag: awesome-explosion\npath: frontend/dist/awesome-explosion.js\nrole: block\n")],
  ["id differs from folder", (d) => writeFileSync(join(d, "plugin.yaml"), readFileSync(join(d, "plugin.yaml"), "utf8").replace(/^id: example\b/m, "id: other"))],
  ["bad merlin declaration", (d) => writeFileSync(join(d, "registries/merlin/explode.yaml"), "option: { title: X, eventName: super-daemon-run-program, value: { name: X, machineName: x } }\n")],
  ["manifest-scope store with a file", (d) => writeFileSync(join(d, "config/datastores.yaml"), "stores:\n  - { id: tally, scope: manifest, file: tally.json }\n")],
  ["store scope outside the allowed set", (d) => writeFileSync(join(d, "config/datastores.yaml"), "stores:\n  - { id: tally, scope: everywhere, file: tally.json }\n")],
  ["entity pointing at an unknown store", (d) => writeFileSync(join(d, "config/entities.yaml"), "entities:\n  thing:\n    store: nope\n")],
  ["annotation outside the ext namespace", (d) => writeFileSync(join(d, "config/entities.yaml"), "entities:\n  awesomeFile: { extends: file }\nannotations:\n  item:\n    explosions: { type: integer }\n")],
  ["locale overlay with a non-string value", (d) => writeFileSync(join(d, "registries/locales/en.yaml"), "awesome.explode: { nested: true }\n")],
  ["spawns a process without declaring exec:run", (d) => { writeFileSync(join(d, "plugin.yaml"), readFileSync(join(d, "plugin.yaml"), "utf8").replace(', "exec:run"', "").replace(/^exec: .*\n/m, "")); writeFileSync(join(d, "src/nodejs/extra.js"), "import { spawn } from 'node:child_process';\nspawn('ls');\n"); }],
  ["exec list without the capability", (d) => writeFileSync(join(d, "plugin.yaml"), readFileSync(join(d, "plugin.yaml"), "utf8").replace(', "exec:run"', ""))],
  ["missing category", (d) => writeFileSync(join(d, "plugin.yaml"), readFileSync(join(d, "plugin.yaml"), "utf8").replace(/^category: .*\n/m, ""))],
  ["missing README", (d) => rmSync(join(d, "README.md"))],
  ["missing AGENTS.md", (d) => rmSync(join(d, "AGENTS.md"))],
  ["no tests and no untested flag", (d) => rmSync(join(d, "tests"), { recursive: true })],
  ["only commented-out test stubs", (d) => { rmSync(join(d, "tests/cases/hooks.yaml")); }],
  ["test case for a hook the plugin does not use", (d) => writeFileSync(join(d, "tests/cases/extra.yaml"), "- { id: x, title: x, hook: user.after.nope, given: a, when: b, then: c }\n")],
  ["four author tags", (d) => writeFileSync(join(d, "plugin.yaml"), readFileSync(join(d, "plugin.yaml"), "utf8").replace("tags: [example, reference]", "tags: [a, b, c, d]"))],
  ["prompt naming an unknown skill", (d) => writeFileSync(join(d, "docs/prompts.yaml"), readFileSync(join(d, "docs/prompts.yaml"), "utf8").replace("skill: example-plugin-dev\n    prompt: |\n      I run", "skill: example-nope\n    prompt: |\n      I run"))],
  ["author sets a derived tag", (d) => writeFileSync(join(d, "plugin.yaml"), readFileSync(join(d, "plugin.yaml"), "utf8").replace("tags: [example, reference]", "tags: [example, needs-server]"))],
  ["skill name differs from its folder", (d) => writeFileSync(join(d, "skills/example-authoring/SKILL.md"), readFileSync(join(d, "skills/example-authoring/SKILL.md"), "utf8").replace("name: example-authoring", "name: other"))],
  ["site skill with a script file", (d) => writeFileSync(join(d, "skills/example-authoring/run.sh"), "echo hi\n")],
  ["users:full without privacy contracts", (d) => writeFileSync(join(d, "plugin.yaml"), readFileSync(join(d, "plugin.yaml"), "utf8").replace('"items:read",', '"items:read", "users:full",'))],
  ["schedule handler missing from an entry", (d) => writeFileSync(join(d, "plugin.yaml"), readFileSync(join(d, "plugin.yaml"), "utf8").replace("handler: tidy", "handler: sweep"))],
  ["detached hook where the caller waits", (d) => writeFileSync(join(d, "plugin.yaml"), readFileSync(join(d, "plugin.yaml"), "utf8").replace("  - name: rest.after.request\n", "  - name: rest.after.request\n    detached: true\n"))],
  ["alias pointing at an unknown hook", (d) => writeFileSync(join(d, "config/hooks.yaml"), readFileSync(join(d, "config/hooks.yaml"), "utf8").replace("{ hook: entity.before.update, entities: [awesomeFile] }", "{ hook: entity.before.nope }"))],
  ["defined hook outside the plugin namespace", (d) => writeFileSync(join(d, "config/hooks.yaml"), readFileSync(join(d, "config/hooks.yaml"), "utf8").replace("name: example.after.explode", "name: other.after.explode"))],
  ["dashboard contribution calling an unknown operation", (d) => writeFileSync(join(d, "registries/dashboard/explosions.yaml"), readFileSync(join(d, "registries/dashboard/explosions.yaml"), "utf8").replace("operation: exampleListExplosions", "operation: exampleNope"))],
  ["CLI command calling an unknown operation", (d) => writeFileSync(join(d, "registries/cli/explosions.yaml"), readFileSync(join(d, "registries/cli/explosions.yaml"), "utf8").replace("operation: exampleListExplosions", "operation: exampleNope"))],
  ["Merlin api program calling an unknown operation", (d) => writeFileSync(join(d, "registries/merlin/list-explosions.yaml"), readFileSync(join(d, "registries/merlin/list-explosions.yaml"), "utf8").replace("operation: exampleListExplosions", "operation: exampleNope"))],
  ["CLI alias that shadows a core command", (d) => writeFileSync(join(d, "registries/cli/explosions.yaml"), readFileSync(join(d, "registries/cli/explosions.yaml"), "utf8").replace("command: explosions\n", "command: explosions\nalias: site\n"))],
  ["bad theme entry", (d) => writeFileSync(join(d, "registries/themes/awesome-explosions-theme.json"), "{\"element\":\"awesome-explosions-theme\"}\n")],
];
for (const [label, mutate] of broken) {
  const tmp = mkdtempSync(join(tmpdir(), "plugin-"));
  const dir = join(tmp, "example");
  cpSync(ex, dir, { recursive: true });
  mutate(dir);
  const r = run(dir);
  check(r.status === 1, `validator rejects: ${label}`, r.stdout.slice(0, 200));
  rmSync(tmp, { recursive: true, force: true });
}
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }

// The compiled plugin.yaml schema, once: the validator (hax-plugin-validate) and the reference engine's loader both
// refuse a manifest with this, so they cannot disagree about what a valid manifest is.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
/** Compile one of this package's schemas (schema/<name>). */
export const compileOwn = (name) => ajv.compile(JSON.parse(readFileSync(join(root, "schema", name), "utf8")));
export const validateManifest = compileOwn("plugin.schema.json");

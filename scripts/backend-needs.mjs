// What a plugin needs from the backend it runs on, and what one deployment target gives it (spec/14).
// One implementation for the validator (derived tags, warnings), the reference engine (status) and the plugin
// registry every backend serves; haxcms-php ports `backendNeeds` and `targetFit` and reads the same schema/targets.json.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const TARGETS = JSON.parse(readFileSync(join(root, "schema/targets.json"), "utf8"));
export const TARGET_NAMES = Object.keys(TARGETS.targets);

/** Every operation of an OpenAPI document as { public, optional }. */
function operations(api) {
  const out = [];
  for (const verbs of Object.values((api && api.paths) || {})) {
    for (const op of Object.values(verbs || {})) {
      if (!op || typeof op !== "object" || !op.operationId) continue;
      const security = op.security || (api && api.security) || [];
      out.push({ public: op["x-hax-public"] === true, optional: security.some((r) => r && Object.keys(r).length === 0) });
    }
  }
  return out;
}

/**
 * The needs of one plugin, in the order of schema/targets.json.
 * @param {object} manifest  parsed plugin.yaml
 * @param {object|null} api  parsed config/openapi.yaml, when the plugin has one
 * @returns {string[]}
 */
export function backendNeeds(manifest, api = null) {
  const m = manifest || {};
  const caps = m.capabilities || [];
  const has = {
    backend: m.kind !== "pack" && !!(m.entry || m.openapi),
    process: caps.includes("exec:run"),
    visitors: operations(api).some((o) => o.public || o.optional),
    schedule: Array.isArray(m.schedules) && m.schedules.length > 0,
    network: caps.includes("network:egress"),
    secrets: caps.includes("settings:secret"),
  };
  return Object.keys(TARGETS.needs).filter((n) => has[n]);
}

/**
 * How a plugin fits one target.
 * @returns {{ unmet: {key: string, message: string}[], limited: {key: string, message: string}[] }}
 *   `unmet`: the plugin cannot run there (it stays inactive). `limited`: it runs, with a caveat the owner is shown.
 */
export function targetFit(manifest, needs, target) {
  const t = TARGETS.targets[target];
  if (!t) throw new Error(`unknown target "${target}"; known: ${TARGET_NAMES.join(", ")}`);
  const unmet = [];
  const limited = [];
  const declared = (manifest && manifest.targets) || null;
  if (declared && !declared.includes(target)) {
    unmet.push({ key: `target.${target}`, message: `Not made for the ${t.title}: this plugin lists ${declared.join(", ")}` });
    return { unmet, limited };
  }
  for (const n of needs) {
    const need = TARGETS.needs[n];
    if (t.provides.includes(n)) continue;
    if (t.partial[n]) limited.push({ key: `backend.${n}`, message: `On the ${t.title}, ${t.partial[n]}` });
    else if (need.hard) unmet.push({ key: `backend.${n}`, message: `Needs ${need.title}, which the ${t.title} does not have` });
    else limited.push({ key: `backend.${n}`, message: `Needs ${need.title}, which the ${t.title} does not have` });
  }
  return { unmet, limited };
}

/** Per target: "full", "limited" or "no". What a plugin listing shows before anyone installs it. */
export function targetSummary(manifest, needs) {
  const out = {};
  for (const name of TARGET_NAMES) {
    const runtimes = manifest && manifest.kind !== "pack" && Array.isArray(manifest.runtimes) ? manifest.runtimes : null;
    if (runtimes && !runtimes.some((r) => TARGETS.targets[name].runtimes.includes(r))) { out[name] = "no"; continue; }
    const fit = targetFit(manifest, needs, name);
    out[name] = fit.unmet.length ? "no" : fit.limited.length ? "limited" : "full";
  }
  return out;
}

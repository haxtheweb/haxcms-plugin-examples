// Announcements logic (Node). Pure functions: no I/O, so the same inputs give the same answers in both runtimes.
// src/php/Announcements.php mirrors this file function for function; tests/ run the same cases against both.

// Fields that exist only in the source data and are never served.
const SOURCE_ONLY = ["status", "notes", "sourcePRs"];

// Compare dotted numeric versions (HAX calendar versions such as 26.10.1). Returns -1, 0 or 1.
// Missing parts count as 0; a non-numeric part makes the whole version sort as newest, so it is never hidden by mistake.
export function compareVersions(a, b) {
  const pa = String(a).split(".");
  const pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number(pa[i] ?? 0);
    const y = Number(pb[i] ?? 0);
    if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) && Number.isNaN(y) ? 0 : Number.isNaN(x) ? 1 : -1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// FNV-1a 32-bit over the UTF-8 bytes of a string. Used for the daily tip so Node, PHP, the CLI and agents agree.
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(str)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Entries that may be served: ready, and (for updates) not newer than the running version.
export function servable(entries, runningVersion) {
  return entries.filter((e) => e.status === "ready" && (e.kind !== "update" || compareVersions(e.version, runningVersion) <= 0));
}

// Remove source-only fields and apply a locale overlay ({ [uuid]: { label, description, alt } }), falling back to the source text.
export function present(entry, overlay = {}) {
  const out = {};
  for (const [k, v] of Object.entries(entry)) if (!SOURCE_ONLY.includes(k)) out[k] = v;
  const t = overlay[entry.uuid];
  if (t) {
    if (t.label) out.label = t.label;
    if (t.description) out.description = t.description;
    if (t.alt && out.visual) out.visual = { ...out.visual, alt: t.alt };
  }
  if (out.visual && out.visual.mode === "screenshot") {
    // the image itself is served by the authenticated visual route; the file name stays internal
    const { file, ...rest } = out.visual;
    out.visual = { ...rest, url: `${entry.uuid}/visual` };
  }
  return out;
}

// Highest version among servable updates. Releases without curated entries never change it, so they never re-trigger the chip.
export function latestVersion(entries, runningVersion) {
  let best = null;
  for (const e of servable(entries, runningVersion)) if (e.kind === "update" && (best === null || compareVersions(e.version, best) > 0)) best = e.version;
  return best;
}

// Resolve a type filter given as a key ("block") or a uuid.
function typeUuid(types, value) {
  const t = types.find((x) => x.key === value || x.uuid === value);
  return t ? t.uuid : value;
}

// Newest first for updates, then tips in source order.
function sortEntries(list) {
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "update" ? -1 : 1;
    if (a.kind === "update") return compareVersions(b.version, a.version);
    return 0;
  });
}

// List with filters and paging. query keys follow the HAX API conventions: filter[kind], filter[type], filter[sinceVersion], filter[beforeVersion], page.limit, page.offset.
export function list(data, runningVersion, query = {}, overlay = {}) {
  const { entries, types } = data;
  let items = servable(entries, runningVersion);
  if (query["filter[kind]"]) items = items.filter((e) => e.kind === query["filter[kind]"]);
  if (query["filter[type]"]) {
    const t = typeUuid(types, query["filter[type]"]);
    items = items.filter((e) => e.type === t);
  }
  if (query["filter[beforeVersion]"]) items = items.filter((e) => e.kind === "update" && compareVersions(e.version, query["filter[beforeVersion]"]) < 0);
  if (query["filter[sinceVersion]"]) items = items.filter((e) => e.kind === "update" && compareVersions(e.version, query["filter[sinceVersion]"]) > 0);
  items = sortEntries(items);
  const total = items.length;
  const offset = Math.max(0, parseInt(query["page.offset"] ?? 0, 10) || 0);
  const limit = Math.max(1, Math.min(100, parseInt(query["page.limit"] ?? 50, 10) || 50));
  return {
    latestVersion: latestVersion(entries, runningVersion),
    total,
    items: items.slice(offset, offset + limit).map((e) => present(e, overlay)),
    types: typesMap(types, overlay),
  };
}

// Updates for the latest version only.
export function latest(data, runningVersion, overlay = {}) {
  const v = latestVersion(data.entries, runningVersion);
  const items = v === null ? [] : servable(data.entries, runningVersion).filter((e) => e.kind === "update" && compareVersions(e.version, v) === 0);
  return { latestVersion: v, items: items.map((e) => present(e, overlay)), types: typesMap(data.types, overlay) };
}

// Tip of the day: deterministic per UTC date (and optional seed), skipping excluded uuids.
export function dailyTip(data, runningVersion, date, { exclude = [], seed = "" } = {}, overlay = {}) {
  const tips = servable(data.entries, runningVersion).filter((e) => e.kind === "tip" && !exclude.includes(e.uuid));
  if (!tips.length) return null;
  const day = date.toISOString().slice(0, 10);
  return present(tips[fnv1a(`${day}:${seed}`) % tips.length], overlay);
}

export function typesMap(types, overlay = {}) {
  const out = {};
  for (const t of [...types].sort((a, b) => a.order - b.order)) out[t.uuid] = present(t, overlay);
  return out;
}

export function getEntry(data, runningVersion, uuid, overlay = {}) {
  const e = servable(data.entries, runningVersion).find((x) => x.uuid === uuid);
  return e ? present(e, overlay) : null;
}

// The source record behind a screenshot visual (internal: the route streams data/visuals/<file>).
export function visualFile(data, runningVersion, uuid) {
  const e = servable(data.entries, runningVersion).find((x) => x.uuid === uuid);
  return e && e.visual && e.visual.mode === "screenshot" ? e.visual.file : null;
}

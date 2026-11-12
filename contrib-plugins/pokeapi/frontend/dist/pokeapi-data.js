// PokeAPI data shaping, shared by the plugin's Node entry (search) and the pokeapi-card element (cards).
// Pure: no I/O, no globals, plain data in and out. src/php/Plugin.php ports it; the plugin's cases run both.
// It lives under frontend/dist so the element can load it as an asset; the Node entry imports the same file.

/** Where PokeAPI's own artwork lives (the list endpoint has no images, so search previews are built from the id). */
export const ARTWORK_BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/";
export const PER_PAGE = 20;
// highest base stat in the games; bars are drawn against it
export const STAT_MAX = 255;
const STAT_ORDER = ["hp", "attack", "defense", "special-attack", "special-defense", "speed"];
const STAT_LABELS = { hp: "HP", attack: "Attack", defense: "Defense", "special-attack": "Sp. Atk", "special-defense": "Sp. Def", speed: "Speed" };

/** The numeric id at the end of a PokeAPI resource URL (".../pokemon/25/"), or 0. */
export function idFromUrl(url) {
  const m = /\/(\d+)\/?$/.exec(String(url || ""));
  return m ? Number(m[1]) : 0;
}

/** "mr-mime" -> "Mr Mime": a readable title from a resource name when no localized name is available. */
export function titleCase(name) {
  return String(name || "")
    .split("-")
    .filter((w) => w !== "")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function artworkUrl(id) {
  return id > 0 ? `${ARTWORK_BASE}${id}.png` : "";
}

/** A search term as the index compares it: trimmed, lower case, spaces as dashes ("mr mime" finds "mr-mime"). */
export function normalizeQuery(q) {
  return String(q == null ? "" : q).trim().toLowerCase().replace(/\s+/g, "-");
}

/** Page number from a query value: a whole number of at least 1, anything else is 1. */
export function toPage(value) {
  const m = /^\s*(\d+)\s*$/.exec(String(value == null ? "" : value));
  const n = m ? Number(m[1]) : 1;
  return n >= 1 ? n : 1;
}

/**
 * One page of matches from the full /pokemon list ({ results: [{ name, url }] }).
 * A number matches that id exactly; text matches names containing it; nothing lists everything. Names that start with
 * the term come first, then the rest, each group in id order, so "pika" puts pikachu before raichu-like neighbours.
 */
export function searchIndex(list, query, page) {
  const results = list && Array.isArray(list.results) ? list.results : [];
  const q = normalizeQuery(query);
  const all = [];
  for (const r of results) {
    const name = String((r && r.name) || "");
    const id = idFromUrl(r && r.url);
    if (name === "" || id === 0) continue;
    all.push({ id, name });
  }
  let hits;
  if (q === "") hits = all;
  else if (/^\d+$/.test(q)) hits = all.filter((r) => r.id === Number(q));
  else {
    const starts = all.filter((r) => r.name.indexOf(q) === 0);
    const inside = all.filter((r) => r.name.indexOf(q) > 0);
    hits = starts.concat(inside);
  }
  const total = hits.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / PER_PAGE);
  const p = toPage(page);
  const items = hits.slice((p - 1) * PER_PAGE, p * PER_PAGE).map((r) => ({
    id: r.id,
    name: r.name,
    title: titleCase(r.name),
    details: `#${r.id}`,
    image: artworkUrl(r.id),
  }));
  return { items, page: p, total_pages: totalPages, total };
}

/** The entry for a language in a PokeAPI localized list ([{ language: { name }, ... }]), falling back to English. */
function localized(list, lang, pick) {
  const entries = Array.isArray(list) ? list : [];
  const want = String(lang || "en").toLowerCase();
  const of = (code) => entries.filter((e) => e && e.language && e.language.name === code);
  // the last entry is the most recent game's wording
  const match = of(want).length ? of(want) : of("en");
  return match.length ? pick(match[match.length - 1]) : "";
}

/** Flavor text arrives with the games' line breaks and form feeds; one plain line reads better on a card. */
export function cleanText(s) {
  return String(s || "").replace(/[\f\n\r\t­]+/g, " ").replace(/ {2,}/g, " ").trim();
}

/**
 * Everything the card shows, from /pokemon/{name} and (optionally) /pokemon-species/{name}.
 * Units: PokeAPI gives height in decimetres and weight in hectograms; the card shows metres and kilograms.
 */
export function toCard(pokemon, species, lang) {
  const p = pokemon || {};
  const s = species || {};
  const id = Number(p.id) || 0;
  const stats = {};
  for (const st of Array.isArray(p.stats) ? p.stats : []) {
    const n = st && st.stat && st.stat.name;
    if (n) stats[n] = Number(st.base_stat) || 0;
  }
  const sprites = p.sprites || {};
  const other = sprites.other || {};
  const art = (other["official-artwork"] && other["official-artwork"].front_default) || sprites.front_default || artworkUrl(id);
  const cries = p.cries || {};
  const types = (Array.isArray(p.types) ? p.types.slice() : [])
    .sort((a, b) => (Number(a && a.slot) || 0) - (Number(b && b.slot) || 0))
    .map((t) => (t && t.type && t.type.name) || "")
    .filter((t) => t !== "");
  const abilities = (Array.isArray(p.abilities) ? p.abilities.slice() : [])
    .sort((a, b) => (Number(a && a.slot) || 0) - (Number(b && b.slot) || 0))
    .map((a) => ({ name: titleCase((a && a.ability && a.ability.name) || ""), hidden: !!(a && a.is_hidden) }))
    .filter((a) => a.name !== "");
  return {
    id,
    name: String(p.name || ""),
    title: localized(s.names, lang, (e) => String(e.name || "")) || titleCase(p.name),
    genus: localized(s.genera, lang, (e) => String(e.genus || "")),
    flavor: cleanText(localized(s.flavor_text_entries, lang, (e) => String(e.flavor_text || ""))),
    types,
    hp: stats.hp || 0,
    stats: STAT_ORDER.filter((k) => k in stats).map((k) => ({ key: k, label: STAT_LABELS[k], value: stats[k] })),
    abilities,
    heightM: Math.round(Number(p.height) || 0) / 10,
    weightKg: Math.round(Number(p.weight) || 0) / 10,
    image: String(art || ""),
    cry: String(cries.latest || cries.legacy || ""),
  };
}

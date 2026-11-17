// PokeAPI (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Searching reads the full PokeAPI list once, keeps it in the system store, and filters it here: PokeAPI accepts
// only limit and offset (no search) and its list carries no images.
import { searchIndex } from "../../frontend/dist/pokeapi-data.js";

const PUBLIC_HOST = "pokeapi.co";
const DEFAULT_BASE = "https://pokeapi.co/api/v2";
// every Pokémon in one call; PokeAPI documents limit and offset as its only query parameters
const LIST_QUERY = "pokemon?limit=100000&offset=0";

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ""; }
}

/** The configured PokeAPI address without trailing slashes. */
function baseOf(ctx) {
  return String(ctx.settings.apiBase || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

/** The mirror key header, only for a mirror: the public API takes no key, so sending one there would only leak it. */
function headersFor(ctx, base) {
  const key = String(ctx.settings.apiKey || "");
  if (key === "" || hostOf(base) === PUBLIC_HOST) return {};
  return { [String(ctx.settings.apiKeyHeader || "x-api-key").trim().toLowerCase()]: key };
}

/** The stored list when it is fresh for this address; otherwise a new copy, or the stale one if PokeAPI is down. */
async function loadIndex(ctx) {
  const base = baseOf(ctx);
  const stored = await ctx.storage.read("index");
  const usable = !!stored && stored.base === base && Array.isArray(stored.results);
  const maxAge = Math.max(0, Number(ctx.settings.cacheHours) || 0) * 3600000;
  if (usable && ctx.now() - Number(stored.fetchedAt || 0) < maxAge) return stored;
  try {
    const res = await ctx.fetch(`${base}/${LIST_QUERY}`, { headers: headersFor(ctx, base) });
    if (!res.ok) throw new Error(`answered ${res.status}`);
    const data = await res.json();
    if (!data || !Array.isArray(data.results)) throw new Error("answered without a results list");
    const record = { base, fetchedAt: ctx.now(), results: data.results.map((r) => ({ name: String((r && r.name) || ""), url: String((r && r.url) || "") })) };
    await ctx.storage.write("index", record);
    return record;
  } catch (e) {
    if (usable) {
      ctx.log.warn(`PokeAPI list refresh failed (${e.message}); searching the stored list`);
      return stored;
    }
    ctx.log.warn(`PokeAPI list could not be loaded: ${e.message}`);
    return null;
  }
}

export default {
  operations: {
    /**
     * Implements operation pokeapiSearch.
     *
     * Answers the appstore's browse: one page of Pokémon whose name contains the query (or whose number is the
     * query), with artwork previews, from the stored PokeAPI list. Refreshes the list when it is older than
     * cacheHours or the PokeAPI address changed.
     *
     * @param {object} ctx
     * @param {object} req  req.query { query, page }.
     * @returns {Promise<object>}  { items, page, total_pages, total }, or 502 when PokeAPI is unreachable and nothing is stored.
     */
    async pokeapiSearch(ctx, req) {
      const q = req.query || {};
      const index = await loadIndex(ctx);
      if (!index) return { status: 502, body: { error: "PokeAPI could not be reached" } };
      return searchIndex(index, q.query, q.page);
    },
  },
  hooks: {
    /**
     * Implements hook config.before.save.
     *
     * Refuses an address that is not a web address, and a mirror key that would go to the public API (which needs
     * none) or over plain http.
     *
     * @param {object} ctx  subject: { plugin, scope, values }.
     * @returns {Promise<*>}  the subject unchanged, or a veto (422).
     */
    "config.before.save": async (ctx) => {
      const v = (ctx.subject && ctx.subject.values) || {};
      let url = null;
      try { url = new URL(String(v.apiBase || "").trim()); } catch { url = null; }
      if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return ctx.veto("The PokeAPI address must be a web address, such as https://pokeapi.co/api/v2", 422);
      if (String(v.apiKey || "") === "") return ctx.subject;
      if (url.hostname.toLowerCase() === PUBLIC_HOST) return ctx.veto("PokeAPI itself needs no key. A key is only for your own mirror: set the mirror's address first.", 422);
      if (url.protocol !== "https:") return ctx.veto("A mirror key may only be sent over https", 422);
      return ctx.subject;
    },
  },
};

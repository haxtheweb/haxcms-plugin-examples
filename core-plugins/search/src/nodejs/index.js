// Site search index (Node). Mirrored in src/php/Plugin.php; identical bytes.
// Format kept for the site-search element: [{ id, title, created, location, description, text }].
const ms = (v, fallback) => { const n = Number(v); if (v === undefined || v === null || v === "" || Number.isNaN(n)) return fallback; return n < 1e12 ? n * 1000 : n; };
// lower case, no tags, no apostrophes, single spaces (core's version meant to drop other symbols but used a string
// where it needed a regular expression, so it never did; this one does)
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
export const clean = (html) => String(html || "").replace(/<[^>]*>/g, " ").replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (m, k) => ENT[k]).toLowerCase().replace(/'/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// lunr refs are kept short, as core does
const ref = (id) => String(id).replace(/-/g, "").replace(/^item/, "").slice(0, 29);

export default {
  hooks: {
    /**
     * Implements hook rebuild.after.
     *
     * Writes lunrSearchIndex.json from public pages in outline order, in the format the site-search element reads. Both runtimes write identical bytes.
     *
     * @param {object} ctx  ctx.subject: { scope, siteId?, reason, files }.
     * @returns {Promise<void>}
     */
    "rebuild.after": async (ctx) => {
      const pages = (await ctx.entities.list("page", { listed: true })).sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id)));
      const index = pages.map((p) => ({ id: ref(p.id), title: p.title || "", created: Math.floor(ms((p.metadata || {}).created, ctx.now()) / 1000), location: p.slug || "", description: p.description || "", text: clean(p.content) }));
      await ctx.files.writeManaged("lunrSearchIndex.json", JSON.stringify(index, null, 2) + "\n");
    },
  },
};

// Sitemap (Node). Mirrored in src/php/Plugin.php; identical bytes.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const ms = (v, fallback) => { const n = Number(v); if (v === undefined || v === null || v === "" || Number.isNaN(n)) return fallback; return n < 1e12 ? n * 1000 : n; };

export default {
  hooks: {
    "rebuild.after": async (ctx) => {
      const base = ctx.site.url;
      const pages = await ctx.entities.list("page", { listed: true });
      const byId = Object.fromEntries(pages.map((p) => [p.id, p]));
      // depth from parent links (top level 1.0, second level 0.7, deeper 0.5), as core ranks them today
      const depth = (p, seen = new Set()) => (!p.parent || !byId[p.parent] || seen.has(p.id) ? 0 : 1 + depth(byId[p.parent], new Set([...seen, p.id])));
      const urls = pages
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.id).localeCompare(String(b.id)))
        .map((p) => {
          const d = depth(p);
          const lastmod = new Date(ms((p.metadata || {}).updated, ms((p.metadata || {}).created, ctx.now()))).toISOString();
          return `  <url>\n    <loc>${esc(base + String(p.slug || p.id).replace(/^\/+/, ""))}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <priority>${d === 0 ? "1.0" : d === 1 ? "0.7" : "0.5"}</priority>\n  </url>`;
        });
      await ctx.files.writeManaged("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}${urls.length ? "\n" : ""}</urlset>\n`);
      await ctx.files.writeManaged("sitemap-index.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <sitemap>\n    <loc>${esc(base + "sitemap.xml")}</loc>\n    <lastmod>${new Date(ctx.now()).toISOString()}</lastmod>\n  </sitemap>\n</sitemapindex>\n`);
    },
  },
};

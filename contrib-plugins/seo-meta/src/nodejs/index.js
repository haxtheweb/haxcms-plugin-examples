// SEO meta (Node). Mirrored in src/php/Plugin.php.
const NS = "seo-meta";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const mine = (p) => (p && p.metadata && p.metadata.plugins && p.metadata.plugins[NS]) || {};

export default {
  hooks: {
    "page.before.save": async (ctx) => {
      const m = mine(ctx.subject);
      if (m.description !== undefined) {
        const d = String(m.description).replace(/\s+/g, " ").trim();
        if (d && (d.length < 50 || d.length > 160)) ctx.warn(`search description is ${d.length} characters; 50 to 160 reads best`, "notice");
        ctx.subject.metadata.plugins[NS].description = d;
      }
      if (m.image && !/^(files\/[^\s"<>]+|https:\/\/[^\s"<>]+)$/.test(m.image)) return ctx.veto("share image must be a path under files/ or an https URL", 422);
      return ctx.subject;
    },
    "render.before.head": async (ctx) => {
      const page = ctx.subject.page || {};
      const m = mine(page);
      const base = ctx.site.url;
      const site = (await ctx.entities.get("site")) || {};
      const url = base + String(page.slug || page.id || "").replace(/^\/+/, "");
      const tags = [`<link rel="canonical" href="${esc(url)}">`, `<meta property="og:title" content="${esc(page.title || site.title || "")}">`, `<meta property="og:url" content="${esc(url)}">`];
      if (m.description) tags.push(`<meta name="description" content="${esc(m.description)}">`, `<meta property="og:description" content="${esc(m.description)}">`);
      if (m.image) tags.push(`<meta property="og:image" content="${esc(/^https:/.test(m.image) ? m.image : base + m.image)}">`);
      if (m.noindex) tags.push(`<meta name="robots" content="noindex">`);
      ctx.subject.head.push(...tags);
      return ctx.subject;
    },
  },
};

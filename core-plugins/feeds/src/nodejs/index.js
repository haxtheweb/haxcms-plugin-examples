// Feeds (Node). Mirrored in src/php/Plugin.php; both must write identical bytes.
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
const strip = (v) => String(v ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
// unix seconds or milliseconds (both appear in site.json) to milliseconds
export const ms = (v, fallback) => { const n = Number(v); if (v === undefined || v === null || v === "" || Number.isNaN(n)) return fallback; return n < 1e12 ? n * 1000 : n; };
const rfc822 = (t) => new Date(t).toUTCString();
const iso = (t) => new Date(t).toISOString();

export async function newest(ctx) {
  const now = ctx.now();
  // only what an anonymous visitor can open (published, not hidden, not region content)
  const pages = await ctx.entities.list("page", { listed: true });
  const m = (p) => p.metadata || {};
  return pages
    .map((p) => ({ ...p, created: ms(m(p).created, now), updated: ms(m(p).updated, ms(m(p).created, now)) }))
    .sort((a, b) => b.created - a.created || String(a.id).localeCompare(String(b.id)))
    .slice(0, Math.max(1, Number(ctx.settings.limit) || 25));
}

export default {
  hooks: {
    "rebuild.after": async (ctx) => {
      const site = (await ctx.entities.get("site")) || {};
      const base = ctx.site.url;
      const updated = ms(site.metadata && site.metadata.site && site.metadata.site.updated, ctx.now());
      const items = await newest(ctx);
      const link = (p) => base + String(p.slug || p.id).replace(/^\/+/, "");
      const rss = [
        `<?xml version="1.0" encoding="utf-8"?>`,
        `<rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">`,
        `  <channel>`,
        `    <title>${esc(site.title)}</title>`,
        `    <link>${esc(base)}</link>`,
        `    <description>${esc(strip(site.description))}</description>`,
        `    <lastBuildDate>${rfc822(updated)}</lastBuildDate>`,
        `    <generator>HAXcms</generator>`,
        `    <atom:link href="${esc(base + "rss.xml")}" rel="self" type="application/rss+xml"/>`,
        ...items.map((p) => {
          let d = strip(p.content);
          if (d.length > 500) d = `${d.slice(0, 497)}...`;
          return `    <item>\n      <title>${esc(p.title)}</title>\n      <link>${esc(link(p))}</link>\n      <description>${esc(d)}</description>\n      <guid>${esc(link(p))}</guid>\n      <pubDate>${rfc822(p.created)}</pubDate>\n    </item>`;
        }),
        `  </channel>`,
        `</rss>`,
        ``,
      ].join("\n");
      const author = (site.metadata && site.metadata.author && site.metadata.author.name) || "";
      const atom = [
        `<?xml version="1.0" encoding="utf-8"?>`,
        `<feed xmlns="http://www.w3.org/2005/Atom">`,
        `  <title>${esc(site.title)}</title>`,
        `  <link href="${esc(base)}" rel="self"/>`,
        `  <subtitle>${esc(strip(site.description))}</subtitle>`,
        `  <updated>${iso(updated)}</updated>`,
        `  <author><name>${esc(author)}</name></author>`,
        `  <id>${esc(base)}</id>`,
        ...items.map((p) => {
          const body = ctx.settings.fullContent ? `\n    <content type="html"><![CDATA[${String(p.content || "").replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></content>` : "";
          return `  <entry>\n    <title>${esc(p.title)}</title>\n    <id>${esc(p.id)}</id>\n    <updated>${iso(p.updated)}</updated>\n    <published>${iso(p.created)}</published>\n    <summary>${esc(p.description || "")}</summary>\n    <link href="${esc(link(p))}"/>${body}\n  </entry>`;
        }),
        `</feed>`,
        ``,
      ].join("\n");
      await ctx.files.writeManaged("rss.xml", rss);
      await ctx.files.writeManaged("atom.xml", atom);
    },
  },
};

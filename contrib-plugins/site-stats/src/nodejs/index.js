// Site stats (Node only).
const words = (html) => { const t = String(html || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").trim(); return t ? t.split(/\s+/).length : 0; };

export default {
  operations: {
    async siteStatsReport(ctx, req) {
      const pages = await ctx.entities.list("page", req.query.public ? { listed: true } : {});
      const blocks = {};
      for (const p of pages) for (const m of String(p.content || "").matchAll(/<([a-z][a-z0-9]*-[a-z0-9-]+)[\s>/]/g)) blocks[m[1]] = (blocks[m[1]] || 0) + 1;
      const top = Math.min(50, Math.max(1, Number(req.query.top) || 10));
      return {
        pages: pages.length,
        words: pages.reduce((n, p) => n + words(p.content), 0),
        blockTypes: Object.keys(blocks).length,
        blocks: Object.entries(blocks).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top).map(([tag, count]) => ({ tag, count })),
      };
    },
  },
};

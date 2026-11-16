// What a backend's own integration tests load (mirrored in src/php/Plugin.php): a field it adds on page save, a
// managed file it writes on rebuild, a route with personal data at the siteData path, and an advertised contract.
const words = (html) => {
  const text = String(html || "").split("<").map((part, i) => (i === 0 ? part : part.slice(part.indexOf(">") + 1))).join(" ").trim();
  return text ? text.split(/\s+/).length : 0;
};
export default {
  hooks: {
    "page.before.save": async (ctx) => {
      const p = ctx.subject;
      const metadata = p.metadata || {};
      return { ...p, metadata: { ...metadata, plugins: { ...(metadata.plugins || {}), "fx-backend": { words: words(p.content) } } } };
    },
    "rebuild.after": async (ctx) => {
      const pages = await ctx.entities.list("page", { listed: true });
      await ctx.files.writeManaged("fx-backend.txt", pages.map((pg) => pg.title).join("\n") + "\n");
    },
  },
  operations: {
    async fxBackendNotes(ctx, req) {
      return ((await ctx.storage.read("notes")) || []).filter((n) => n.pageId === req.params.pageId);
    },
    async fxBackendNote(ctx, req) {
      if (!(await ctx.entities.get("page", req.params.pageId))) return { status: 404, body: { error: "no such page" } };
      const list = (await ctx.storage.read("notes")) || [];
      const note = { id: `n${list.length + 1}`, pageId: req.params.pageId, authorId: ctx.user.id, body: String(req.body.body || "") };
      await ctx.storage.write("notes", [...list, note]);
      return note;
    },
  },
  contracts: {
    "insights.check": {
      async check(ctx) {
        const pages = await ctx.entities.list("page", { listed: true });
        return { results: { "word.count": { status: "ok", checkedAt: ctx.now(), findings: [], summary: { pages: pages.length } } } };
      },
    },
  },
};

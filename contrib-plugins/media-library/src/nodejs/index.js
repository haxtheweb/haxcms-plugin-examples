// Media library (Node only).
const isImage = (f) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(String(f.name || f.path || ""));

export default {
  operations: {
    async mediaLibraryList(ctx, req) {
      const all = await ctx.entities.list("mediaItem");
      return req.query.missingAlt ? all.filter((m) => !m.decorative && !String(m.alt || "").trim()) : all;
    },
    async mediaLibraryDescribe(ctx, req) {
      const item = await ctx.entities.get("mediaItem", req.params.uuid);
      if (!item) return { status: 404, body: { error: "not found" } };
      const b = req.body || {};
      const r = await ctx.entities.save("mediaItem", { ...item, ...Object.fromEntries(["alt", "decorative", "credit", "license"].filter((k) => k in b).map((k) => [k, b[k]])) });
      return r.veto ? { status: r.veto.status, body: { error: r.veto.message } } : r.record;
    },
  },
  hooks: {
    // fires for files and for anything extending file; only a real upload gets a library record
    "file.after.save": async (ctx) => {
      if (ctx.entityType !== "file" || !isImage(ctx.subject)) return;
      if (await ctx.entities.get("mediaItem", ctx.subject.uuid)) return;
      await ctx.entities.save("mediaItem", { ...ctx.subject, alt: "", decorative: false, credit: "", license: "" });
    },
    "entity.before.update": async (ctx) => {
      const m = ctx.subject;
      if (!m.decorative && "alt" in m && !String(m.alt).trim() && ctx.previous && String(ctx.previous.alt || "").trim()) return ctx.veto("alt text cannot be removed; mark the image decorative instead", 422);
      return m;
    },
  },
};

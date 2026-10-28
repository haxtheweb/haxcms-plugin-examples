// Media library (Node only).
const isImage = (f) => /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(String(f.name || f.path || ""));

export default {
  operations: {
    /**
     * Implements operation mediaLibraryList.
     *
     * Lists the library's images; with ?missingAlt, only those that still need alt text and are not marked decorative.
     *
     * @param {object} ctx
     * @param {object} req  req.query.missingAlt (optional).
     * @returns {Promise<array>}  mediaItem records.
     */
    async mediaLibraryList(ctx, req) {
      const all = await ctx.entities.list("mediaItem");
      return req.query.missingAlt ? all.filter((m) => !m.decorative && !String(m.alt || "").trim()) : all;
    },
    /**
     * Implements operation mediaLibraryDescribe.
     *
     * Updates an image's alt text, decorative flag, credit or license.
     *
     * @param {object} ctx
     * @param {object} req  req.params.uuid and req.body { alt, decorative, credit, license }.
     * @returns {Promise<object>}  the updated record, or a 404 or veto response.
     */
    async mediaLibraryDescribe(ctx, req) {
      const item = await ctx.entities.get("mediaItem", req.params.uuid);
      if (!item) return { status: 404, body: { error: "not found" } };
      const b = req.body || {};
      const r = await ctx.entities.save("mediaItem", { ...item, ...Object.fromEntries(["alt", "decorative", "credit", "license"].filter((k) => k in b).map((k) => [k, b[k]])) });
      return r.veto ? { status: r.veto.status, body: { error: r.veto.message } } : r.record;
    },
  },
  hooks: {
    /**
     * Implements hook file.after.save.
     *
     * Gives each newly uploaded image a library record with empty alt text, credit and license. The hook fires for
     * files and for anything extending file; only a real upload gets a record.
     *
     * @param {object} ctx  ctx.subject: the saved file; ctx.entityType: the record type.
     * @returns {Promise<undefined>}
     */
    "file.after.save": async (ctx) => {
      if (ctx.entityType !== "file" || !isImage(ctx.subject)) return;
      if (await ctx.entities.get("mediaItem", ctx.subject.uuid)) return;
      await ctx.entities.save("mediaItem", { ...ctx.subject, alt: "", decorative: false, credit: "", license: "" });
    },
    /**
     * Implements hook entity.before.update.
     *
     * Refuses an update that clears an image's existing alt text unless the image is marked decorative.
     *
     * @param {object} ctx  ctx.subject: the mediaItem as updated; ctx.previous: the stored record.
     * @returns {Promise<object>}  the record, or a veto.
     */
    "entity.before.update": async (ctx) => {
      const m = ctx.subject;
      if (!m.decorative && "alt" in m && !String(m.alt).trim() && ctx.previous && String(ctx.previous.alt || "").trim()) return ctx.veto("alt text cannot be removed; mark the image decorative instead", 422);
      return m;
    },
  },
};

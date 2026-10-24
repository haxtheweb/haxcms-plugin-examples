// Publish scheduler (Node only).
const NS = "publish-scheduler";
const mine = (p) => (p.metadata && p.metadata.plugins && p.metadata.plugins[NS]) || {};
const valid = (v) => v === null || v === undefined || !Number.isNaN(Date.parse(v));

export default {
  operations: {
    /**
     * Implements operation publishSchedulerSet.
     *
     * Sets or clears a page's publishAt and unpublishAt times, stored in metadata.plugins.publish-scheduler.
     *
     * @param {object} ctx
     * @param {object} req  req.params.pageId and req.body { publishAt, unpublishAt }.
     * @returns {object}  { pageId, publishAt, unpublishAt }, or a 404/409/422 response.
     */
    async publishSchedulerSet(ctx, req) {
      const page = await ctx.entities.get("page", req.params.pageId);
      if (!page) return { status: 404, body: { error: "no such page" } };
      const b = req.body || {};
      if (!valid(b.publishAt) || !valid(b.unpublishAt)) return { status: 422, body: { error: "publishAt and unpublishAt are ISO date-times" } };
      const next = { ...mine(page) };
      for (const k of ["publishAt", "unpublishAt"]) if (k in b) { if (b[k]) next[k] = new Date(b[k]).toISOString(); else delete next[k]; }
      page.metadata = { ...(page.metadata || {}), plugins: { ...((page.metadata || {}).plugins || {}), [NS]: next } };
      const r = await ctx.entities.save("page", page);
      return r.veto ? { status: 409, body: { error: r.veto.message } } : { pageId: page.id, ...next };
    },
    /**
     * Implements operation publishSchedulerDue.
     *
     * Lists the pages that have a publish or unpublish time set.
     *
     * @param {object} ctx
     * @returns {array}  { pageId, title, publishAt, unpublishAt } per page.
     */
    async publishSchedulerDue(ctx) {
      return (await ctx.entities.list("page")).filter((p) => mine(p).publishAt || mine(p).unpublishAt).map((p) => ({ pageId: p.id, title: p.title, ...mine(p) }));
    },
  },
  /**
   * Implements schedule publish.
   *
   * Publishes and unpublishes the pages whose times have passed, every 15 minutes. Core runs it inside one bulk
   * transaction, so git commits once for the whole batch.
   *
   * @param {object} ctx
   * @returns {object}  { published, unpublished } counts.
   */
  async publishDue(ctx) {
    const now = ctx.now();
    let published = 0, unpublished = 0;
    for (const page of await ctx.entities.list("page")) {
      const s = { ...mine(page) };
      let change = null;
      if (s.publishAt && Date.parse(s.publishAt) <= now) { change = true; delete s.publishAt; published++; }
      if (s.unpublishAt && Date.parse(s.unpublishAt) <= now) { change = false; delete s.unpublishAt; unpublished++; }
      if (change === null) continue;
      page.metadata = { ...(page.metadata || {}), published: change, plugins: { ...((page.metadata || {}).plugins || {}), [NS]: s } };
      await ctx.entities.save("page", page);
    }
    if (published || unpublished) ctx.log.info(`published ${published}, unpublished ${unpublished}`);
    return { published, unpublished };
  },
};

// Comments (Node). Mirrored in src/php/Plugin.php.
const MODERATORS = ["admin", "editor"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isMod = (user) => !!user && (user.roles || []).some((r) => MODERATORS.includes(r));
const all = async (ctx) => (await ctx.storage.read("comments")) || [];

export default {
  operations: {
    /**
     * Implements operation commentsList.
     *
     * Lists the comments on a page: approved ones for everyone, plus pending ones for moderators and for their own
     * authors. Anonymous visitors are refused unless the anonymousRead setting is on, because the operation allows
     * optional auth and leaves the filter to this handler.
     *
     * @param {object} ctx
     * @param {object} req  req.params and req.body of the request.
     * @returns {array|object}  the visible comments, or a 401 response.
     */
    async commentsList(ctx, req) {
      // optional auth: the handler applies the setting-based filter
      if (!ctx.user && !ctx.settings.anonymousRead) return { status: 401, body: { error: "sign in to read comments" } };
      const mod = isMod(ctx.user);
      return (await all(ctx)).filter((c) => c.pageId === req.params.pageId && (c.status === "approved" || mod || (ctx.user && c.authorId === ctx.user.id)));
    },
    /**
     * Implements operation commentsCreate.
     *
     * Adds a comment to a page after firing comments.before.create, so other plugins (such as spam-guard) can hold it
     * as pending, edit it or refuse it. Comments start pending when moderation is on and the author is not a
     * moderator; comments.after.create fires once it is stored.
     *
     * @param {object} ctx
     * @param {object} req  req.params and req.body of the request.
     * @returns {object}  the stored comment, or a 404/422 response.
     */
    async commentsCreate(ctx, req) {
      if (!(await ctx.entities.get("page", req.params.pageId))) return { status: 404, body: { error: "no such page" } };
      const body = String((req.body && req.body.body) || "").trim();
      if (!body || body.length > 2000) return { status: 422, body: { error: "a comment needs 1 to 2000 characters" } };
      const draft = { pageId: req.params.pageId, authorId: ctx.user.id, authorName: ctx.user.displayName || ctx.user.name, body, status: ctx.settings.moderation && !isMod(ctx.user) ? "pending" : "approved" };
      // other plugins may hold (status pending), edit or refuse it
      const before = await ctx.hooks.fire("comments.before.create", draft);
      if (before.veto) return { status: before.veto.status || 422, body: { error: before.veto.message } };
      const list = await all(ctx);
      const s = before.subject;
      const comment = { id: `c${list.length + 1}`, pageId: draft.pageId, authorId: draft.authorId, authorName: draft.authorName, body: String(s.body ?? draft.body), status: s.status === "pending" ? "pending" : draft.status };
      await ctx.storage.write("comments", [...list, comment]);
      await ctx.hooks.fire("comments.after.create", comment);
      return comment;
    },
    /**
     * Implements operation commentsModerate.
     *
     * Sets a comment to approved or rejected; only admins and editors may do this.
     *
     * @param {object} ctx
     * @param {object} req  req.params and req.body of the request.
     * @returns {object}  the updated comment, or a 403/404/422 response.
     */
    async commentsModerate(ctx, req) {
      if (!isMod(ctx.user)) return { status: 403, body: { error: "only editors can moderate" } };
      const list = await all(ctx);
      const c = list.find((x) => x.id === req.params.id);
      if (!c) return { status: 404, body: { error: "not found" } };
      if (!["approved", "rejected"].includes(req.body.status)) return { status: 422, body: { error: "status is approved or rejected" } };
      c.status = req.body.status;
      await ctx.storage.write("comments", list);
      return c;
    },
    /**
     * Implements operation commentsDelete.
     *
     * Deletes a comment when the caller wrote it or is a moderator.
     *
     * @param {object} ctx
     * @param {object} req  req.params and req.body of the request.
     * @returns {object}  { deleted: id }, or a 403/404 response.
     */
    async commentsDelete(ctx, req) {
      const list = await all(ctx);
      const c = list.find((x) => x.id === req.params.id);
      if (!c) return { status: 404, body: { error: "not found" } };
      if (c.authorId !== ctx.user.id && !isMod(ctx.user)) return { status: 403, body: { error: "not your comment" } };
      await ctx.storage.write("comments", list.filter((x) => x.id !== c.id));
      return { deleted: c.id };
    },
    /**
     * Implements operation commentsRepublish.
     *
     * Lists the pages that still show an erased user's comments in their published copy, so an editor knows what to
     * republish.
     *
     * @param {object} ctx
     * @returns {array}  page ids.
     */
    async commentsRepublish(ctx) {
      return (await ctx.storage.read("republish")) || [];
    },
  },
  hooks: {
    /**
     * Implements hook page.after.delete.
     *
     * Removes the comments of a deleted page so none are left pointing at nothing.
     *
     * @param {object} ctx  ctx.subject: the deleted page.
     * @returns {undefined}
     */
    "page.after.delete": async (ctx) => {
      const list = await all(ctx);
      const keep = list.filter((c) => c.pageId !== ctx.subject.id);
      if (keep.length !== list.length) {
        await ctx.storage.write("comments", keep);
        ctx.log.info(`removed ${list.length - keep.length} comments with page ${ctx.subject.id}`);
      }
    },
    /**
     * Implements hook render.after.content.
     *
     * Appends the page's approved comments as static HTML when the snapshot setting is on, so published and static
     * copies show them without the API.
     *
     * @param {object} ctx  ctx.subject: the render state (page, content).
     * @returns {object|undefined}  the render state with the comments section, or nothing to leave it alone.
     */
    "render.after.content": async (ctx) => {
      if (!ctx.settings.snapshot || !ctx.subject.page) return;
      const shown = (await all(ctx)).filter((c) => c.pageId === ctx.subject.page.id && c.status === "approved");
      if (!shown.length) return;
      const items = shown.map((c) => `<li><strong>${esc(c.authorName)}</strong> ${esc(c.body)}</li>`).join("");
      ctx.subject.content += `<section class="hax-comments" aria-label="Comments"><h2>Comments</h2><ul>${items}</ul></section>`;
      return ctx.subject;
    },
    /**
     * Implements hook user.before.erase.
     *
     * Records, as a transaction mark, the pages that carry the user's approved comments, while the records still
     * exist.
     *
     * @param {object} ctx  ctx.subject: { userId } of the user being erased.
     * @returns {undefined}
     */
    "user.before.erase": async (ctx) => {
      const pages = (await all(ctx)).filter((c) => c.authorId === ctx.subject.userId && c.status === "approved").map((c) => c.pageId);
      ctx.transaction.marks.commentsPages = [...new Set(pages)];
    },
    /**
     * Implements hook user.after.erase.
     *
     * Adds the marked pages to the republish list, because core already removed the user's comments from the store but
     * the published copies still name them.
     *
     * @param {object} ctx  ctx.subject: { userId, removed } with the records core removed; ctx.transaction.marks from user.before.erase.
     * @returns {undefined}
     */
    "user.after.erase": async (ctx) => {
      if (!ctx.subject.removed["comments.comments"] || !(ctx.transaction.marks.commentsPages || []).length) return;
      const pages = new Set((await ctx.storage.read("republish")) || []);
      for (const id of ctx.transaction.marks.commentsPages || []) pages.add(id);
      await ctx.storage.write("republish", [...pages].sort());
      ctx.log.warn("an erased user had comments; republish the listed pages so the published copies drop them");
    },
  },
};

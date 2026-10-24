// Comments (Node). Mirrored in src/php/Plugin.php.
const MODERATORS = ["admin", "editor"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isMod = (user) => !!user && (user.roles || []).some((r) => MODERATORS.includes(r));
const all = async (ctx) => (await ctx.storage.read("comments")) || [];

export default {
  operations: {
    async commentsList(ctx, req) {
      // optional auth: the handler applies the setting-based filter
      if (!ctx.user && !ctx.settings.anonymousRead) return { status: 401, body: { error: "sign in to read comments" } };
      const mod = isMod(ctx.user);
      return (await all(ctx)).filter((c) => c.pageId === req.params.pageId && (c.status === "approved" || mod || (ctx.user && c.authorId === ctx.user.id)));
    },
    async commentsCreate(ctx, req) {
      if (!(await ctx.entities.get("page", req.params.pageId))) return { status: 404, body: { error: "no such page" } };
      const body = String((req.body && req.body.body) || "").trim();
      if (!body || body.length > 2000) return { status: 422, body: { error: "a comment needs 1 to 2000 characters" } };
      const list = await all(ctx);
      const comment = {
        id: `c${list.length + 1}`, pageId: req.params.pageId, authorId: ctx.user.id, authorName: ctx.user.displayName || ctx.user.name,
        body, status: ctx.settings.moderation && !isMod(ctx.user) ? "pending" : "approved",
      };
      await ctx.storage.write("comments", [...list, comment]);
      return comment;
    },
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
    async commentsDelete(ctx, req) {
      const list = await all(ctx);
      const c = list.find((x) => x.id === req.params.id);
      if (!c) return { status: 404, body: { error: "not found" } };
      if (c.authorId !== ctx.user.id && !isMod(ctx.user)) return { status: 403, body: { error: "not your comment" } };
      await ctx.storage.write("comments", list.filter((x) => x.id !== c.id));
      return { deleted: c.id };
    },
    async commentsRepublish(ctx) {
      return (await ctx.storage.read("republish")) || [];
    },
  },
  hooks: {
    "page.after.delete": async (ctx) => {
      const list = await all(ctx);
      const keep = list.filter((c) => c.pageId !== ctx.subject.id);
      if (keep.length !== list.length) {
        await ctx.storage.write("comments", keep);
        ctx.log.info(`removed ${list.length - keep.length} comments with page ${ctx.subject.id}`);
      }
    },
    "render.after.content": async (ctx) => {
      if (!ctx.settings.snapshot || !ctx.subject.page) return;
      const shown = (await all(ctx)).filter((c) => c.pageId === ctx.subject.page.id && c.status === "approved");
      if (!shown.length) return;
      const items = shown.map((c) => `<li><strong>${esc(c.authorName)}</strong> ${esc(c.body)}</li>`).join("");
      ctx.subject.content += `<section class="hax-comments" aria-label="Comments"><h2>Comments</h2><ul>${items}</ul></section>`;
      return ctx.subject;
    },
    // the records are still there: remember the pages this user's approved comments appear on (a transaction mark)
    "user.before.erase": async (ctx) => {
      const pages = (await all(ctx)).filter((c) => c.authorId === ctx.subject.userId && c.status === "approved").map((c) => c.pageId);
      ctx.transaction.marks.commentsPages = [...new Set(pages)];
    },
    // core already removed the user's comments from the store; the published copies still name them
    "user.after.erase": async (ctx) => {
      if (!ctx.subject.removed["comments.comments"] || !(ctx.transaction.marks.commentsPages || []).length) return;
      const pages = new Set((await ctx.storage.read("republish")) || []);
      for (const id of ctx.transaction.marks.commentsPages || []) pages.add(id);
      await ctx.storage.write("republish", [...pages].sort());
      ctx.log.warn("an erased user had comments; republish the listed pages so the published copies drop them");
    },
  },
};

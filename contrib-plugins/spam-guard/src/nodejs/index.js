// Spam guard (Node only). Subscribes to comments.before.create, which the comments plugin defines and fires.
export default {
  hooks: {
    /**
     * Implements hook comments.before.create.
     *
     * Refuses comments with more links than the maxLinks setting allows and holds comments that contain a blocked word
     * as pending for review. The comments plugin defines and fires this hook.
     *
     * @param {object} ctx  ctx.subject: the draft comment (pageId, authorId, authorName, body, status).
     * @returns {Promise<object>}  the comment (status pending when held), or a veto.
     */
    "comments.before.create": async (ctx) => {
      const c = ctx.subject;
      const links = (String(c.body).match(/https?:\/\/|www\./gi) || []).length;
      if (links > (Number(ctx.settings.maxLinks) || 0)) return ctx.veto(`comments may contain at most ${Number(ctx.settings.maxLinks) || 0} link(s)`, 422);
      const words = String(ctx.settings.blockedWords || "").split("\n").map((w) => w.trim().toLowerCase()).filter(Boolean);
      const hit = words.find((w) => String(c.body).toLowerCase().includes(w));
      if (hit) { ctx.log.info(`held a comment on ${c.pageId} for review (blocked word)`); return { ...c, status: "pending" }; }
      return c;
    },
  },
};

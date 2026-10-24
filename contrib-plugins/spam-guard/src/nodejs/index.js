// Spam guard (Node only). Subscribes to comments.before.create, which the comments plugin defines and fires.
export default {
  hooks: {
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

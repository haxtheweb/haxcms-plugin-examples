// Notifications (Node only). Both hooks are detached: they run after the response, and a Slack outage never slows a save.
async function post(ctx, text) {
  try {
    const res = await ctx.fetch(ctx.settings.webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok) ctx.log.warn(`Slack answered ${res.status}`);
  } catch (e) { ctx.log.warn(`could not reach Slack: ${e.message}`); }
}

export default {
  hooks: {
    "config.before.save": async (ctx) => {
      const w = ctx.subject.values.webhook;
      if (w && !/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(w)) return ctx.veto("the webhook must be a https://hooks.slack.com/services/... URL", 422);
      return ctx.subject;
    },
    "comments.after.create": async (ctx) => {
      if (ctx.settings.onPending && ctx.subject.status === "pending") await post(ctx, `A comment by ${ctx.subject.authorName} on ${ctx.site.url}${ctx.subject.pageId} is waiting for review.`);
    },
    "schedule.after.run": async (ctx) => {
      if (ctx.settings.onJobFailure && !ctx.subject.ok) await post(ctx, `Scheduled job ${ctx.subject.plugin}/${ctx.subject.job} failed: ${ctx.subject.error}`);
    },
  },
};

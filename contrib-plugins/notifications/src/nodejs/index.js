// Notifications (Node only). Both hooks are detached: they run after the response, and a Slack outage never slows a save.
async function post(ctx, text) {
  try {
    const res = await ctx.fetch(ctx.settings.webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok) ctx.log.warn(`Slack answered ${res.status}`);
  } catch (e) { ctx.log.warn(`could not reach Slack: ${e.message}`); }
}

export default {
  hooks: {
    /**
     * Implements hook config.before.save.
     *
     * Refuses a webhook setting that is not a https://hooks.slack.com/services/ URL.
     *
     * @param {object} ctx  ctx.subject: the settings being saved (values); ctx.previous: the stored settings.
     * @returns {Promise<object>}  the settings, or a veto.
     */
    "config.before.save": async (ctx) => {
      const w = ctx.subject.values.webhook;
      if (w && !/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(w)) return ctx.veto("the webhook must be a https://hooks.slack.com/services/... URL", 422);
      return ctx.subject;
    },
    /**
     * Implements hook comments.after.create.
     *
     * Posts to Slack when a new comment is waiting for review, if onPending is on. Detached, so a Slack outage never
     * slows a save.
     *
     * @param {object} ctx  ctx.subject: the stored comment.
     * @returns {Promise<undefined>}
     */
    "comments.after.create": async (ctx) => {
      if (ctx.settings.onPending && ctx.subject.status === "pending") await post(ctx, `A comment by ${ctx.subject.authorName} on ${ctx.site.url}${ctx.subject.pageId} is waiting for review.`);
    },
    /**
     * Implements hook schedule.after.run.
     *
     * Posts to Slack when a scheduled job of any plugin fails, if onJobFailure is on. Detached, so a Slack outage
     * never slows a run.
     *
     * @param {object} ctx  ctx.subject: the run result (plugin, job, ok, error).
     * @returns {Promise<undefined>}
     */
    "schedule.after.run": async (ctx) => {
      if (ctx.settings.onJobFailure && !ctx.subject.ok) await post(ctx, `Scheduled job ${ctx.subject.plugin}/${ctx.subject.job} failed: ${ctx.subject.error}`);
    },
  },
};

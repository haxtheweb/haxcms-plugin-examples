// xAPI statements (Node only). Statements queue per site and go to the LRS in batches.
const VERBS = { completed: "http://adlnet.gov/expapi/verbs/completed", answered: "http://adlnet.gov/expapi/verbs/answered", experienced: "http://adlnet.gov/expapi/verbs/experienced" };

export default {
  operations: {
    /**
     * Implements operation xapiStatementsRecord.
     *
     * Queues a completed, answered or experienced statement for the signed-in user; the flush schedule sends the queue
     * to the LRS.
     *
     * @param {object} ctx
     * @param {object} req  req.body { verb, object, result }.
     * @returns {Promise<object>}  { queued: id }, or a 422 response.
     */
    async xapiStatementsRecord(ctx, req) {
      const b = req.body || {};
      if (!VERBS[b.verb]) return { status: 422, body: { error: `verb must be one of ${Object.keys(VERBS).join(", ")}` } };
      const queue = (await ctx.storage.read("queue")) || [];
      const st = { id: `st-${queue.length + 1}-${ctx.now()}`, userId: ctx.user.id, verb: b.verb, object: String(b.object), result: b.result || null, at: new Date(ctx.now()).toISOString() };
      await ctx.storage.write("queue", [...queue, st]);
      return { queued: st.id };
    },
  },
  /**
   * Implements schedule flush.
   *
   * Sends the whole queue to the LRS in one POST every five minutes, and empties it only when the LRS accepts it. It
   * remembers which statement ids went out for each user, for privacy export and delete.
   *
   * @param {object} ctx
   * @returns {Promise<object>}  { sent } count; throws when the LRS refuses, so the run is reported as failed.
   */
  async flush(ctx) {
    const queue = (await ctx.storage.read("queue")) || [];
    if (!queue.length) return { sent: 0 };
    const body = queue.map((s) => ({ id: s.id, actor: { account: { homePage: ctx.site.url, name: s.userId } }, verb: { id: VERBS[s.verb] }, object: { id: s.object }, ...(s.result ? { result: s.result } : {}), timestamp: s.at }));
    const res = await ctx.fetch(ctx.settings.endpoint, { method: "POST", headers: { "content-type": "application/json", "x-experience-api-version": "1.0.3", authorization: `Basic ${Buffer.from(String(ctx.settings.auth)).toString("base64")}` }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`LRS answered ${res.status}`);
    const sent = (await ctx.storage.read("sent")) || {};
    for (const s of queue) sent[s.userId] = [...(sent[s.userId] || []), s.id];
    await ctx.storage.write("sent", sent);
    await ctx.storage.write("queue", []);
    return { sent: queue.length };
  },
  contracts: {
    "privacy.export": {
      /**
       * Implements contract privacy.export, operation export.
       *
       * Adds the ids of the user's statements that already went to the LRS, and the LRS host. Core exports the queue
       * itself (personalData store).
       *
       * @param {object} ctx
       * @param {object} input  { userId }.
       * @returns {Promise<object|null>}  { sentToLrs }, or null when nothing was sent.
       */
      async export(ctx, { userId }) {
        const ids = ((await ctx.storage.read("sent")) || {})[userId] || [];
        return ids.length ? { sentToLrs: { host: new URL(ctx.settings.endpoint).hostname, statementIds: ids } } : null;
      },
    },
    "privacy.delete": {
      /**
       * Implements contract privacy.delete, operation delete.
       *
       * Forgets which statements went to the LRS for the user and warns the admin to void them there. Core erases the
       * queue; the LRS keeps its copies.
       *
       * @param {object} ctx
       * @param {object} input  { userId }.
       * @returns {Promise<object>}  { removed } count.
       */
      async delete(ctx, { userId }) {
        const sent = (await ctx.storage.read("sent")) || {};
        const ids = sent[userId] || [];
        if (!ids.length) return { removed: 0 };
        delete sent[userId];
        await ctx.storage.write("sent", sent);
        ctx.log.warn(`${ids.length} statements for an erased user remain in the LRS at ${new URL(ctx.settings.endpoint).hostname}; void them there`);
        return { removed: ids.length };
      },
    },
  },
};

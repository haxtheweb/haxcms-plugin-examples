// Sends a request to the named host, with the secret key in a header when withKey=1; reports what happened.
export default { operations: {
  /**
   * Implements operation fxSecretHostSend.
   *
   * Fetches https://<host>/x, carrying the key as a bearer token when asked.
   *
   * @param {object} ctx
   * @param {object} req  req.query { host, withKey }.
   * @returns {Promise<object>}  { status } of the answer, or 502 with the refusal.
   */
  async fxSecretHostSend(ctx, req) {
    const headers = req.query.withKey === "1" ? { authorization: `Bearer ${ctx.settings.key}` } : {};
    try {
      const res = await ctx.fetch(`https://${req.query.host}/x`, { headers });
      return { answered: res.status };
    } catch (e) {
      return { status: 502, body: { error: e.message } };
    }
  },
} };

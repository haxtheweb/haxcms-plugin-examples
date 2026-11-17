// Counts in a store, to show what ctx.storage.update is for: twenty changes at once, each read-change-write.
const pause = () => new Promise((r) => setImmediate(r));
export default { operations: {
  /**
   * Implements operation fxTallyBurst.
   *
   * Adds one to the tally twenty times at once through ctx.storage.update; every one counts.
   *
   * @param {object} ctx
   * @returns {Promise<object>}  { n } after the burst.
   */
  async fxTallyBurst(ctx) {
    await Promise.all(Array.from({ length: 20 }, () => ctx.storage.update("tally", async (v) => { await pause(); return { n: ((v && v.n) || 0) + 1 }; })));
    return ctx.storage.read("tally");
  },
  /**
   * Implements operation fxTallyCareless.
   *
   * The same burst with a read followed by a write, which is how votes get lost: reported, not asserted to a number.
   *
   * @param {object} ctx
   * @returns {Promise<object>}  { n } after the burst.
   */
  async fxTallyCareless(ctx) {
    await ctx.storage.write("tally", { n: 0 });
    await Promise.all(Array.from({ length: 20 }, async () => { const v = await ctx.storage.read("tally"); await pause(); await ctx.storage.write("tally", { n: v.n + 1 }); }));
    return ctx.storage.read("tally");
  },
  /**
   * Implements operation fxTallyVote.
   *
   * A public vote, limited to three a minute for one caller.
   *
   * @param {object} ctx
   * @returns {Promise<object>}  { n } after the vote.
   */
  async fxTallyVote(ctx) {
    return ctx.storage.update("tally", (v) => ({ n: ((v && v.n) || 0) + 1 }));
  },
} };

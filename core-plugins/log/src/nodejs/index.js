// Log (Node). Mirrored in src/php/Plugin.php.
const RANK = { info: 0, warn: 1, error: 2 };
const keep = (ctx) => Math.max(1, Number(ctx.settings.maxEntries) || 500);

export default {
  contracts: {
    "log.sink": {
      /**
       * Implements contract log.sink, operation write.
       *
       * Appends each entry core hands over to the stored history, capped at maxEntries; entries below the configured level are dropped.
       *
       * @param {object} ctx    Platform context (spec/13); ctx.settings.level and ctx.settings.maxEntries.
       * @param {object} entry  { time, level, plugin, scope, message }.
       * @returns {Promise<void>}
       */
      async write(ctx, entry) {
        if ((RANK[entry.level] ?? 0) < (RANK[ctx.settings.level] ?? 0)) return;
        const entries = (await ctx.storage.read("entries")) || [];
        entries.push({ time: entry.time ?? null, level: entry.level, plugin: entry.plugin || "core", scope: entry.scope || "system", message: String(entry.message).slice(0, 2000) });
        await ctx.storage.write("entries", entries.slice(-keep(ctx)));
      },
    },
  },
  operations: {
    /**
     * Implements operation logList.
     *
     * Returns the newest entries first, filtered by plugin and level, for the log page.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.query: { plugin, level, limit (default 100, at most 500) }.
     * @returns {Promise<object>}  { items, total }.
     */
    async logList(ctx, req) {
      const q = req.query;
      const items = ((await ctx.storage.read("entries")) || []).filter((e) => (!q.plugin || e.plugin === q.plugin) && (!q.level || e.level === q.level)).reverse().slice(0, Math.min(500, Number(q.limit) || 100));
      return { items, total: items.length };
    },
  },
  /**
   * Implements schedule rotate.
   *
   * Keeps only the newest maxEntries each month; writes already cap the size, and this also drops a month's backlog.
   *
   * @param {object} ctx  Platform context (spec/13).
   * @returns {Promise<void>}
   */
  async rotate(ctx) {
    const entries = (await ctx.storage.read("entries")) || [];
    await ctx.storage.write("entries", entries.slice(-keep(ctx)));
  },
};

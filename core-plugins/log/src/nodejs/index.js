// Log (Node). Mirrored in src/php/Plugin.php.
const RANK = { info: 0, warn: 1, error: 2 };
const keep = (ctx) => Math.max(1, Number(ctx.settings.maxEntries) || 500);

export default {
  contracts: {
    "log.sink": {
      // core calls this for every entry; entries below the configured level are dropped
      async write(ctx, entry) {
        if ((RANK[entry.level] ?? 0) < (RANK[ctx.settings.level] ?? 0)) return;
        const entries = (await ctx.storage.read("entries")) || [];
        entries.push({ time: entry.time ?? null, level: entry.level, plugin: entry.plugin || "core", scope: entry.scope || "system", message: String(entry.message).slice(0, 2000) });
        await ctx.storage.write("entries", entries.slice(-keep(ctx)));
      },
    },
  },
  operations: {
    async logList(ctx, req) {
      const q = req.query;
      const items = ((await ctx.storage.read("entries")) || []).filter((e) => (!q.plugin || e.plugin === q.plugin) && (!q.level || e.level === q.level)).reverse().slice(0, Math.min(500, Number(q.limit) || 100));
      return { items, total: items.length };
    },
  },
  // monthly: keep only the newest maxEntries (writes already cap the size; this also drops a month's backlog)
  async rotate(ctx) {
    const entries = (await ctx.storage.read("entries")) || [];
    await ctx.storage.write("entries", entries.slice(-keep(ctx)));
  },
};

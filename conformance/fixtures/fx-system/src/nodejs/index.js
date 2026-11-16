// System engine probe: a system store works with no site; a site store refuses
export default { operations: {
  async fxSystemCount(ctx) { const n = ((await ctx.storage.read("counts")) || 0) + 1; await ctx.storage.write("counts", n); return { count: n, site: ctx.site }; },
  async fxSystemPerSite(ctx) { await ctx.storage.write("perSite", 1); return { ok: true }; },
} };

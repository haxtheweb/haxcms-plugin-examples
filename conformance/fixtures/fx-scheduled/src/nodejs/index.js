// Schedule handlers are top-level exports named in plugin.yaml schedules.
export default {
  async tick(ctx) { const n = ((await ctx.storage.read("ticks")) || 0) + 1; await ctx.storage.write("ticks", n); return { ticks: n }; },
  async broken() { throw new Error("job exploded"); },
};

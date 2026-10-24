// Page cache (Node). Mirrored in src/php/Plugin.php.
const usable = (ctx) => ctx.subject.mode === "dynamic" && !ctx.user && ctx.subject.page && ctx.subject.page.id;
async function clear(ctx, why) {
  const had = Object.keys((await ctx.storage.read("pages")) || {}).length;
  await ctx.storage.write("pages", {});
  if (had) ctx.log.info(`cleared ${had} cached pages (${why})`);
  return had;
}

export default {
  operations: {
    async pageCacheClear(ctx) { return { cleared: await clear(ctx, "by request") }; },
  },
  hooks: {
    "render.before": async (ctx) => {
      if (!usable(ctx)) return;
      const hit = ((await ctx.storage.read("pages")) || {})[ctx.subject.page.id];
      const ttl = Number(ctx.settings.ttl) || 0;
      if (hit && (!ttl || ctx.now() - hit.at < ttl * 1000)) return ctx.respond(hit.html);
    },
    "render.after": async (ctx) => {
      if (!usable(ctx) || ctx.subject.cacheable === false) return;
      const pages = (await ctx.storage.read("pages")) || {};
      pages[ctx.subject.page.id] = { html: ctx.subject.html, at: ctx.now() };
      await ctx.storage.write("pages", pages);
    },
    "page.after.save": async (ctx) => { await clear(ctx, "page saved"); },
    "page.after.delete": async (ctx) => { await clear(ctx, "page deleted"); },
    "manifest.after.save": async (ctx) => { await clear(ctx, "site saved"); },
    "config.after.save": async (ctx) => { await clear(ctx, `${ctx.subject.plugin} settings saved`); },
    "plugin.after.enable": async (ctx) => { await clear(ctx, `${ctx.subject.id} enabled`); },
    "plugin.after.disable": async (ctx) => { await clear(ctx, `${ctx.subject.id} disabled`); },
  },
};

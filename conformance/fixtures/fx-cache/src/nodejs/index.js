// Page cache: serve from the store in render.before, store in render.after, drop on page save.
export default { hooks: {
  "render.before": async (ctx) => { const c = (await ctx.storage.read("pages")) || {}; const hit = c[ctx.subject.page.id]; if (hit) return ctx.respond(hit); },
  "render.after": async (ctx) => { const c = (await ctx.storage.read("pages")) || {}; c[ctx.subject.page.id] = ctx.subject.html; await ctx.storage.write("pages", c); },
  "page.after.save": async (ctx) => { const c = (await ctx.storage.read("pages")) || {}; delete c[ctx.subject.id]; await ctx.storage.write("pages", c); },
} };

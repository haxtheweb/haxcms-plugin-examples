export default { hooks: { "render.after": async (ctx) => { ctx.subject.html = ctx.subject.html.replace("<main>", "<main data-t>"); return ctx.subject; } } };

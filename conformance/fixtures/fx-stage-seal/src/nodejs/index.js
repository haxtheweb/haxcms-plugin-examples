// records whether it saw the transformed document
export default { hooks: { "render.after": async (ctx) => { ctx.subject.html += `<!--sealed:${ctx.subject.html.includes("<main data-t>") ? "after-transform" : "before-transform"}-->`; return ctx.subject; } } };

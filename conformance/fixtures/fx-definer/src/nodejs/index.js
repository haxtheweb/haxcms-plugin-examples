export default { operations: { async fxDefinerPing(ctx) { const r = await ctx.hooks.fire("fx-definer.after.ping", { at: 1 }); return { fired: true, subject: r.subject }; } } };

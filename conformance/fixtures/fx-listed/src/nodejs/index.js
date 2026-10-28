export default { operations: { async fxListedPublic(ctx) { return (await ctx.entities.list("page", { listed: true })).map((p) => p.id).sort(); } } };

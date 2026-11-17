// The top of a stack of plugins: depends only on the plugin directly below it, reacts to that plugin's hook, and
// has that plugin do the work through the contract it offers.
export default { hooks: { "fx-stack-mid.after.relay": async (ctx) => {
  ctx.log.info(`fx-stack-top:fx-stack-mid.after.relay from ${ctx.subject.from} at ${ctx.subject.at}`);
  const r = await ctx.contracts.call("fx-stack-mid.store", "put", { name: "doc-1" });
  ctx.log.info(`fx-stack-top was told: ${r.stored} by ${r.by}`);
} } };

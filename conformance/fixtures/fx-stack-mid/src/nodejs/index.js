// The middle of a stack of plugins (think: a storage plugin on top of a sign-in provider). It listens to the hook
// of the plugin it depends on and, inside that hook, fires one of its own for the plugins that depend on it. It
// also does work for them: the contract it defines and implements is what the plugin above calls.
export default {
  hooks: { "fx-definer.after.ping": async (ctx) => {
    ctx.log.info("fx-stack-mid:fx-definer.after.ping");
    await ctx.hooks.fire("fx-stack-mid.after.relay", { from: "fx-definer", at: ctx.subject.at });
  } },
  contracts: { "fx-stack-mid.store": { async put(ctx, input) {
    ctx.log.info(`fx-stack-mid stored ${input.name} as ${ctx.plugin.id}`);
    return { stored: input.name, by: ctx.plugin.id };
  } } },
};

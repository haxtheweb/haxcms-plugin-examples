export default { hooks: { "git.before.commit": async (ctx) => ctx.veto("frozen for review") } };

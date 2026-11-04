export default { hooks: { "user.after.login": async (ctx) => { ctx.log.info(`fx-users saw ${Object.keys(ctx.user).sort().join(",")}`); } } };

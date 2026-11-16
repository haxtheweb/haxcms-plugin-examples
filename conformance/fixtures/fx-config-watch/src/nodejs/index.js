export default { hooks: { "config.after.save": async (ctx) => { ctx.log.info(`fx-config-watch saw ${ctx.subject.plugin}`); } } };

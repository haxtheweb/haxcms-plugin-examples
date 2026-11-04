export default {
  operations: { async fxNeedsTokenPing() { return { pong: true }; } },
  hooks: { "plugin.before.requirements": async (ctx) => (ctx.settings.token ? ctx.subject : [...ctx.subject, { key: "settings.token", message: "Set a token" }]) },
};

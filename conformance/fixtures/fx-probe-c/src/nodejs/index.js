// Conformance probe: logs "<id>:<hook>" for every call; settings[hook] picks a behavior:
// veto | throw | hang | invalid | after-veto | set:<field>=<value>
const behave = (name) => async (ctx) => {
  ctx.log.info(`${ctx.plugin.id}:${name}`);
  const mode = ctx.settings[name];
  if (!mode) return;
  if (mode === "veto" || mode === "after-veto") return ctx.veto(`${ctx.plugin.id} says no`);
  if (mode === "throw") throw new Error(`${ctx.plugin.id} broke`);
  if (mode === "hang") return new Promise(() => {});
  if (mode === "invalid") return { nothing: true };
  if (mode.startsWith("set:")) { const [k, v] = mode.slice(4).split("="); return { ...ctx.subject, [k]: v }; }
};
const names = ["entity.before.create", "entity.after.create", "entity.before.update", "page.before.save", "page.after.save", "theme.before.change", "user.after.login", "transaction.before.start", "transaction.before.end", "transaction.after.end"];
export default { hooks: Object.fromEntries(names.map((n) => [n, behave(n)])) };

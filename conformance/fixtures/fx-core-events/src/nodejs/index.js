// Conformance fixture for the events core fires outside page and manifest saves: files, site lifecycle, sign-in
// and git commits. Logs "<id>:<hook>" for every call; a before hook vetoes when the subject's name, title or
// message contains "forbidden".
const names = ["file.before.save", "file.after.save", "file.before.delete", "file.after.delete", "site.before.create", "site.after.create", "site.before.duplicate", "site.after.duplicate", "site.before.archive", "site.after.archive", "site.before.export", "site.after.export", "user.before.login", "user.after.login", "user.before.logout", "user.after.logout", "git.before.commit", "git.after.commit"];
const seen = (ctx, name) => async () => {
  ctx.log.info(`${ctx.plugin.id}:${name}`);
  const s = ctx.subject || {};
  const text = [s.name, s.title, s.message].filter((x) => typeof x === "string").join(" ");
  if (name.includes(".before.") && /forbidden/i.test(text)) return ctx.veto("fx-core-events: forbidden");
};
export default { hooks: Object.fromEntries(names.map((n) => [n, (ctx) => seen(ctx, n)()])) };

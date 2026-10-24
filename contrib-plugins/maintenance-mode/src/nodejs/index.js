// Maintenance mode (Node only). Admins keep working; everyone else waits.
const isAdmin = (u) => !!u && (u.roles || []).includes("admin");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default {
  hooks: {
    "rest.before.request": async (ctx) => {
      if (!ctx.settings.on || isAdmin(ctx.user)) return ctx.subject;
      return ctx.veto("maintenance in progress; try again later", 503);
    },
    "render.before": async (ctx) => {
      if (!ctx.settings.on || isAdmin(ctx.user) || ctx.subject.mode !== "dynamic") return;
      return ctx.respond(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Maintenance</title></head><body><main><h1>Back soon</h1><p>${esc(ctx.settings.message)}</p></main></body></html>`);
    },
    "schedule.before.run": async (ctx) => {
      if (ctx.settings.on && ctx.settings.pauseJobs) return ctx.veto(`paused for maintenance`);
      return ctx.subject;
    },
  },
};

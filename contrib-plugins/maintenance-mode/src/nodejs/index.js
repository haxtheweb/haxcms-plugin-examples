// Maintenance mode (Node only). Admins keep working; everyone else waits.
const isAdmin = (u) => !!u && (u.roles || []).includes("admin");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default {
  hooks: {
    /**
     * Implements hook rest.before.request.
     *
     * Refuses API requests from everyone but admins with a 503 while maintenance mode is on, so admins keep working
     * and everyone else waits.
     *
     * @param {object} ctx  ctx.subject: the incoming request.
     * @returns {Promise<object>}  the request, or a veto.
     */
    "rest.before.request": async (ctx) => {
      if (!ctx.settings.on || isAdmin(ctx.user)) return ctx.subject;
      return ctx.veto("maintenance in progress; try again later", 503);
    },
    /**
     * Implements hook render.before.
     *
     * Answers dynamic page views from non-admins with a short noindex maintenance page showing the message setting,
     * while maintenance mode is on.
     *
     * @param {object} ctx  ctx.subject: the render request (mode, page).
     * @returns {Promise<object|undefined>}  a ctx.respond() response, or nothing to render normally.
     */
    "render.before": async (ctx) => {
      if (!ctx.settings.on || isAdmin(ctx.user) || ctx.subject.mode !== "dynamic") return;
      return ctx.respond(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Maintenance</title></head><body><main><h1>Back soon</h1><p>${esc(ctx.settings.message)}</p></main></body></html>`);
    },
    /**
     * Implements hook schedule.before.run.
     *
     * Holds back every scheduled job while maintenance mode is on and pauseJobs is set.
     *
     * @param {object} ctx  ctx.subject: the job about to run.
     * @returns {Promise<object>}  the job, or a veto.
     */
    "schedule.before.run": async (ctx) => {
      if (ctx.settings.on && ctx.settings.pauseJobs) return ctx.veto(`paused for maintenance`);
      return ctx.subject;
    },
  },
};

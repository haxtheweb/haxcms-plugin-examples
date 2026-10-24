// Example plugin (Node). Placeholder until the loader exists: every hook in schema/hooks.json is implemented.
// Each body logs; the comment says what you could do there.
const log = (name, ctx) => console.log(`[example] ${name}`, ctx && ctx.entity ? ctx.entity : "");

export default {
  hooks: {
    // validate or normalize input, or veto with a message
    "entity.before.create": async (ctx) => {
      if (ctx.entity && ctx.entity.name === "boring.awesome") {
        return { veto: true, message: "Too boring. Add more explosions." };
      }
      log("entity.before.create", ctx);
    },
    // react to the change, notify, or update a derived store
    "entity.after.create": async (ctx) => {
      log("entity.after.create", ctx);
    },
    // validate or normalize input, or veto with a message
    "entity.before.read": async (ctx) => {
      log("entity.before.read", ctx);
    },
    // react to the change, notify, or update a derived store
    "entity.after.read": async (ctx) => {
      log("entity.after.read", ctx);
    },
    // validate or normalize input, or veto with a message
    "entity.before.update": async (ctx) => {
      log("entity.before.update", ctx);
    },
    // react to the change, notify, or update a derived store
    "entity.after.update": async (ctx) => {
      log("entity.after.update", ctx);
    },
    // validate or normalize input, or veto with a message
    "entity.before.delete": async (ctx) => {
      log("entity.before.delete", ctx);
    },
    // react to the change, notify, or update a derived store
    "entity.after.delete": async (ctx) => {
      log("entity.after.delete", ctx);
    },
    // inspect or reject the request before routing (never log secrets)
    "rest.request": async (ctx) => {
      log("rest.request", ctx);
    },
    // add headers or trim fields before the response is sent
    "rest.response": async (ctx) => {
      log("rest.response", ctx);
    },
    // check preconditions; throw to refuse the transition
    "plugin.before.install": async (ctx) => {
      log("plugin.before.install", ctx);
    },
    // finish setup, warm caches, or observe another plugin
    "plugin.after.install": async (ctx) => {
      log("plugin.after.install", ctx);
    },
    // check preconditions; throw to refuse the transition
    "plugin.before.enable": async (ctx) => {
      log("plugin.before.enable", ctx);
    },
    // finish setup, warm caches, or observe another plugin
    "plugin.after.enable": async (ctx) => {
      log("plugin.after.enable", ctx);
    },
    // check preconditions; throw to refuse the transition
    "plugin.before.disable": async (ctx) => {
      log("plugin.before.disable", ctx);
    },
    // finish setup, warm caches, or observe another plugin
    "plugin.after.disable": async (ctx) => {
      log("plugin.after.disable", ctx);
    },
    // check preconditions; throw to refuse the transition
    "plugin.before.uninstall": async (ctx) => {
      log("plugin.before.uninstall", ctx);
    },
    // finish setup, warm caches, or observe another plugin
    "plugin.after.uninstall": async (ctx) => {
      log("plugin.after.uninstall", ctx);
    },
    // check preconditions; throw to refuse the transition
    "plugin.before.upgrade": async (ctx) => {
      log("plugin.before.upgrade", ctx);
    },
    // finish setup, warm caches, or observe another plugin
    "plugin.after.upgrade": async (ctx) => {
      log("plugin.after.upgrade", ctx);
    },
    // validate the action or prepare data; veto if needed
    "site.before.create": async (ctx) => {
      log("site.before.create", ctx);
    },
    // copy, archive or clean up plugin data for the site
    "site.after.create": async (ctx) => {
      log("site.after.create", ctx);
    },
    // validate the action or prepare data; veto if needed
    "site.before.duplicate": async (ctx) => {
      log("site.before.duplicate", ctx);
    },
    // copy, archive or clean up plugin data for the site
    "site.after.duplicate": async (ctx) => {
      log("site.after.duplicate", ctx);
    },
    // validate the action or prepare data; veto if needed
    "site.before.archive": async (ctx) => {
      log("site.before.archive", ctx);
    },
    // copy, archive or clean up plugin data for the site
    "site.after.archive": async (ctx) => {
      log("site.after.archive", ctx);
    },
    // validate the action or prepare data; veto if needed
    "site.before.delete": async (ctx) => {
      log("site.before.delete", ctx);
    },
    // copy, archive or clean up plugin data for the site
    "site.after.delete": async (ctx) => {
      log("site.after.delete", ctx);
    },
    // validate the action or prepare data; veto if needed
    "site.before.export": async (ctx) => {
      log("site.before.export", ctx);
    },
    // copy, archive or clean up plugin data for the site
    "site.after.export": async (ctx) => {
      log("site.after.export", ctx);
    },
    // apply rate limiting or extra checks
    "user.before.login": async (ctx) => {
      log("user.before.login", ctx);
    },
    // record an audit entry
    "user.after.login": async (ctx) => {
      log("user.after.login", ctx);
    },
    // apply rate limiting or extra checks
    "user.before.logout": async (ctx) => {
      log("user.before.logout", ctx);
    },
    // record an audit entry
    "user.after.logout": async (ctx) => {
      log("user.after.logout", ctx);
    },
    // declare what this plugin provides to the platform
    "register.routes": async (ctx) => {
      log("register.routes", ctx);
    },
    // declare what this plugin provides to the platform
    "register.entities": async (ctx) => {
      log("register.entities", ctx);
    },
    // declare what this plugin provides to the platform
    "register.contracts": async (ctx) => {
      log("register.contracts", ctx);
    },
    // contribute head tags or page elements (needs output:inject)
    "output.alterHead": async (ctx) => {
      log("output.alterHead", ctx);
    },
    // contribute head tags or page elements (needs output:inject)
    "output.alterPage": async (ctx) => {
      log("output.alterPage", ctx);
    },
    // write or clean managed files (needs output:managedFiles)
    "rebuild.before": async (ctx) => {
      log("rebuild.before", ctx);
    },
    // write or clean managed files (needs output:managedFiles)
    "rebuild.after": async (ctx) => {
      log("rebuild.after", ctx);
    },
    // reserved: runner not implemented; keep jobs idempotent
    "schedule.run": async (ctx) => {
      log("schedule.run", ctx);
    },
  },
};

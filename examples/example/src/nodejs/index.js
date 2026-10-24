// Example plugin (Node). Placeholder until the loader exists: every hook in schema/hooks.json is implemented.
// Each body logs; the comment says what you could do there.
const log = (name, ctx) => console.log(`[example] ${name}`, ctx && ctx.subject ? ctx.subject : "");

export default {
  hooks: {
    // validate or normalize input, or veto with a message
    "entity.before.create": async (ctx) => {
      if (ctx.subject && ctx.subject.name === "boring.awesome") {
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
    // report unmet requirements; the plugin stays enabled but inactive until this returns an empty list
    // also a place to check optional companions with ctx.pluginEnabled("other-plugin")
    "plugin.requirements": async (ctx) => {
      log("plugin.requirements", ctx);
      const unmet = [...ctx.subject];
      if (!ctx.settings.greeting) unmet.push({ key: "settings.greeting", message: "Set a greeting before this plugin activates" });
      return unmet;
    },
    // runs the first time the plugin is enabled in a scope (site or system); migrate settings that used to live in site.json or core config into this plugin's settings here
    "plugin.before.install": async (ctx) => {
      log("plugin.before.install", ctx);
    },
    // runs the first time the plugin is enabled in a scope (site or system); migrate settings that used to live in site.json or core config into this plugin's settings here
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
    // serve a cached document by returning ctx.respond(html), or prepare the render context (site, page, theme)
    "render.before": async (ctx) => {
      log("render.before", ctx);
    },
    // add or alter head tags and slim CSS variables
    "render.head": async (ctx) => {
      log("render.head", ctx);
    },
    // transform the assembled page content before it is placed in the shell (for example server-side render custom elements)
    "render.content": async (ctx) => {
      log("render.content", ctx);
    },
    // inject markup right after the opening body tag
    "render.body.start": async (ctx) => {
      log("render.body.start", ctx);
    },
    // inject singletons and scripts at the bottom of the body, with settings baked in from the plugin's config
    "render.body.end": async (ctx) => {
      log("render.body.end", ctx);
    },
    // last chance to alter the final document; store it in a cache for the next request or for publishing
    "render.after": async (ctx) => {
      log("render.after", ctx);
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
    // inspect or adjust the page by reference before it is written, or veto
    "page.before.save": async (ctx) => {
      log("page.before.save", ctx);
    },
    // react once the page is saved (sync, notify, rebuild derived data)
    "page.after.save": async (ctx) => {
      log("page.after.save", ctx);
    },
    // inspect or adjust the manifest by reference before it is written, or veto
    "manifest.before.save": async (ctx) => {
      log("manifest.before.save", ctx);
    },
    // react once the manifest is saved
    "manifest.after.save": async (ctx) => {
      log("manifest.after.save", ctx);
    },
    // validate or normalize a settings change (any plugin's config, filter by ctx.subject.plugin); veto to refuse
    "config.before.save": async (ctx) => {
      log("config.before.save", ctx);
      return ctx.subject;
    },
    // react to a settings change, e.g. clear a cache; requirements are re-evaluated after this
    "config.after.save": async (ctx) => {
      log("config.after.save", ctx);
    },
    // last chance to add files or adjust the commit message
    "git.before.commit": async (ctx) => {
      log("git.before.commit", ctx);
    },
    // runs after every git commit HAXcms makes (after an item or manifest save); for example rsync the site to a remote server
    "git.after.commit": async (ctx) => {
      // detached: runs after the response is sent. A real plugin would spawn the declared command (exec: [rsync]) here.
      log("git.after.commit", ctx);
    },
  },
};

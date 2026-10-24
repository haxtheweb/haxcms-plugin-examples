// Example plugin (Node). Placeholder until the loader exists: every hook in schema/hooks.json is implemented.
// Each body logs; the comment says what you could do there.
const log = (name, ctx) => console.log(`[example] ${name}`, ctx && ctx.subject ? ctx.subject : "");

export default {
  // scheduled job declared in plugin.yaml schedules; keep it idempotent and time-bounded
  async tidy(ctx) {
    log("schedule tidy", ctx);
  },
  hooks: {
    // validate or normalize the new record, or veto with a message
    "entity.before.create": async (ctx) => {
      if (ctx.subject && ctx.subject.name === "boring.awesome") return ctx.veto("Too boring. Add more explosions.");
      log("entity.before.create", ctx);
    },
    // react to the new record: notify, index, update a derived store
    "entity.after.create": async (ctx) => {
      log("entity.after.create", ctx);
    },
    // narrow what is read (for example hide drafts from anonymous callers), or veto
    "entity.before.read": async (ctx) => {
      log("entity.before.read", ctx);
    },
    // annotate or redact what the caller receives; not detachable because the caller waits for it
    "entity.after.read": async (ctx) => {
      log("entity.after.read", ctx);
    },
    // compare with ctx.previous, normalize, or veto
    "entity.before.update": async (ctx) => {
      log("entity.before.update", ctx);
    },
    // react to what changed between ctx.previous and the subject
    "entity.after.update": async (ctx) => {
      log("entity.after.update", ctx);
    },
    // refuse deletion (for example while something depends on it), or veto
    "entity.before.delete": async (ctx) => {
      log("entity.before.delete", ctx);
    },
    // clean up anything that pointed at the deleted record
    "entity.after.delete": async (ctx) => {
      log("entity.after.delete", ctx);
    },
    // inspect or adjust the page before it is written (for example clean up markup), or veto
    "page.before.save": async (ctx) => {
      log("page.before.save", ctx);
    },
    // react to the saved page: re-index for search, invalidate a cache, notify
    "page.after.save": async (ctx) => {
      // inside a bulk transaction, defer: mark it and do the work once in transaction.after.end
      if (ctx.transaction && ctx.transaction.bulk) { ctx.transaction.marks["example.reindex"] = true; return; }
      log("page.after.save", ctx);
    },
    // refuse to delete a page others link to, or veto
    "page.before.delete": async (ctx) => {
      log("page.before.delete", ctx);
    },
    // clean up anything tied to the deleted page
    "page.after.delete": async (ctx) => {
      log("page.after.delete", ctx);
    },
    // inspect or adjust site.json before it is written, or veto
    "manifest.before.save": async (ctx) => {
      log("manifest.before.save", ctx);
    },
    // react to outline or settings changes: rebuild a derived file, notify
    "manifest.after.save": async (ctx) => {
      log("manifest.after.save", ctx);
    },
    // check the new theme is compatible, or veto
    "theme.before.change": async (ctx) => {
      log("theme.before.change", ctx);
    },
    // react to the new theme
    "theme.after.change": async (ctx) => {
      log("theme.after.change", ctx);
    },
    // check type and size, rename, or veto
    "file.before.save": async (ctx) => {
      log("file.before.save", ctx);
    },
    // react to a new or changed file
    "file.after.save": async (ctx) => {
      log("file.after.save", ctx);
    },
    // refuse while pages still embed the file, or veto
    "file.before.delete": async (ctx) => {
      log("file.before.delete", ctx);
    },
    // remove derived files
    "file.after.delete": async (ctx) => {
      log("file.after.delete", ctx);
    },
    // uncommon: audit or restrict access to configuration
    "config.before.read": async (ctx) => {
      log("config.before.read", ctx);
    },
    // uncommon: redact or annotate values for the caller
    "config.after.read": async (ctx) => {
      log("config.after.read", ctx);
    },
    // validate or normalize a settings change, or veto
    "config.before.save": async (ctx) => {
      log("config.before.save", ctx);
      return ctx.subject;
    },
    // react to a settings change: clear a cache, copy to a backup location
    "config.after.save": async (ctx) => {
      log("config.after.save", ctx);
    },
    // last chance to add files or adjust the commit message, or veto the commit
    "git.before.commit": async (ctx) => {
      log("git.before.commit", ctx);
    },
    // push or rsync the site elsewhere; usually `detached: true`
    "git.after.commit": async (ctx) => {
      // detached: runs after the response is sent. A real plugin would spawn the declared command (exec: [rsync]) here.
      log("git.after.commit", ctx);
    },
    // note what is about to happen, or refuse to start
    "transaction.before.start": async (ctx) => {
      log("transaction.before.start", ctx);
    },
    // prepare for the work
    "transaction.after.start": async (ctx) => {
      log("transaction.after.start", ctx);
    },
    // finish deferred work that must succeed for the transaction to count, or veto to fail it
    "transaction.before.end": async (ctx) => {
      log("transaction.before.end", ctx);
    },
    // react once to the whole unit of work
    "transaction.after.end": async (ctx) => {
      if (ctx.subject.marks["example.reindex"]) log("transaction.after.end: one reindex for the whole bulk edit", ctx);
    },
    // check or adjust the request before the handler runs, or refuse it
    "rest.before.request": async (ctx) => {
      log("rest.before.request", ctx);
    },
    // adjust the response before it is sent; not detachable
    "rest.after.request": async (ctx) => {
      log("rest.after.request", ctx);
    },
    // report unmet requirements; the plugin stays enabled but inactive until the list is empty
    "plugin.before.requirements": async (ctx) => {
      log("plugin.before.requirements", ctx);
      const unmet = [...ctx.subject];
      if (!ctx.settings.greeting) unmet.push({ key: "settings.greeting", message: "Set a greeting before this plugin activates" });
      return unmet;
    },
    // react to becoming active or inactive
    "plugin.after.requirements": async (ctx) => {
      log("plugin.after.requirements", ctx);
    },
    // check preconditions for install; veto to refuse
    "plugin.before.install": async (ctx) => {
      log("plugin.before.install", ctx);
    },
    // migrate settings that used to live in site.json or core config into this plugin's settings
    "plugin.after.install": async (ctx) => {
      log("plugin.after.install", ctx);
    },
    // check preconditions for enable; veto to refuse
    "plugin.before.enable": async (ctx) => {
      log("plugin.before.enable", ctx);
    },
    // set up what the plugin needs at runtime
    "plugin.after.enable": async (ctx) => {
      log("plugin.after.enable", ctx);
    },
    // check preconditions for disable; veto to refuse
    "plugin.before.disable": async (ctx) => {
      log("plugin.before.disable", ctx);
    },
    // tear down what enable set up; core clears caches and rebuilds managed outputs
    "plugin.after.disable": async (ctx) => {
      log("plugin.after.disable", ctx);
    },
    // check preconditions for uninstall; veto to refuse
    "plugin.before.uninstall": async (ctx) => {
      log("plugin.before.uninstall", ctx);
    },
    // remove anything outside the plugin's own stores
    "plugin.after.uninstall": async (ctx) => {
      log("plugin.after.uninstall", ctx);
    },
    // check preconditions for upgrade; veto to refuse
    "plugin.before.upgrade": async (ctx) => {
      log("plugin.before.upgrade", ctx);
    },
    // prepare for or follow up on data upgrades
    "plugin.after.upgrade": async (ctx) => {
      log("plugin.after.upgrade", ctx);
    },
    // check or adjust before the site is created, or veto
    "site.before.create": async (ctx) => {
      log("site.before.create", ctx);
    },
    // react after the site is created
    "site.after.create": async (ctx) => {
      log("site.after.create", ctx);
    },
    // check or adjust before the site is duplicated, or veto
    "site.before.duplicate": async (ctx) => {
      log("site.before.duplicate", ctx);
    },
    // react after the site is duplicated
    "site.after.duplicate": async (ctx) => {
      log("site.after.duplicate", ctx);
    },
    // check or adjust before the site is archived, or veto
    "site.before.archive": async (ctx) => {
      log("site.before.archive", ctx);
    },
    // react after the site is archived
    "site.after.archive": async (ctx) => {
      log("site.after.archive", ctx);
    },
    // check or adjust before the site is deleted, or veto
    "site.before.delete": async (ctx) => {
      log("site.before.delete", ctx);
    },
    // react after the site is deleted
    "site.after.delete": async (ctx) => {
      log("site.after.delete", ctx);
    },
    // check or adjust before the site is exported, or veto
    "site.before.export": async (ctx) => {
      log("site.before.export", ctx);
    },
    // react after the site is exported
    "site.after.export": async (ctx) => {
      log("site.after.export", ctx);
    },
    // refuse the login (for example outside allowed hours), or veto
    "user.before.login": async (ctx) => {
      log("user.before.login", ctx);
    },
    // react to the login: record it, warm a cache
    "user.after.login": async (ctx) => {
      log("user.after.login", ctx);
    },
    // refuse the logout (for example outside allowed hours), or veto
    "user.before.logout": async (ctx) => {
      log("user.before.logout", ctx);
    },
    // react to the logout: record it, warm a cache
    "user.after.logout": async (ctx) => {
      log("user.after.logout", ctx);
    },
    // add to the routes list
    "register.before.routes": async (ctx) => {
      log("register.before.routes", ctx);
    },
    // inspect the final routes list (audit, conflicts)
    "register.after.routes": async (ctx) => {
      log("register.after.routes", ctx);
    },
    // add to the entities list
    "register.before.entities": async (ctx) => {
      log("register.before.entities", ctx);
    },
    // inspect the final entities list (audit, conflicts)
    "register.after.entities": async (ctx) => {
      log("register.after.entities", ctx);
    },
    // add to the contracts list
    "register.before.contracts": async (ctx) => {
      log("register.before.contracts", ctx);
    },
    // inspect the final contracts list (audit, conflicts)
    "register.after.contracts": async (ctx) => {
      log("register.after.contracts", ctx);
    },
    // add to the prompts list
    "register.before.prompts": async (ctx) => {
      log("register.before.prompts", ctx);
      return ctx.subject;
    },
    // inspect the final prompts list (audit, conflicts)
    "register.after.prompts": async (ctx) => {
      log("register.after.prompts", ctx);
    },
    // serve a cached document with ctx.respond(html), or prepare the context
    "render.before": async (ctx) => {
      log("render.before", ctx);
    },
    // add meta, link and script tags to the head
    "render.before.head": async (ctx) => {
      log("render.before.head", ctx);
    },
    // inspect or reorder the final head
    "render.after.head": async (ctx) => {
      log("render.after.head", ctx);
    },
    // transform content before it is placed, for example server-side render custom elements
    "render.before.content": async (ctx) => {
      log("render.before.content", ctx);
    },
    // inspect or post-process the placed content
    "render.after.content": async (ctx) => {
      log("render.after.content", ctx);
    },
    // inject markup at the start of the body
    "render.before.body": async (ctx) => {
      log("render.before.body", ctx);
    },
    // inject singletons and scripts at the end of the body, with settings baked in from the plugin's config
    "render.after.body": async (ctx) => {
      log("render.after.body", ctx);
    },
    // last chance to alter the final document; store it in a cache
    "render.after": async (ctx) => {
      log("render.after", ctx);
    },
    // prepare for a rebuild, or veto it
    "rebuild.before": async (ctx) => {
      log("rebuild.before", ctx);
    },
    // write this plugin's own managed files
    "rebuild.after": async (ctx) => {
      log("rebuild.after", ctx);
    },
    // skip a job run (for example during maintenance)
    "schedule.before.run": async (ctx) => {
      log("schedule.before.run", ctx);
    },
    // record the result or alert on failure
    "schedule.after.run": async (ctx) => {
      log("schedule.after.run", ctx);
    },
    // make the explosion smaller, or veto it
    "example.before.explode": async (ctx) => {
      log("example.before.explode", ctx);
    },
    // react to an explosion
    "example.after.explode": async (ctx) => {
      log("example.after.explode", ctx);
    },
    // same as entity.before.create/update on awesomeFile, under a clearer name
    "example.before.awesomeSave": async (ctx) => {
      log("example.before.awesomeSave", ctx);
    },
  },
};

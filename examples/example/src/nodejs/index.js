// Example plugin (Node). Implements every operation in config/openapi.yaml and every hook in schema/hooks.json.
// Most hook bodies only log; the comment says what you could do there. The contract for ctx is spec/13.
const log = (name, ctx) => (ctx && ctx.log ? ctx.log.info(name) : console.log(`[example] ${name}`));

export default {
  // Route handlers, keyed by operationId: (ctx, request) => { status, headers?, body } or a plain body (200).
  operations: {
    /**
     * Implements operation exampleListExplosions.
     *
     * Lists the explosions this site has had from the tally store (site scope), filtered by name when q is given.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.query.q: optional name filter.
     * @returns {Promise<object>}  { items, total }.
     */
    async exampleListExplosions(ctx, req) {
      const all = (await ctx.storage.read("tally")) || [];
      const q = String(req.query.q || "").toLowerCase();
      const items = q ? all.filter((e) => e.name.toLowerCase().includes(q)) : all;
      return { items, total: items.length };
    },
    /**
     * Implements operation exampleExplode.
     *
     * Records an explosion in the tally store, firing this plugin's own hooks (config/hooks.yaml) so other plugins can
     * adjust or veto it first (example.before.explode) and react after (example.after.explode).
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.body: { fileId, size }.
     * @returns {Promise<object>}  the explosion { id, name, fileId, intensity }, or the veto's status (409 by default).
     */
    async exampleExplode(ctx, req) {
      const before = await ctx.hooks.fire("example.before.explode", { fileId: req.body.fileId, size: Number(req.body.size) || 1 });
      if (before.veto) return { status: before.veto.status || 409, body: { error: before.veto.message } };
      const all = (await ctx.storage.read("tally")) || [];
      const explosion = { id: `e${all.length + 1}`, name: `Explosion ${all.length + 1}`, fileId: before.subject.fileId, intensity: before.subject.size };
      await ctx.storage.write("tally", [...all, explosion]);
      await ctx.hooks.fire("example.after.explode", { fileId: explosion.fileId, size: explosion.intensity, at: explosion.id });
      return explosion;
    },
    /**
     * Implements operation examplePing.
     *
     * Answers a public, rate-limited ping, to show an operation that needs no sign-in.
     *
     * @returns {Promise<object>}  { pong: true }.
     */
    async examplePing() {
      return { pong: true };
    },
    /**
     * Implements operation exampleAppstoreBrowse.
     *
     * Brokers the appstore search for registries/appstore, adding the secret apiKey server-side so the browser never
     * sees it.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.settings.apiKey, ctx.fetch.
     * @param {object} req  req.query.q: the search text.
     * @returns {Promise<object>}  the upstream { status, body }, or 503 when no apiKey is set.
     */
    async exampleAppstoreBrowse(ctx, req) {
      if (!ctx.settings.apiKey) return { status: 503, body: { error: "The example appstore is not configured" } };
      const res = await ctx.fetch(`https://example.invalid/api/explosions?q=${encodeURIComponent(req.query.q || "")}`, { headers: { "x-api-key": ctx.settings.apiKey } });
      return { status: res.status, body: await res.json() };
    },
  },
  /**
   * Implements schedule tidy.
   *
   * Logs the run; a real job would tidy this site's data here. Scheduled jobs should be idempotent and time-bounded.
   *
   * @param {object} ctx  Platform context (spec/13), for one site (scope: site).
   * @returns {Promise<void>}  nothing.
   */
  async tidy(ctx) {
    log("schedule tidy", ctx);
  },
  hooks: {
    /**
     * Implements hook entity.before.create.
     *
     * Validate or normalize the new record, or veto with a message.
     * Runs when an entity is about to be created (any entity type the subscription lists).
     *
     * @param {object} ctx  subject: the entity record: { id, type, ...fields, ext: { <plugin>: {...} } } as submitted; previous: none.
     * @returns {Promise<*>}  the record (may change it); may call ctx.veto().
     */
    "entity.before.create": async (ctx) => {
      if (ctx.subject && ctx.subject.name === "boring.awesome") return ctx.veto("Too boring. Add more explosions.");
      log("entity.before.create", ctx);
    },
    /**
     * Implements hook entity.after.create.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react to the new record: notify, index, update a derived store.
     * Runs when the entity was created and stored.
     *
     * @param {object} ctx  subject: the entity record: { id, type, ...fields, ext: { <plugin>: {...} } } as stored, with its new id; previous: none.
     * @returns {Promise<*>}  the record as the caller receives it (annotations); the store is not rewritten.
     */
    "entity.after.create": async (ctx) => {
      log("entity.after.create", ctx);
    },
    /**
     * Implements hook entity.before.read.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: narrow what is read (for example hide drafts from anonymous callers), or veto.
     * Runs when an entity or list is about to be read.
     *
     * @param {object} ctx  subject: { type, id?, query } (what is being asked for); previous: none.
     * @returns {Promise<*>}  the request (narrow a query, add filters); may call ctx.veto().
     */
    "entity.before.read": async (ctx) => {
      log("entity.before.read", ctx);
    },
    /**
     * Implements hook entity.after.read.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: annotate or redact what the caller receives; not detachable because the caller waits for it.
     * Runs when the entity or list was loaded.
     *
     * @param {object} ctx  subject: the record, or { items: [records], total } for a list, with ext.<plugin> annotations; previous: none.
     * @returns {Promise<*>}  the record or list as the caller receives it (annotate, redact).
     */
    "entity.after.read": async (ctx) => {
      log("entity.after.read", ctx);
    },
    /**
     * Implements hook entity.before.update.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: compare with ctx.previous, normalize, or veto.
     * Runs when an entity is about to be updated.
     *
     * @param {object} ctx  subject: the entity record: { id, type, ...fields, ext: { <plugin>: {...} } } with the submitted changes merged; previous: the stored record.
     * @returns {Promise<*>}  the record (may change it); may call ctx.veto().
     */
    "entity.before.update": async (ctx) => {
      log("entity.before.update", ctx);
    },
    /**
     * Implements hook entity.after.update.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react to what changed between ctx.previous and the subject.
     * Runs when the update was stored.
     *
     * @param {object} ctx  subject: the entity record: { id, type, ...fields, ext: { <plugin>: {...} } } as stored; previous: the record before the update.
     * @returns {Promise<*>}  the record as the caller receives it.
     */
    "entity.after.update": async (ctx) => {
      log("entity.after.update", ctx);
    },
    /**
     * Implements hook entity.before.delete.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: refuse deletion (for example while something depends on it), or veto.
     * Runs when an entity is about to be deleted.
     *
     * @param {object} ctx  subject: the stored record; previous: none.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "entity.before.delete": async (ctx) => {
      log("entity.before.delete", ctx);
    },
    /**
     * Implements hook entity.after.delete.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: clean up anything that pointed at the deleted record.
     * Runs when the entity was deleted.
     *
     * @param {object} ctx  subject: the record as it was before deletion; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "entity.after.delete": async (ctx) => {
      log("entity.after.delete", ctx);
    },
    /**
     * Implements hook page.before.save.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: inspect or adjust the page before it is written (for example clean up markup), or veto.
     * Runs when page content or metadata is about to be written (editor save, CLI, import).
     *
     * @param {object} ctx  subject: the page: { id, siteId, title, location, slug, parent, order, content, metadata } as submitted; previous: the stored page.
     * @returns {Promise<*>}  the page (may change content or metadata); may call ctx.veto().
     */
    "page.before.save": async (ctx) => {
      log("page.before.save", ctx);
    },
    /**
     * Implements hook page.after.save.
     *
     * React to the saved page: re-index for search, invalidate a cache, notify.
     * Runs when the page was written to disk.
     *
     * @param {object} ctx  subject: the page: { id, siteId, title, location, slug, parent, order, content, metadata } as written; previous: the page before the save.
     * @returns {Promise<*>}  nothing (the file is already written).
     */
    "page.after.save": async (ctx) => {
      // inside a bulk transaction, defer: mark it and do the work once in transaction.after.end
      if (ctx.transaction && ctx.transaction.bulk) { ctx.transaction.marks["example.reindex"] = true; return; }
      log("page.after.save", ctx);
    },
    /**
     * Implements hook page.before.delete.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: refuse to delete a page others link to, or veto.
     * Runs when a page is about to be deleted (outline editor, CLI).
     *
     * @param {object} ctx  subject: the page: { id, siteId, title, location, slug, parent, order, content, metadata } as stored; previous: none.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "page.before.delete": async (ctx) => {
      log("page.before.delete", ctx);
    },
    /**
     * Implements hook page.after.delete.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: clean up anything tied to the deleted page.
     * Runs when the page was deleted.
     *
     * @param {object} ctx  subject: the page: { id, siteId, title, location, slug, parent, order, content, metadata } as it was before deletion; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "page.after.delete": async (ctx) => {
      log("page.after.delete", ctx);
    },
    /**
     * Implements hook manifest.before.save.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: inspect or adjust site.json before it is written, or veto.
     * Runs when site.json is about to be written (outline change, settings save, theme change).
     *
     * @param {object} ctx  subject: the site manifest: the full site.json object ({ id, title, author, metadata, items: [...] }) as it will be written; previous: the stored manifest.
     * @returns {Promise<*>}  the manifest (may change it); may call ctx.veto().
     */
    "manifest.before.save": async (ctx) => {
      log("manifest.before.save", ctx);
    },
    /**
     * Implements hook manifest.after.save.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react to outline or settings changes: rebuild a derived file, notify.
     * Runs when site.json was written.
     *
     * @param {object} ctx  subject: the site manifest: the full site.json object ({ id, title, author, metadata, items: [...] }) as written; previous: the manifest before the save.
     * @returns {Promise<*>}  nothing.
     */
    "manifest.after.save": async (ctx) => {
      log("manifest.after.save", ctx);
    },
    /**
     * Implements hook theme.before.change.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check the new theme is compatible, or veto.
     * Runs when a site's theme is about to change (site settings, CLI).
     *
     * @param {object} ctx  subject: { siteId, theme, settings } (the new theme and its settings); previous: { theme, settings } currently in use.
     * @returns {Promise<*>}  the new theme and settings (may adjust settings); may call ctx.veto().
     */
    "theme.before.change": async (ctx) => {
      log("theme.before.change", ctx);
    },
    /**
     * Implements hook theme.after.change.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react to the new theme.
     * Runs when the theme change was saved.
     *
     * @param {object} ctx  subject: { siteId, theme, settings }; previous: the theme and settings before.
     * @returns {Promise<*>}  nothing.
     */
    "theme.after.change": async (ctx) => {
      log("theme.after.change", ctx);
    },
    /**
     * Implements hook file.before.save.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check type and size, rename, or veto.
     * Runs when a file is about to be uploaded or its record changed (file manager, editor upload, appstore upload target).
     *
     * @param {object} ctx  subject: the file record: { id, siteId, path, name, mimeType, size, alt?, ext: {...} } as submitted, with the upload in ctx.upload; previous: the stored record, on update.
     * @returns {Promise<*>}  the record (may change name or metadata); may call ctx.veto().
     */
    "file.before.save": async (ctx) => {
      log("file.before.save", ctx);
    },
    /**
     * Implements hook file.after.save.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react to a new or changed file.
     * Runs when the file is stored.
     *
     * @param {object} ctx  subject: the file record: { id, siteId, path, name, mimeType, size, alt?, ext: {...} } as stored; previous: the record before the update, on update.
     * @returns {Promise<*>}  the record as the caller receives it.
     */
    "file.after.save": async (ctx) => {
      log("file.after.save", ctx);
    },
    /**
     * Implements hook file.before.delete.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: refuse while pages still embed the file, or veto.
     * Runs when a file is about to be deleted.
     *
     * @param {object} ctx  subject: the file record: { id, siteId, path, name, mimeType, size, alt?, ext: {...} } as stored; previous: none.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "file.before.delete": async (ctx) => {
      log("file.before.delete", ctx);
    },
    /**
     * Implements hook file.after.delete.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: remove derived files.
     * Runs when the file was deleted.
     *
     * @param {object} ctx  subject: the file record: { id, siteId, path, name, mimeType, size, alt?, ext: {...} } as it was before deletion; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "file.after.delete": async (ctx) => {
      log("file.after.delete", ctx);
    },
    /**
     * Implements hook config.before.read.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: uncommon: audit or restrict access to configuration.
     * Runs when a plugin's configuration is about to be read (subscription config list decides whose).
     *
     * @param {object} ctx  subject: { plugin, scope, siteId?, keys? }; previous: none.
     * @returns {Promise<*>}  the request; may call ctx.veto().
     */
    "config.before.read": async (ctx) => {
      log("config.before.read", ctx);
    },
    /**
     * Implements hook config.after.read.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: uncommon: redact or annotate values for the caller.
     * Runs when the configuration was loaded.
     *
     * @param {object} ctx  subject: { plugin, scope, siteId?, values } (the plugin whose config it is, system or site scope, the settings values); secret values are already redacted; previous: none.
     * @returns {Promise<*>}  the values as the caller receives them.
     */
    "config.after.read": async (ctx) => {
      log("config.after.read", ctx);
    },
    /**
     * Implements hook config.before.save.
     *
     * Validate or normalize a settings change, or veto.
     * Runs when configuration is about to be written (dashboard, hax plugin config set, install migration).
     *
     * @param {object} ctx  subject: { plugin, scope, siteId?, values } (the plugin whose config it is, system or site scope, the settings values) as submitted; previous: the stored values.
     * @returns {Promise<*>}  the values (may normalize them); may call ctx.veto().
     */
    "config.before.save": async (ctx) => {
      log("config.before.save", ctx);
      return ctx.subject;
    },
    /**
     * Implements hook config.after.save.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react to a settings change: clear a cache, copy to a backup location.
     * Runs when configuration was written; requirements are re-evaluated after this.
     *
     * @param {object} ctx  subject: { plugin, scope, siteId?, values } (the plugin whose config it is, system or site scope, the settings values) as written; previous: the values before the save.
     * @returns {Promise<*>}  nothing.
     */
    "config.after.save": async (ctx) => {
      log("config.after.save", ctx);
    },
    /**
     * Implements hook git.before.commit.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: last chance to add files or adjust the commit message, or veto the commit.
     * Runs when HAXcms is about to make a git commit for a site (after a page or manifest save).
     *
     * @param {object} ctx  subject: { siteId, message, files: [paths], author }; previous: none.
     * @returns {Promise<*>}  the commit (adjust the message or add files); may call ctx.veto().
     */
    "git.before.commit": async (ctx) => {
      log("git.before.commit", ctx);
    },
    /**
     * Implements hook git.after.commit.
     *
     * Push or rsync the site elsewhere; usually detached: true.
     * Runs when the commit was made.
     *
     * @param {object} ctx  subject: { siteId, hash, message, files: [paths], author }; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "git.after.commit": async (ctx) => {
      // detached: runs after the response is sent. A real plugin would spawn the declared command (exec: [rsync]) here.
      log("git.after.commit", ctx);
    },
    /**
     * Implements hook transaction.before.start.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: note what is about to happen, or refuse to start.
     * Runs when a unit of work is about to start; every operation runs in one (a single save gets an implicit one, the outline editor or an import opens an explicit bulk one).
     *
     * @param {object} ctx  subject: the transaction: { id, origin, bulk, operations: [{ hook, entity?, id? }], marks: {} } (origin is what started it: outline editor, import, CLI, a single save); operations is empty; previous: none.
     * @returns {Promise<*>}  the transaction; may call ctx.veto().
     */
    "transaction.before.start": async (ctx) => {
      log("transaction.before.start", ctx);
    },
    /**
     * Implements hook transaction.after.start.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: prepare for the work.
     * Runs when the transaction is open.
     *
     * @param {object} ctx  subject: the transaction: { id, origin, bulk, operations: [{ hook, entity?, id? }], marks: {} } (origin is what started it: outline editor, import, CLI, a single save); previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "transaction.after.start": async (ctx) => {
      log("transaction.after.start", ctx);
    },
    /**
     * Implements hook transaction.before.end.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: finish deferred work that must succeed for the transaction to count, or veto to fail it.
     * Runs when the work is done and the transaction is about to close.
     *
     * @param {object} ctx  subject: the transaction: { id, origin, bulk, operations: [{ hook, entity?, id? }], marks: {} } (origin is what started it: outline editor, import, CLI, a single save); operations lists everything that ran; previous: none.
     * @returns {Promise<*>}  the transaction; may call ctx.veto().
     */
    "transaction.before.end": async (ctx) => {
      log("transaction.before.end", ctx);
    },
    /**
     * Implements hook transaction.after.end.
     *
     * React once to the whole unit of work.
     * Runs when the transaction closed.
     *
     * @param {object} ctx  subject: the transaction: { id, origin, bulk, operations: [{ hook, entity?, id? }], marks: {} } (origin is what started it: outline editor, import, CLI, a single save) plus ok; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "transaction.after.end": async (ctx) => {
      if (ctx.subject.marks["example.reindex"]) log("transaction.after.end: one reindex for the whole bulk edit", ctx);
    },
    /**
     * Implements hook rest.before.request.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check or adjust the request before the handler runs, or refuse it.
     * Runs when a request to a plugin or core route is about to reach its handler.
     *
     * @param {object} ctx  subject: the request: { method, path, operationId, headers, query, body, user? }; previous: none.
     * @returns {Promise<*>}  the request (may change headers, query or body); may call ctx.veto().
     */
    "rest.before.request": async (ctx) => {
      log("rest.before.request", ctx);
    },
    /**
     * Implements hook rest.after.request.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: adjust the response before it is sent; not detachable.
     * Runs when the handler produced a response, before it is sent.
     *
     * @param {object} ctx  subject: the response: { status, headers, body }, with the request in ctx.request; previous: none.
     * @returns {Promise<*>}  the response (add headers, trim fields).
     */
    "rest.after.request": async (ctx) => {
      log("rest.after.request", ctx);
    },
    /**
     * Implements hook plugin.before.requirements.
     *
     * Report unmet requirements; the plugin stays enabled but inactive until the list is empty.
     * Runs when status is being calculated (enable, settings save, dashboard load).
     *
     * @param {object} ctx  subject: the list of unmet requirements so far [{ key, message }]; it starts with one entry per required settings field that has no value (core adds these), so a hook only adds what the settings form cannot express; previous: none.
     * @returns {Promise<*>}  the list with this plugin's own unmet requirements added.
     */
    "plugin.before.requirements": async (ctx) => {
      log("plugin.before.requirements", ctx);
      const unmet = [...ctx.subject];
      if (!ctx.settings.greeting) unmet.push({ key: "settings.greeting", message: "Set a greeting before this plugin activates" });
      return unmet;
    },
    /**
     * Implements hook plugin.after.requirements.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react to becoming active or inactive.
     * Runs when the requirements list is final and status is set.
     *
     * @param {object} ctx  subject: { id, scope, siteId?, status, unmet: [{ key, message }] }; previous: the previous status.
     * @returns {Promise<*>}  nothing.
     */
    "plugin.after.requirements": async (ctx) => {
      log("plugin.after.requirements", ctx);
    },
    /**
     * Implements hook plugin.before.install.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check preconditions for install; veto to refuse.
     * Runs when about to install (runs once, the first time the plugin is enabled in a scope).
     *
     * @param {object} ctx  subject: { id, version, scope, siteId? } (the plugin changing state); previous: none.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "plugin.before.install": async (ctx) => {
      log("plugin.before.install", ctx);
    },
    /**
     * Implements hook plugin.after.install.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: migrate settings that used to live in site.json or core config into this plugin's settings.
     * Runs when install finished.
     *
     * @param {object} ctx  subject: { id, version, scope, siteId? } (the plugin changing state); previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "plugin.after.install": async (ctx) => {
      log("plugin.after.install", ctx);
    },
    /**
     * Implements hook plugin.before.enable.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check preconditions for enable; veto to refuse.
     * Runs when about to enable (runs every time the plugin is enabled in a scope).
     *
     * @param {object} ctx  subject: { id, version, scope, siteId? } (the plugin changing state); previous: none.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "plugin.before.enable": async (ctx) => {
      log("plugin.before.enable", ctx);
    },
    /**
     * Implements hook plugin.after.enable.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: set up what the plugin needs at runtime.
     * Runs when enable finished.
     *
     * @param {object} ctx  subject: { id, version, scope, siteId? } (the plugin changing state); previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "plugin.after.enable": async (ctx) => {
      log("plugin.after.enable", ctx);
    },
    /**
     * Implements hook plugin.before.disable.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check preconditions for disable; veto to refuse.
     * Runs when about to disable (runs when the plugin is disabled in a scope; data is kept).
     *
     * @param {object} ctx  subject: { id, version, scope, siteId? } (the plugin changing state); previous: none.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "plugin.before.disable": async (ctx) => {
      log("plugin.before.disable", ctx);
    },
    /**
     * Implements hook plugin.after.disable.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: tear down what enable set up; core clears caches and rebuilds managed outputs.
     * Runs when disable finished.
     *
     * @param {object} ctx  subject: { id, version, scope, siteId? } (the plugin changing state); previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "plugin.after.disable": async (ctx) => {
      log("plugin.after.disable", ctx);
    },
    /**
     * Implements hook plugin.before.uninstall.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check preconditions for uninstall; veto to refuse.
     * Runs when about to uninstall (runs when the plugin is uninstalled after disable; its data is purged).
     *
     * @param {object} ctx  subject: { id, version, scope, siteId? } (the plugin changing state); previous: none.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "plugin.before.uninstall": async (ctx) => {
      log("plugin.before.uninstall", ctx);
    },
    /**
     * Implements hook plugin.after.uninstall.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: remove anything outside the plugin's own stores.
     * Runs when uninstall finished.
     *
     * @param {object} ctx  subject: { id, version, scope, siteId? } (the plugin changing state); previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "plugin.after.uninstall": async (ctx) => {
      log("plugin.after.uninstall", ctx);
    },
    /**
     * Implements hook plugin.before.upgrade.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check preconditions for upgrade; veto to refuse.
     * Runs when about to upgrade (runs when a newer version is installed, around its upgrade steps).
     *
     * @param {object} ctx  subject: { id, version, scope, siteId? } (the plugin changing state); previous: the installed version.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "plugin.before.upgrade": async (ctx) => {
      log("plugin.before.upgrade", ctx);
    },
    /**
     * Implements hook plugin.after.upgrade.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: prepare for or follow up on data upgrades.
     * Runs when upgrade finished.
     *
     * @param {object} ctx  subject: { id, version, scope, siteId? } (the plugin changing state); previous: the installed version.
     * @returns {Promise<*>}  nothing.
     */
    "plugin.after.upgrade": async (ctx) => {
      log("plugin.after.upgrade", ctx);
    },
    /**
     * Implements hook site.before.create.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check or adjust before the site is created, or veto.
     * Runs when a site is about to be created.
     *
     * @param {object} ctx  subject: the site summary: { id, name, title, path, theme, owner }; a skeleton or import can be adjusted in the before hook; previous: none.
     * @returns {Promise<*>}  the site summary (may change it); may call ctx.veto().
     */
    "site.before.create": async (ctx) => {
      log("site.before.create", ctx);
    },
    /**
     * Implements hook site.after.create.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react after the site is created.
     * Runs when the site was created.
     *
     * @param {object} ctx  subject: the site summary: { id, name, title, path, theme, owner } as it is after the operation; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "site.after.create": async (ctx) => {
      log("site.after.create", ctx);
    },
    /**
     * Implements hook site.before.duplicate.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check or adjust before the site is duplicated, or veto.
     * Runs when a site is about to be duplicated.
     *
     * @param {object} ctx  subject: the site summary: { id, name, title, path, theme, owner }; subject is the source site; ctx.target is the new one; previous: none.
     * @returns {Promise<*>}  the site summary (may change it); may call ctx.veto().
     */
    "site.before.duplicate": async (ctx) => {
      log("site.before.duplicate", ctx);
    },
    /**
     * Implements hook site.after.duplicate.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react after the site is duplicated.
     * Runs when the site was duplicated.
     *
     * @param {object} ctx  subject: the site summary: { id, name, title, path, theme, owner } as it is after the operation; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "site.after.duplicate": async (ctx) => {
      log("site.after.duplicate", ctx);
    },
    /**
     * Implements hook site.before.archive.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check or adjust before the site is archived, or veto.
     * Runs when a site is about to be archived.
     *
     * @param {object} ctx  subject: the site summary: { id, name, title, path, theme, owner }; previous: none.
     * @returns {Promise<*>}  the site summary (may change it); may call ctx.veto().
     */
    "site.before.archive": async (ctx) => {
      log("site.before.archive", ctx);
    },
    /**
     * Implements hook site.after.archive.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react after the site is archived.
     * Runs when the site was archived.
     *
     * @param {object} ctx  subject: the site summary: { id, name, title, path, theme, owner } as it is after the operation; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "site.after.archive": async (ctx) => {
      log("site.after.archive", ctx);
    },
    /**
     * Implements hook site.before.delete.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check or adjust before the site is deleted, or veto.
     * Runs when a site is about to be deleted.
     *
     * @param {object} ctx  subject: the site summary: { id, name, title, path, theme, owner }; previous: none.
     * @returns {Promise<*>}  the site summary (may change it); may call ctx.veto().
     */
    "site.before.delete": async (ctx) => {
      log("site.before.delete", ctx);
    },
    /**
     * Implements hook site.after.delete.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react after the site is deleted.
     * Runs when the site was deleted.
     *
     * @param {object} ctx  subject: the site summary: { id, name, title, path, theme, owner } as it is after the operation; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "site.after.delete": async (ctx) => {
      log("site.after.delete", ctx);
    },
    /**
     * Implements hook site.before.export.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: check or adjust before the site is exported, or veto.
     * Runs when a site is about to be exported.
     *
     * @param {object} ctx  subject: the site summary: { id, name, title, path, theme, owner }; ctx.format names the export format; previous: none.
     * @returns {Promise<*>}  the site summary (may change it); may call ctx.veto().
     */
    "site.before.export": async (ctx) => {
      log("site.before.export", ctx);
    },
    /**
     * Implements hook site.after.export.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react after the site is exported.
     * Runs when the site was exported.
     *
     * @param {object} ctx  subject: the site summary: { id, name, title, path, theme, owner } as it is after the operation; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "site.after.export": async (ctx) => {
      log("site.after.export", ctx);
    },
    /**
     * Implements hook user.before.login.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: refuse the login (for example outside allowed hours), or veto.
     * Runs when a user is about to login.
     *
     * @param {object} ctx  subject: the user: a limited record { id, name, displayName, roles, avatar } by default; the full record (email and profile fields, never the password or tokens) only with the users:full capability; previous: none.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "user.before.login": async (ctx) => {
      log("user.before.login", ctx);
    },
    /**
     * Implements hook user.after.login.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react to the login: record it, warm a cache.
     * Runs when the user login finished.
     *
     * @param {object} ctx  subject: the user: a limited record { id, name, displayName, roles, avatar } by default; the full record (email and profile fields, never the password or tokens) only with the users:full capability; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "user.after.login": async (ctx) => {
      log("user.after.login", ctx);
    },
    /**
     * Implements hook user.before.logout.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: refuse the logout (for example outside allowed hours), or veto.
     * Runs when a user is about to logout.
     *
     * @param {object} ctx  subject: the user: a limited record { id, name, displayName, roles, avatar } by default; the full record (email and profile fields, never the password or tokens) only with the users:full capability; previous: none.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "user.before.logout": async (ctx) => {
      log("user.before.logout", ctx);
    },
    /**
     * Implements hook user.after.logout.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react to the logout: record it, warm a cache.
     * Runs when the user logout finished.
     *
     * @param {object} ctx  subject: the user: a limited record { id, name, displayName, roles, avatar } by default; the full record (email and profile fields, never the password or tokens) only with the users:full capability; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "user.after.logout": async (ctx) => {
      log("user.after.logout", ctx);
    },
    /**
     * Implements hook user.before.export.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: refuse the export (for example while an identity check is pending), or veto.
     * Runs when core is about to export everything kept about a user (personalData stores and privacy.export).
     *
     * @param {object} ctx  subject: { userId }; previous: none.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "user.before.export": async (ctx) => {
      log("user.before.export", ctx);
    },
    /**
     * Implements hook user.after.export.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: record that an export happened.
     * Runs when the export was assembled.
     *
     * @param {object} ctx  subject: { userId, stores: ["<plugin>.<store>"] } (store names only, never the records); previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "user.after.export": async (ctx) => {
      log("user.after.export", ctx);
    },
    /**
     * Implements hook user.before.erase.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: refuse the erase (for example a legal hold), or veto.
     * Runs when core is about to erase everything kept about a user.
     *
     * @param {object} ctx  subject: { userId }; previous: none.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "user.before.erase": async (ctx) => {
      log("user.before.erase", ctx);
    },
    /**
     * Implements hook user.after.erase.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: clean up copies outside stores: published snapshots, caches, search indexes.
     * Runs when the erase finished.
     *
     * @param {object} ctx  subject: { userId, removed: { "<plugin>.<store>": count } }; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "user.after.erase": async (ctx) => {
      log("user.after.erase", ctx);
    },
    /**
     * Implements hook register.before.routes.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: add to the routes list.
     * Runs when the platform is collecting OpenAPI paths contributed by plugins.
     *
     * @param {object} ctx  subject: the list collected so far; previous: none.
     * @returns {Promise<*>}  the list with this plugin's additions.
     */
    "register.before.routes": async (ctx) => {
      log("register.before.routes", ctx);
    },
    /**
     * Implements hook register.after.routes.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: inspect the final routes list (audit, conflicts).
     * Runs when the routes list is complete.
     *
     * @param {object} ctx  subject: the merged list from every plugin; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "register.after.routes": async (ctx) => {
      log("register.after.routes", ctx);
    },
    /**
     * Implements hook register.before.entities.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: add to the entities list.
     * Runs when the platform is collecting entity definitions.
     *
     * @param {object} ctx  subject: the list collected so far; previous: none.
     * @returns {Promise<*>}  the list with this plugin's additions.
     */
    "register.before.entities": async (ctx) => {
      log("register.before.entities", ctx);
    },
    /**
     * Implements hook register.after.entities.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: inspect the final entities list (audit, conflicts).
     * Runs when the entities list is complete.
     *
     * @param {object} ctx  subject: the merged list from every plugin; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "register.after.entities": async (ctx) => {
      log("register.after.entities", ctx);
    },
    /**
     * Implements hook register.before.contracts.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: add to the contracts list.
     * Runs when the platform is collecting contract implementations.
     *
     * @param {object} ctx  subject: the list collected so far; previous: none.
     * @returns {Promise<*>}  the list with this plugin's additions.
     */
    "register.before.contracts": async (ctx) => {
      log("register.before.contracts", ctx);
    },
    /**
     * Implements hook register.after.contracts.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: inspect the final contracts list (audit, conflicts).
     * Runs when the contracts list is complete.
     *
     * @param {object} ctx  subject: the merged list from every plugin; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "register.after.contracts": async (ctx) => {
      log("register.after.contracts", ctx);
    },
    /**
     * Implements hook register.before.prompts.
     *
     * Add to the prompts list.
     * Runs when the platform is collecting prompts (seeded from docs/prompts.yaml) for the plugin screen and the MCP plugin.
     *
     * @param {object} ctx  subject: the list collected so far; previous: none.
     * @returns {Promise<*>}  the list with this plugin's additions.
     */
    "register.before.prompts": async (ctx) => {
      log("register.before.prompts", ctx);
      return ctx.subject;
    },
    /**
     * Implements hook register.after.prompts.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: inspect the final prompts list (audit, conflicts).
     * Runs when the prompts list is complete.
     *
     * @param {object} ctx  subject: the merged list from every plugin; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "register.after.prompts": async (ctx) => {
      log("register.after.prompts", ctx);
    },
    /**
     * Implements hook render.before.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: serve a cached document with ctx.respond(html), or prepare the context.
     * Runs when a page is about to be rendered (live request or static publish).
     *
     * @param {object} ctx  subject: the render context: { site, page, theme, mode, cacheable, head: [tags], content, body: { start: [], end: [] }, html }, filled in as the stages progress; only site, page, theme and mode are set; previous: none.
     * @returns {Promise<*>}  the context, or ctx.respond(html) to short-circuit with a cached document; may call ctx.veto().
     */
    "render.before": async (ctx) => {
      log("render.before", ctx);
    },
    /**
     * Implements hook render.before.head.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: add meta, link and script tags to the head.
     * Runs when the head is about to be assembled.
     *
     * @param {object} ctx  subject: the render context: { site, page, theme, mode, cacheable, head: [tags], content, body: { start: [], end: [] }, html }, filled in as the stages progress; previous: none.
     * @returns {Promise<*>}  the context (add to head).
     */
    "render.before.head": async (ctx) => {
      log("render.before.head", ctx);
    },
    /**
     * Implements hook render.after.head.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: inspect or reorder the final head.
     * Runs when the head is assembled.
     *
     * @param {object} ctx  subject: the render context: { site, page, theme, mode, cacheable, head: [tags], content, body: { start: [], end: [] }, html }, filled in as the stages progress; head is final; previous: none.
     * @returns {Promise<*>}  the context.
     */
    "render.after.head": async (ctx) => {
      log("render.after.head", ctx);
    },
    /**
     * Implements hook render.before.content.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: transform content before it is placed, for example server-side render custom elements.
     * Runs when the page content is about to be placed in the shell.
     *
     * @param {object} ctx  subject: the render context: { site, page, theme, mode, cacheable, head: [tags], content, body: { start: [], end: [] }, html }, filled in as the stages progress; content is the stored page HTML; previous: none.
     * @returns {Promise<*>}  the context (replace or transform content).
     */
    "render.before.content": async (ctx) => {
      log("render.before.content", ctx);
    },
    /**
     * Implements hook render.after.content.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: inspect or post-process the placed content.
     * Runs when the content is placed.
     *
     * @param {object} ctx  subject: the render context: { site, page, theme, mode, cacheable, head: [tags], content, body: { start: [], end: [] }, html }, filled in as the stages progress; content is final; previous: none.
     * @returns {Promise<*>}  the context.
     */
    "render.after.content": async (ctx) => {
      log("render.after.content", ctx);
    },
    /**
     * Implements hook render.before.body.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: inject markup at the start of the body.
     * Runs when right after the opening body tag.
     *
     * @param {object} ctx  subject: the render context: { site, page, theme, mode, cacheable, head: [tags], content, body: { start: [], end: [] }, html }, filled in as the stages progress; previous: none.
     * @returns {Promise<*>}  the context (push to body.start).
     */
    "render.before.body": async (ctx) => {
      log("render.before.body", ctx);
    },
    /**
     * Implements hook render.after.body.
     *
     * Inject singletons and scripts at the end of the body, with settings baked in from the plugin's config.
     * Runs when right before the closing body tag.
     *
     * @param {object} ctx  subject: the render context: { site, page, theme, mode, cacheable, head: [tags], content, body: { start: [], end: [] }, html }, filled in as the stages progress; previous: none.
     * @returns {Promise<*>}  the context (push to body.end).
     */
    "render.after.body": async (ctx) => {
      // bake the setting into the markup; the element never asks the server. Never put secrets here.
      const greeting = String(ctx.settings.greeting || "").replace(/[<>"&]/g, "");
      ctx.subject.body.end.push(`<awesome-counter greeting="${greeting}"></awesome-counter>`);
      return ctx.subject;
    },
    /**
     * Implements hook render.after.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: last chance to alter the final document; store it in a cache. Stages: transform changes the document (minify, rewrite links), seal computes things over the final bytes (CSP hashes, signatures), store keeps the result (page caches, static publish).
     * Runs when the document is complete.
     *
     * @param {object} ctx  subject: the render context: { site, page, theme, mode, cacheable, head: [tags], content, body: { start: [], end: [] }, html }, filled in as the stages progress; html is the final document; previous: none.
     * @returns {Promise<*>}  the context (may change html).
     */
    "render.after": async (ctx) => {
      log("render.after", ctx);
    },
    /**
     * Implements hook rebuild.before.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: prepare for a rebuild, mark fragment pages, or veto it.
     * Runs when managed files are about to be regenerated (registries, page shells, static output).
     *
     * @param {object} ctx  subject: { scope, siteId?, reason, fragments: [itemIds] } (fragments: pages that are content pieces rendered inside other pages, such as region content, so they are left out of llms.txt, the sitemap and search); previous: none.
     * @returns {Promise<*>}  the subject (add item ids to fragments); may call ctx.veto().
     */
    "rebuild.before": async (ctx) => {
      log("rebuild.before", ctx);
    },
    /**
     * Implements hook rebuild.after.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: write this plugin's own managed files.
     * Runs when managed files were regenerated.
     *
     * @param {object} ctx  subject: { scope, siteId?, reason, files: [paths] }; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "rebuild.after": async (ctx) => {
      log("rebuild.after", ctx);
    },
    /**
     * Implements hook schedule.before.run.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: skip a job run (for example during maintenance).
     * Runs when a scheduled job is about to run (from hax plugin schedule run or the timer plugin).
     *
     * @param {object} ctx  subject: { job, plugin, scope, siteId?, lastRun }; previous: none.
     * @returns {Promise<*>}  nothing; may call ctx.veto().
     */
    "schedule.before.run": async (ctx) => {
      log("schedule.before.run", ctx);
    },
    /**
     * Implements hook schedule.after.run.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: record the result or alert on failure.
     * Runs when the scheduled job finished.
     *
     * @param {object} ctx  subject: { job, plugin, scope, siteId?, ok, durationMs, error? }; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "schedule.after.run": async (ctx) => {
      log("schedule.after.run", ctx);
    },
    /**
     * Implements hook example.before.explode.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: make the explosion smaller, or veto it.
     * Runs when the example's explode route is about to trigger an explosion.
     *
     * @param {object} ctx  subject: { fileId, size }; previous: none.
     * @returns {Promise<*>}  the explosion (may change size); may call ctx.veto().
     */
    "example.before.explode": async (ctx) => {
      log("example.before.explode", ctx);
    },
    /**
     * Implements hook example.after.explode.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: react to an explosion.
     * Runs when the explosion happened.
     *
     * @param {object} ctx  subject: { fileId, size, at }; previous: none.
     * @returns {Promise<*>}  nothing.
     */
    "example.after.explode": async (ctx) => {
      log("example.after.explode", ctx);
    },
    /**
     * Implements hook example.before.awesomeSave.
     *
     * Logs the call so tests can see it, and shows the signature. A real implementation would: same as entity.before.create/update on awesomeFile, under a clearer name.
     * Runs when an .awesome file is about to be saved.
     *
     * @param {object} ctx  subject: the awesomeFile record; previous: none.
     * @returns {Promise<*>}  the record; may call ctx.veto().
     */
    "example.before.awesomeSave": async (ctx) => {
      log("example.before.awesomeSave", ctx);
    },
  },
};

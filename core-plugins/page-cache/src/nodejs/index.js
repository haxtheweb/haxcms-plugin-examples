// Page cache (Node). Mirrored in src/php/Plugin.php.
const usable = (ctx) => ctx.subject.mode === "dynamic" && !ctx.user && ctx.subject.page && ctx.subject.page.id;
async function clear(ctx, why) {
  const had = Object.keys((await ctx.storage.read("pages")) || {}).length;
  await ctx.storage.write("pages", {});
  if (had) ctx.log.info(`cleared ${had} cached pages (${why})`);
  return had;
}

export default {
  operations: {
    /**
     * Implements operation pageCacheClear.
     *
     * Empties the page cache on request and reports how many pages were dropped.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @returns {Promise<object>}  { cleared }.
     */
    async pageCacheClear(ctx) { return { cleared: await clear(ctx, "by request") }; },
  },
  hooks: {
    /**
     * Implements hook render.before.
     *
     * Answers an anonymous dynamic page view straight from the cache when a copy exists and is younger than the ttl setting (0 means no expiry), skipping the rest of rendering.
     *
     * @param {object} ctx  ctx.subject: the render context ({ site, page, theme, mode, ... }); ctx.user is empty for anonymous views.
     * @returns {Promise<void>}  nothing, or ctx.respond(html) on a hit.
     */
    "render.before": async (ctx) => {
      if (!usable(ctx)) return;
      const hit = ((await ctx.storage.read("pages")) || {})[ctx.subject.page.id];
      const ttl = Number(ctx.settings.ttl) || 0;
      if (hit && (!ttl || ctx.now() - hit.at < ttl * 1000)) return ctx.respond(hit.html);
    },
    /**
     * Implements hook render.after.
     *
     * Stores the final document of an anonymous dynamic page view, in the store stage so it runs after anything that changes or signs the document; renders marked cacheable: false are skipped.
     *
     * @param {object} ctx  ctx.subject: the render context, with html as the final document.
     * @returns {Promise<void>}
     */
    "render.after": async (ctx) => {
      if (!usable(ctx) || ctx.subject.cacheable === false) return;
      const pages = (await ctx.storage.read("pages")) || {};
      pages[ctx.subject.page.id] = { html: ctx.subject.html, at: ctx.now() };
      await ctx.storage.write("pages", pages);
    },
    /**
     * Implements hook page.after.save.
     *
     * Clears the whole cache when a page is saved, since menus and links on other pages may change too.
     *
     * @param {object} ctx  ctx.subject: the page as written; ctx.previous: the page before the save.
     * @returns {Promise<void>}
     */
    "page.after.save": async (ctx) => { await clear(ctx, "page saved"); },
    /**
     * Implements hook page.after.delete.
     *
     * Clears the whole cache when a page is deleted, so no cached page still links to it.
     *
     * @param {object} ctx  ctx.subject: the page as it was before deletion.
     * @returns {Promise<void>}
     */
    "page.after.delete": async (ctx) => { await clear(ctx, "page deleted"); },
    /**
     * Implements hook manifest.after.save.
     *
     * Clears the whole cache when site.json is saved, because the outline and site settings appear on every page.
     *
     * @param {object} ctx  ctx.subject: site.json as written; ctx.previous: site.json before the save.
     * @returns {Promise<void>}
     */
    "manifest.after.save": async (ctx) => { await clear(ctx, "site saved"); },
    /**
     * Implements hook config.after.save.
     *
     * Clears the whole cache when any plugin's settings are saved (subscribed with config: ["*"]), since settings can change what pages look like.
     *
     * @param {object} ctx  ctx.subject: { plugin, scope, siteId?, values }; ctx.previous: the values before the save.
     * @returns {Promise<void>}
     */
    "config.after.save": async (ctx) => { await clear(ctx, `${ctx.subject.plugin} settings saved`); },
    /**
     * Implements hook plugin.after.enable.
     *
     * Clears the whole cache when a plugin is enabled, since it may add to every rendered page.
     *
     * @param {object} ctx  ctx.subject: { id, version, scope, siteId? } of the plugin enabled.
     * @returns {Promise<void>}
     */
    "plugin.after.enable": async (ctx) => { await clear(ctx, `${ctx.subject.id} enabled`); },
    /**
     * Implements hook plugin.after.disable.
     *
     * Clears the whole cache when a plugin is disabled, so pages it changed are rendered again without it.
     *
     * @param {object} ctx  ctx.subject: { id, version, scope, siteId? } of the plugin disabled.
     * @returns {Promise<void>}
     */
    "plugin.after.disable": async (ctx) => { await clear(ctx, `${ctx.subject.id} disabled`); },
  },
};

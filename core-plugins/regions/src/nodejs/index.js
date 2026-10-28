// Regions (Node). Mirrored in src/php/Plugin.php.
export const REGIONS = ["header", "sidebarFirst", "sidebarSecond", "contentTop", "contentBottom", "footerPrimary", "footerSecondary"];

// settings store each region as [{ node: <page id> }] (the form's array field); the published map uses plain ids
const ids = (v) => [].concat(v || []).map((e) => (e && typeof e === "object" ? e.node : e)).filter((x) => typeof x === "string" && x);
export const toMap = (values) => Object.fromEntries(REGIONS.filter((r) => ids(values[r]).length).map((r) => [r, ids(values[r])]));

export default {
  hooks: {
    /**
     * Implements hook config.before.save.
     *
     * Refuses a region entry that is not a page of this site, so a region never points at a missing page.
     *
     * @param {object} ctx  ctx.subject: { plugin, scope, siteId, values } as submitted (each region as
     *                      [{ node: <page id> }]); ctx.previous: the stored values.
     * @returns {Promise<object>}  the subject unchanged, or a veto.
     */
    "config.before.save": async (ctx) => {
      const pages = new Set((await ctx.entities.list("page")).map((p) => p.id));
      for (const r of REGIONS) for (const id of ids(ctx.subject.values[r])) if (!pages.has(id)) return ctx.veto(`region ${r}: "${id}" is not a page of this site`);
      return ctx.subject;
    },
    /**
     * Implements hook config.after.save.
     *
     * Writes the region map (region -> page ids) to the manifest store, where the region element reads it.
     *
     * @param {object} ctx  ctx.subject: { plugin, scope, siteId, values } as written; ctx.previous: the values before the save.
     * @returns {Promise<void>}  nothing.
     */
    "config.after.save": async (ctx) => {
      await ctx.storage.write("map", toMap(ctx.subject.values));
    },
    /**
     * Implements hook rebuild.before.
     *
     * Adds every page used in a region to fragments, because region pages render inside every page and are not
     * pages of their own for llms.txt, the sitemap or search.
     *
     * @param {object} ctx  ctx.subject: { scope, siteId, reason, fragments }.
     * @returns {Promise<object>}  the subject with the region pages added to fragments.
     */
    "rebuild.before": async (ctx) => {
      const map = (await ctx.storage.read("map")) || {};
      const used = Object.values(map).flat();
      return { ...ctx.subject, fragments: [...new Set([...(ctx.subject.fragments || []), ...used])] };
    },
    /**
     * Implements hook page.before.delete.
     *
     * Warns when the page being deleted is shown in a region, since it will disappear from that region.
     *
     * @param {object} ctx  ctx.subject: the page as stored ({ id, title, ... }).
     * @returns {Promise<void>}  nothing (it warns, never vetoes).
     */
    "page.before.delete": async (ctx) => {
      const map = (await ctx.storage.read("map")) || {};
      for (const [r, list] of Object.entries(map)) if (list.includes(ctx.subject.id)) ctx.warn(`"${ctx.subject.title || ctx.subject.id}" is shown in the ${r} region; it will disappear from it`);
    },
  },
};

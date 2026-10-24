// Regions (Node). Mirrored in src/php/Plugin.php.
export const REGIONS = ["header", "sidebarFirst", "sidebarSecond", "contentTop", "contentBottom", "footerPrimary", "footerSecondary"];

// settings store each region as [{ node: <page id> }] (the form's array field); the published map uses plain ids
const ids = (v) => [].concat(v || []).map((e) => (e && typeof e === "object" ? e.node : e)).filter((x) => typeof x === "string" && x);
export const toMap = (values) => Object.fromEntries(REGIONS.filter((r) => ids(values[r]).length).map((r) => [r, ids(values[r])]));

export default {
  hooks: {
    // every entry must be a page of this site
    "config.before.save": async (ctx) => {
      const pages = new Set((await ctx.entities.list("page")).map((p) => p.id));
      for (const r of REGIONS) for (const id of ids(ctx.subject.values[r])) if (!pages.has(id)) return ctx.veto(`region ${r}: "${id}" is not a page of this site`);
      return ctx.subject;
    },
    "config.after.save": async (ctx) => {
      await ctx.storage.write("map", toMap(ctx.subject.values));
    },
    // region pages render inside every page; they are not pages of their own for llms.txt, the sitemap or search
    "rebuild.before": async (ctx) => {
      const map = (await ctx.storage.read("map")) || {};
      const used = Object.values(map).flat();
      return { ...ctx.subject, fragments: [...new Set([...(ctx.subject.fragments || []), ...used])] };
    },
    "page.before.delete": async (ctx) => {
      const map = (await ctx.storage.read("map")) || {};
      for (const [r, list] of Object.entries(map)) if (list.includes(ctx.subject.id)) ctx.warn(`"${ctx.subject.title || ctx.subject.id}" is shown in the ${r} region; it will disappear from it`);
    },
  },
};

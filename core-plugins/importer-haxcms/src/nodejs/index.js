// HAXcms importer (Node). Mirrored in src/php/Plugin.php.
const SITE_FILES = ["theme/theme.css", "theme/theme.html", "custom/build/custom.es6.js"];
const BOILERPLATE = "// custom comment script here";

/**
 * The site's base URL from whatever the person pasted (the root or site.json). Deployment host aliases (HAXiam serves
 * iam. sites from oer.) are applied by core before the call, so this plugin knows nothing about HAXiam.
 */
export function baseOf(url) {
  const u = new URL(String(url).replace(/\/site\.json$/, ""));
  return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
}

async function text(ctx, url) {
  try { const r = await ctx.fetch(url); return r.ok ? await r.text() : null; } catch { return null; }
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Reads site.json, then each page's HTML from its location; lists the files pages reference and the site's
       * theme overrides for core to fetch. Pages that cannot be read come back empty rather than failing the import.
       *
       * @param {object} ctx    Platform context (spec/13); ctx.fetch reaches only input.url's host.
       * @param {object} input  { url }.
       * @returns {Promise<object>}  { title, items, files } or { error }.
       */
      async convert(ctx, input) {
        if (!input || !input.url) return { error: "url is required" };
        let base;
        try { base = baseOf(input.url); } catch { return { error: "url is not a URL" }; }
        let site;
        try { const r = await ctx.fetch(`${base}/site.json`); if (!r.ok) throw new Error(`HTTP ${r.status}`); site = await r.json(); }
        catch (e) { return { error: `unable to fetch site.json: ${e.message}` }; }
        if (!site || !Array.isArray(site.items)) return { error: "site.json has no items" };
        const files = [];
        const items = [];
        for (const it of site.items) {
          const content = it.location ? await text(ctx, `${base}/${it.location}`) : null;
          items.push({ id: it.id, title: it.title, slug: it.slug, parent: it.parent ?? null, order: it.order ?? items.length, indent: it.indent ?? 0, content: content ?? "", metadata: it.metadata || {} });
          for (const f of (it.metadata && it.metadata.files) || []) if (f && f.url) files.push({ path: f.url, url: `${base}/${f.url}` });
        }
        for (const path of SITE_FILES) {
          const t = await text(ctx, `${base}/${path}`);
          if (t && t.trim() && !(path.endsWith(".es6.js") && t.trim() === BOILERPLATE)) files.push({ path, url: `${base}/${path}` });
        }
        return { title: site.title || "Imported site", items, files };
      },
    },
  },
};

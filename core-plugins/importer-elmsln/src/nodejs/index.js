// ELMS:LN importer (Node). Mirrored in src/php/Plugin.php; identical output.
// ELMS:LN course sites publish a JSON Outline Schema site.json. Page locations may carry the site's own name as a
// prefix (/<name>/pages/...), which is dropped before fetching. A page that cannot be read gets a link to its source
// instead of failing the import, as core does today.

/** Removes script and style blocks and inline event handlers; core sanitizes again on save. */
export const strip = (html) => String(html).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "");

async function text(ctx, url) {
  try { const r = await ctx.fetch(url); return r.ok ? await r.text() : null; } catch { return null; }
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Reads the course's site.json, then each page's HTML from its location, keeping ids, tree, order and metadata;
       * lists the files pages reference for core to fetch. A page that cannot be read links to its source instead.
       *
       * @param {object} ctx    Platform context (spec/13); ctx.fetch reaches only input.url's host.
       * @param {object} input  { url } (the site root or its site.json).
       * @returns {Promise<object>}  { title, items, files } or { error }.
       */
      async convert(ctx, input) {
        if (!input || !input.url) return { error: "url is required" };
        let u;
        try { u = new URL(String(input.url).trim().replace(/\/site\.json$/, "").replace(/\/+$/, "")); } catch { return { error: "url is not a URL" }; }
        const base = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
        let site = null;
        try { const r = await ctx.fetch(`${base}/site.json`); if (r.ok) site = await r.json(); } catch { site = null; }
        if (!site || typeof site !== "object" || !Array.isArray(site.items)) return { error: `no site.json with items at ${base}; this does not look like an ELMS:LN site` };
        const name = (site.metadata && site.metadata.site && site.metadata.site.name) || base.split("/").pop() || u.host;
        const items = [];
        const files = [];
        const seen = Object.create(null);
        for (const it of site.items) {
          if (!it || typeof it !== "object") continue;
          const location = typeof it.location === "string" ? it.location : "";
          let content = "";
          if (location !== "") {
            const path = location.indexOf(`/${name}/`) === 0 ? location.slice(name.length + 2) : location.replace(/^\/+/, "");
            const url = `${base}/${path}`;
            const t = await text(ctx, url);
            content = t !== null ? strip(t) : `<p>get source from <a href="${url}">${url}</a></p>`;
          }
          const item = { id: it.id, title: it.title || "Page", slug: it.slug || it.id, parent: it.parent || null, order: it.order ?? items.length, indent: it.indent ?? 0, content };
          if (it.metadata && typeof it.metadata === "object" && !Array.isArray(it.metadata) && Object.keys(it.metadata).length) item.metadata = it.metadata;
          items.push(item);
          for (const f of (it.metadata && Array.isArray(it.metadata.files) ? it.metadata.files : [])) {
            if (f && typeof f.url === "string" && f.url !== "" && !seen[f.url]) { seen[f.url] = true; files.push({ path: f.url, url: `${base}/${f.url}` }); }
          }
        }
        return { title: site.title || name, items, files };
      },
    },
  },
};

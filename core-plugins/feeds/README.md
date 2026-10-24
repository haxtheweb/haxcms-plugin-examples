# RSS and Atom feeds (core)

**Today:** `HAXCMS.updateAlternateFormats()` writes `rss.xml` and `atom.xml` on every save (`lib/RSS.js`), with the 25 newest items by created date, including unpublished ones, and `llms.txt` names both files.

**As a plugin:** `rebuild.after` writes both as managed files from public pages only (`entities.list("page", { listed: true })`). Dates come from `ctx.now()` when a page has none, so both backends write the same bytes. The files are advertised through `managedFiles` titles, so `llms.txt` lists them while the plugin is on, and core never names them.

- Settings (per site): `limit` (25), `fullContent` (Atom carries page HTML)
- Links use `ctx.site.url` (the site's domain, or the deployment's fallback)

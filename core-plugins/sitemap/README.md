# Sitemap (core)

**Today:** `HAXCMS.updateAlternateFormats()` writes `sitemap.xml` and `sitemap-index.xml` for every item, including unpublished and hidden ones.

**As a plugin:** `rebuild.after` writes both from public pages only, with priority by depth (top level 1.0, second level 0.7, deeper 0.5) and `lastmod` from the page's updated or created time. `sitemap.xml` is advertised in `llms.txt` through its `managedFiles` title.

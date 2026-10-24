# regions

Theme regions, extracted from core.

**Today in core:** `site.json` keeps `metadata.theme.regions` (header, sidebarFirst, sidebarSecond, contentTop, contentBottom, footerPrimary, footerSecondary: lists of page ids), edited in the site settings form (Regions fieldset), saved by `saveManifest` and `saveAppearanceSettings`; the front-end site store reads it and `site-region` renders it; `getThemeRegionItemIds` keeps region pages out of llms.txt.

**As a plugin:**
- Region choices are per-site plugin settings; every entry must be a page of the site.
- `config.after.save` publishes the map into `site.json` at `metadata.plugins.regions.map` (a manifest store), so static sites and the region element can read it.
- On first enable, core moves `metadata.theme.regions` into the settings (`legacy.settings`); `config.before.save` normalizes the old shape.
- `regions-region` renders a region; `legacy.tags` keeps `<site-region>` working in every theme.
- `rebuild.before` adds region pages to `fragments`, so core leaves them out of llms.txt, the sitemap and search without knowing about regions.
- Deleting a page used in a region warns.

**Core changes when extracted (not made here):** remove the Regions fieldset from `siteFields.json`, the regions handling in `saveManifest.js` and `saveAppearanceSettings.js`, `getThemeRegionItemIds` (replaced by `fragments`), and the site store's read of `metadata.theme.regions`.

Tests: `node harness/run-cases.mjs core-plugins/regions`.

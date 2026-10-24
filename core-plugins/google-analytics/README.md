# google-analytics

Google Analytics, extracted from core.

**Today in core:** the measurement id lives in `site.json` at `metadata.site.settings.gaID`, edited in the site settings form (SEO section, `coreConfig/siteFields.json`), saved by the `saveManifest` and `saveSeoSettings` site routes, and read by the site shell (`boilerplate/site/index.html`, `ghpages.html`), which loads gtag without asking for consent.

**As a plugin:**
- The id is a per-site plugin setting (`settingsScope: site`). The plugin stays inactive until it is set; a malformed id is refused.
- On first enable for a site, `plugin.after.install` moves `gaID` out of `site.json` into the setting (`legacy.settings` documents the old path).
- `render.before.head` adds a loader with the id baked in that waits for `HAXConsent.onGrant("analytics")`, so nothing loads before consent. It depends on `cookie-consent`.
- Works on static hosting.

**Core changes when extracted (not made here):** remove the gaID field from `siteFields.json`, the gaID handling in `saveManifest.js` and `saveSeoSettings.js`, and the gtag block in the site shell templates.

Tests: `node harness/run-cases.mjs core-plugins/google-analytics`.

# author-profile

Extra author fields, extracted from core.

**Today in core:** `site.json` keeps `metadata.author.phone`, `location`, `website2`, `socialLink` and `socialLink2`, edited in the site settings form and saved by `saveSeoSettings` and `saveManifest`; themes such as resume-theme read them client-side. Name, email, image and license stay in core.

**As a plugin:** per-site settings with link validation (http and https only); `config.after.save` publishes them at `metadata.plugins.author-profile.profile` (a manifest store) for themes and static sites; core moves the five fields out of `metadata.author` on first enable (`legacy.settings`); pages get a schema.org Person block.

**Core and theme changes when extracted (not made here):** remove the five fields from `siteFields.json` and the two save routes; themes that show them read the published profile (with a fallback to `metadata.author`) and list `author-profile` in `suggests`.

Tests: `node harness/run-cases.mjs core-plugins/author-profile`.

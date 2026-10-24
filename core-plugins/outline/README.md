# outline

The outline (page tree), extracted from core. Required.

**Today in core:** `PATCH /x/api/v1/site/outline` (`updateSiteOutline`) applies a whole outline atomically; the outline designer in haxcms-elements calls it.

**As a plugin:** `outlineUpdate` (and `legacy.routes` for the old path) checks the outline (unique ids, parents in the outline, no loops), then inside one bulk transaction deletes pages left out, creates and updates pages through `ctx.entities`, and saves `site.json`'s `items`. Every page and site hook fires as usual and git makes one commit for the whole edit. New items get server ids, returned in `idMap`.

**Core changes when extracted (not made here):** the `updateSiteOutline` route moves here; the outline designer keeps calling the same path.

Tests: `node harness/run-cases.mjs core-plugins/outline` (loads git, its dependency).

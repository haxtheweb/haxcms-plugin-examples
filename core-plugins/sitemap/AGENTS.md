# AGENTS.md (sitemap)

## Purpose
sitemap.xml and sitemap-index.xml of public pages.

## Rules
- Only listed pages.
- Use ctx.site.url for locations and ctx.now() for missing dates.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/sitemap`.

## Diagnose
- A page is missing: it is unpublished, hidden from the menu or region content.

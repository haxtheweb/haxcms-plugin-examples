# AGENTS.md (seo-meta)

## Purpose
Per-page SEO fields and meta tags.

## Rules
- Write only metadata.plugins.seo-meta.
- Escape every value in attributes.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/seo-meta`.

## Diagnose
- No description tag: the page's search description is empty.

# AGENTS.md (feeds)

## Purpose
RSS 2.0 and Atom feeds of a site's newest public pages.

## Rules
- Only listed pages (published, not hidden, not region content).
- Never read the runtime clock; use ctx.now().
- Node and PHP must write identical bytes (XML escaping, date formats).

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/feeds`.

## Diagnose
- Feed missing a page: it is unpublished, hidden from the menu, a region fragment, or beyond the limit.
- Links point at the wrong host: set the site's domain (metadata.site.domain).

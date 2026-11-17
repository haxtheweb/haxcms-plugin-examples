# AGENTS.md (importer-haxcms)

## Purpose
Copy a published HAXcms site (outline, pages, files, theme overrides) into a new site via import.platform.

## Rules
- Fetch only through ctx.fetch, which reaches only input.url's host; never download files here, list them for core.
- Return { title, items, files } or { error }; never throw. An unreadable page is empty, not an error.
- No knowledge of particular deployments (HAXiam aliases are core's job).
- Keep Node and PHP output identical (the [parity] check; tests use fetch fakes).

## Build, test, validate
`node scripts/validate.mjs core-plugins/importer-haxcms`; `node harness/run-cases.mjs core-plugins/importer-haxcms`; `node scripts/plugin-docs.mjs core-plugins/importer-haxcms --check`.

## Diagnose
- "unable to fetch site.json": the URL is not a published HAXcms site, or it is not reachable from the server.
- Pages are empty: their location files are not public at the published URL.
- Custom JS is missing: custom.es6.js still holds only the boilerplate comment, so it is skipped on purpose.

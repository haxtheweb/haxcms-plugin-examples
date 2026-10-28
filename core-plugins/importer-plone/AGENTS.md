# AGENTS.md (importer-plone)

## Purpose
A Plone site, read through plone.restapi, to JSON Outline Schema items via import.platform.

## Rules
- Return { title, items, files } or { error }; never throw.
- Never download images or files; list them in `files` for core.
- Node and PHP must give identical results: keep insertion order (a Map in Node), compare titles by code point.
- Only the host of input.url is reachable; items elsewhere keep their summary.

## Build, test, validate
`node scripts/validate.mjs core-plugins/importer-plone`; `node harness/run-cases.mjs core-plugins/importer-plone`.

## Diagnose
- "Unable to discover Plone REST endpoints": plone.restapi is not installed, or the URL is outside the site.
- "access is denied": grant the `plone.restapi: Use REST API` permission to anonymous (or the importing account).
- Placeholder paragraphs: the site uses Volto blocks; the body needs a blocks-to-HTML transform.

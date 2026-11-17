# AGENTS.md (importer-elmsln)

## Purpose
ELMS:LN site.json and pages to JSON Outline Schema items via import.platform.

## Rules
- Return { title, items, files } or { error }; never throw.
- Fetch only under the base URL the person gave; egress refuses any other host.
- Keep Node and PHP output identical. PHP decodes JSON to arrays, so an empty object inside item metadata comes back as [] in PHP; avoid relying on it.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/importer-elmsln`.

## Diagnose
- Every page is a "get source from" link: locations carry a prefix other than the site name, or the pages need a login.
- "no site.json with items": the URL is not the course root; paste the address that ends where site.json lives.

# AGENTS.md (importer-openstax)

## Purpose
An OpenStax book to JSON Outline Schema items via import.platform.

## Rules
- Return { title, items, files } or { error }; never throw (errors inside are caught and returned).
- Never download image bodies: a HEAD request learns the type, core fetches the file from `files`.
- Node and PHP must give identical results: HTML is cleaned with the same regular expressions, never a DOM parser.
- Only the host of input.url is reachable.

## Build, test, validate
`node scripts/validate.mjs core-plugins/importer-openstax`; `node harness/run-cases.mjs core-plugins/importer-openstax`.

## Diagnose
- "has no book with the slug": the slug in the URL is wrong or the book is retired.
- "is not currently publishing": the book is in the CMS but not in release.json.
- Images left as archive URLs: the HEAD request failed or returned a type other than png, jpeg, gif or webp.

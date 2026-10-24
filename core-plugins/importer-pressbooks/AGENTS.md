# AGENTS.md (importer-pressbooks)

## Purpose
A Pressbooks book (REST API or XHTML export) to JSON Outline Schema items via import.platform. Port of core's
convertPressbooksToSite.js.

## Rules
- Return { title, items } or { error }; never throw. A section that cannot be read becomes `<p></p>`.
- Fetch only through ctx.fetch, only on the host of input.url (egress { input: url }).
- Node and PHP must return identical results: same regular expressions, same entity decoding, same key order.
- Ids are item-1, item-2 ... in output order; slugs are core's cleanTitle, made unique with -2, -3.

## Build, test, validate
`node scripts/validate.mjs core-plugins/importer-pressbooks`; `node harness/run-cases.mjs core-plugins/importer-pressbooks`.

## Diagnose
- "no Pressbooks API found": the site blocks /wp-json/ and the TOC route, or it is plain WordPress (use importer-wordpress).
- A chapter is missing: it has `export: false` in the TOC.
- An export comes back as one error: the file has no `<div class="chapter ...">` style sections (not a Pressbooks XHTML export).

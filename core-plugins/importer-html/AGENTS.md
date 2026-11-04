# AGENTS.md (importer-html)

## Purpose
Convert an HTML document into a JSON Outline Schema item list via import.platform.

## Rules
- Return { title, items } or { error }; never throw on bad input.
- Slugs must be unique within the result (append -2, -3).
- Keep Node and PHP output identical.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/importer-html`.

## Diagnose
- Everything lands on one page: the source uses h3 or div headings; only h2 splits.

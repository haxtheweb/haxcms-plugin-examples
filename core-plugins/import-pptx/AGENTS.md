# AGENTS.md (import-pptx)

## Purpose
Turn a .pptx deck into HTML, one h2 section per slide, for core to split into pages, via import.file.

## Rules
- Convert only; never write pages. Return { html, title? } or { error }; never throw on a bad file.
- Sort slides by number, not by name.
- Keep Node and PHP output identical (the [parity] check).

## Build, test, validate
`node scripts/validate.mjs core-plugins/import-pptx`; `node harness/run-cases.mjs core-plugins/import-pptx` (fixture: tests/fixtures/sample.pptx); `node scripts/plugin-docs.mjs core-plugins/import-pptx --check`.

## Diagnose
- A page is called "Slide n": the slide has no title placeholder (its title is a plain text box).
- Text is missing: it is in a table, chart, grouped shape or speaker notes, which are not read yet.

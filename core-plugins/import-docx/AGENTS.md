# AGENTS.md (import-docx)

## Purpose
Turn a .docx into HTML for core to split into pages, via import.file.

## Rules
- Convert only; never write pages. Return { html, title? } or { error }; never throw on a bad file.
- Read parts only through ctx.archive.read; no zip or DOM library, so Node and PHP parse the XML the same way.
- Keep Node and PHP output identical (the [parity] check).

## Build, test, validate
`node scripts/validate.mjs core-plugins/import-docx`; `node harness/run-cases.mjs core-plugins/import-docx` (fixture: tests/fixtures/sample.docx); `node scripts/plugin-docs.mjs core-plugins/import-docx --check`.

## Diagnose
- Everything lands on one page: the document uses bold paragraphs instead of Heading styles.
- A list shows as paragraphs: its numbering is not in word/numbering.xml, or numId is 0.
- Images are missing: not carried over yet.

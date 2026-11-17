# AGENTS.md (import-markdown)

## Purpose
Turn a Markdown file into HTML for core to split into pages, via import.file.

## Rules
- Convert only; never write pages. Return { html, title? } or { error }; never throw.
- Escape code spans and blocks. Raw HTML passes through as written; core sanitizes page HTML on save.
- The converter lives in markdown.js / Markdown.php; change both together and keep output identical (the [parity] check).

## Build, test, validate
`node scripts/validate.mjs core-plugins/import-markdown`; `node harness/run-cases.mjs core-plugins/import-markdown`; `node scripts/plugin-docs.mjs core-plugins/import-markdown --check`.

## Diagnose
- A construct comes out as plain text (tables, footnotes, task lists, setext headings) or a nested list is flattened: the small converter handles one list level and a CommonMark subset only.
- The front matter title is ignored (and shows as text): the --- block is not the very first thing in the file.

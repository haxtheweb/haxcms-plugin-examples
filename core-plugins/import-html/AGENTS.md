# AGENTS.md (import-html)

## Purpose
Turn an uploaded HTML file into clean HTML for core to split into pages, via import.file.

## Rules
- Convert only; never write pages. Return { html, title? } or { error }; never throw.
- Strip anything executable (scripts, handlers, javascript: URLs, embeds); core's sanitizer is a second line, not the only one.
- Keep Node and PHP output identical (the [parity] check).

## Build, test, validate
`node scripts/validate.mjs core-plugins/import-html`; `node harness/run-cases.mjs core-plugins/import-html`; `node scripts/plugin-docs.mjs core-plugins/import-html --check`.

## Diagnose
- Everything lands on one page: the file has no headings, or uses styled divs as headings.
- The file went to a different plugin: import.file dispatches by extension; only .html and .htm come here.

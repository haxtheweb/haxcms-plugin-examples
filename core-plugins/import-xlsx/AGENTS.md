# AGENTS.md (import-xlsx)

## Purpose
Turn a sheet of title, slug, parent and content rows into a page tree, via import.file (returns items, not HTML).

## Rules
- Convert only; never write pages. Return { items } or { error }; never throw on a bad file.
- Errors name the row number (1-based, header is row 1) so the person can fix the sheet.
- Slugs are unique; parents are matched by slug.
- Keep Node and PHP output identical (the [parity] check).

## Build, test, validate
`node scripts/validate.mjs core-plugins/import-xlsx`; `node harness/run-cases.mjs core-plugins/import-xlsx` (fixtures: tests/fixtures/sample.xlsx, duplicate.xlsx); `node scripts/plugin-docs.mjs core-plugins/import-xlsx --check`.

## Diagnose
- "the first row must name the columns title and slug": the header row has other names or is not row 1.
- A page is at the top level when it should be nested: its parent cell does not match another row's slug after slugging.

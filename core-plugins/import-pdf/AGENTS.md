# AGENTS.md (import-pdf)

## Purpose
Turn the text of a PDF into HTML (larger type as headings) for core to split into pages, via import.file.

## Rules
- Convert only; never write pages. Return { html, title? } or { error }; never throw on a bad file.
- Escape all extracted text before it goes into HTML.
- Keep Node and PHP output identical (the [parity] check); both read the bytes as latin1.

## Build, test, validate
`node scripts/validate.mjs core-plugins/import-pdf`; `node harness/run-cases.mjs core-plugins/import-pdf` (fixture: tests/fixtures/sample.pdf); `node scripts/plugin-docs.mjs core-plugins/import-pdf --check`.

## Diagnose
- "no readable text": the PDF is scanned or uses fonts with their own encodings (CID/ToUnicode); not supported yet.
- No headings: the headings are the same size as body text (bold only), or less than 15% larger.
- Words run together or split: the PDF positions words one by one; spacing comes from TJ gaps only.

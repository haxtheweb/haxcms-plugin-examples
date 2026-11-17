# AGENTS.md (importer-gitbook)

## Purpose
GitBook SUMMARY.md and Markdown pages to JSON Outline Schema items via import.platform, with import-markdown converting each page through the import.file contract.

## Rules
- Return { title, items, files } or { error }; never throw.
- Never parse Markdown here; call ctx.contracts.call("import.file", "convert", { name: "page.md", data: <base64> }).
- Fetch only under the root derived from the URL the person gave; egress refuses any other host.
- Parse SUMMARY.md and rewrite file references with the same regular expressions in both runtimes; keep output identical.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/importer-gitbook` (tests load `core-plugins/import-markdown` with `with:`).

## Diagnose
- "no SUMMARY.md found": the repository's default branch is not main or master (put `/tree/<branch>` in the URL), or the book lives in a subfolder (link to that folder's SUMMARY.md).
- Pages are empty: import-markdown is not active, or the page path in SUMMARY.md does not match the file's case.
- On a real deployment github.com `/raw/` URLs redirect to raw.githubusercontent.com; if fetches fail there, paste the raw.githubusercontent.com URL of SUMMARY.md instead.

# AGENTS.md (importer-quarto)

## Purpose
A Quarto book or website (GitHub repository or zip of one) to JSON Outline Schema items via import.platform. Port of
core's convertQuartoToSite.js, main path only (see README, "Not ported yet").

## Rules
- Return { title, items, files } or { error }; never throw out of convert (internal errors are caught and returned).
- Fetch only api.github.com and raw.githubusercontent.com, through ctx.fetch. Never execute repository code.
- Markdown goes through `ctx.contracts.call("import.file", "convert", { name: "page.md", data })`; import-markdown is a
  dependency. Wrappers (callouts, divs) are built around separately converted markdown runs, because the converter
  passes raw HTML through only inline.
- Node and PHP must return identical results: the YAML subset, regular expressions and key order are mirrored line for
  line. Ids are item-1, item-2 ... in outline order; slugs are core's cleanTitle, nested under the parent, made unique.

## Build, test, validate
`node scripts/validate.mjs core-plugins/importer-quarto`; `node harness/run-cases.mjs core-plugins/importer-quarto`.

## Diagnose
- Pages in file order instead of the book order: `_quarto.yml` uses YAML this subset does not read (flow maps,
  anchors), so the outline came out empty and the file tree was used.
- A page reads "Read this page on the source site": its file could not be fetched, or the 500-page cap was reached.
- "markdown could not be converted": import-markdown is not enabled.

# AGENTS.md (importer-vitepress)

## Purpose
A VitePress site (GitHub repository or zip of one) to JSON Outline Schema items via import.platform. Port of core's
convertVitepressToSite.js, main path only (see README, "Not ported yet").

## Rules
- Return { title, items, files } or { error }; never throw out of convert (internal errors are caught and returned).
- Never execute the repository's config: read it with the literal reader only. Fetch only api.github.com and
  raw.githubusercontent.com, through ctx.fetch.
- Markdown goes through `ctx.contracts.call("import.file", "convert", { name: "page.md", data })`; import-markdown is a
  dependency. Container wrappers and VideoEmbed players are built around separately converted markdown runs, because
  the converter passes raw HTML through only inline.
- Node and PHP must return identical results. PHP's literal reader returns objects as stdClass so `{}` and `[]` stay
  distinct, as they are in JavaScript. Ids are item-1, item-2 ... in outline order; slugs are core's cleanTitle,
  nested under the parent, made unique.

## Build, test, validate
`node scripts/validate.mjs core-plugins/importer-vitepress`; `node harness/run-cases.mjs core-plugins/importer-vitepress`.

## Diagnose
- Pages in file order instead of the sidebar: the sidebar is not plain data (a function call, an imported variable,
  a template with `${}`), so the file tree was used.
- A page reads "Read this page on the source site": its markdown file could not be fetched (a sidebar link to a page
  that does not exist), or the 500-page cap was reached.
- "markdown could not be converted": import-markdown is not enabled.

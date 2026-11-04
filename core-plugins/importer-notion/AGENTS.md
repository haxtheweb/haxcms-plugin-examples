# AGENTS.md (importer-notion)

## Purpose
A Notion export in a GitHub repository to JSON Outline Schema items via import.platform.

## Rules
- Return { title, items, files } or { error }; never throw.
- Markdown goes through `ctx.contracts.call("import.file", "convert", ...)`, never a converter of its own.
- Node and PHP must give identical results: same regular expressions, same id scheme, PHP `encodeUri` mirrors JavaScript's `encodeURI`.
- Only api.github.com and raw.githubusercontent.com are reachable; never fetch anything a page links to.

## Build, test, validate
`node scripts/validate.mjs core-plugins/importer-notion`; `node harness/run-cases.mjs core-plugins/importer-notion` (loads core-plugins/import-markdown).

## Diagnose
- Pages missing their lesson: the page has no `Lesson:` line in the property block right under its title, or there is no blank line after the properties.
- Broken image links: the page links to the file with a different encoding than GitHub's path; only exact matches are rewritten.
- "unable to read the repository file list": wrong branch, a private repository, or the GitHub API rate limit.

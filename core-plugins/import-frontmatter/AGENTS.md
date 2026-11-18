# AGENTS.md (import-frontmatter)

## Purpose
Turn page front matter and site configuration text (YAML, TOML, JSON) into data for site importers, through the
contract this plugin defines and implements (import-frontmatter.data: split, parse).

## Rules
- Text in, data out. No ctx.fetch, no storage, no files. Never evaluate anything from the text.
- Every scalar is returned as a string, from all three formats: never return a number or a boolean (PHP and
  JavaScript print them differently, and importers rely on one shape).
- Node and PHP must return identical results. Empty maps and empty lists cannot be told apart in PHP: importers must
  treat an empty value as either.
- Never set a key named `__proto__`.
- Be forgiving: a line that cannot be read is skipped; split never fails, it returns format none.
- Nothing here knows a generator: no key names, no defaults. That belongs to the importer.
- A change to the output shape is a change to config/contracts.yaml and to every importer that depends on this
  plugin (search for `import-frontmatter.data`).

## Build, test, validate
`node scripts/validate.mjs core-plugins/import-frontmatter`; `node harness/run-cases.mjs core-plugins/import-frontmatter`;
`node harness/check/run.mjs core-plugins/import-frontmatter`. All fixtures are inline text.

## Diagnose
- `format: none` for a page that has front matter: the opening line has text after the marker, the closing `---` or
  `+++` line is missing, or the file starts with a blank line.
- A TOML key is missing: its line was not readable (an unquoted string value, an unclosed quote) and was skipped.
- A YAML list item is split in two: it is quoted and holds a comma inside `[...]`; write it as a block list.
- A value compares unequal to `true` or `10`: values are strings; compare with `"true"` and `"10"`.

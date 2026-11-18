# Import front matter (YAML, TOML, JSON) (core, hidden)

The one place site importers turn a page's front matter and a site's configuration file into data. Static site generators write both in YAML, TOML or JSON, and often let a site mix them; an importer should not care which. This plugin defines and implements the contract `import-frontmatter.data`; an importer lists `import-frontmatter` in `dependencies` and calls it through the platform. Part of https://github.com/haxtheweb/issues/issues/3364.

**Why a plugin and not code inside each importer:** `importer-quarto` and `importer-grav` each carried a copy of the same YAML reader, and Hugo adds TOML and JSON. All four (`importer-quarto`, `importer-grav`, `importer-hugo`, `importer-jekyll`) now read through this plugin. With the readers here, an importer holds only what is particular to its generator, and every importer sees the same shape. It reads text it is handed and nothing else: no network, no files, no storage.

## The contract

`ctx.contracts.call("import-frontmatter.data", "split", input)`

- Input: `{ text }` for one page, or `{ texts: [..] }` for many pages in one call.
- Output: `{ format, data, body }`, or `{ results: [{ format, data, body }, ..] }` for `texts`, in the order given.
  - `format`: `yaml` (front matter between `---` lines), `toml` (between `+++` lines), `json` (a JSON object at the very top), or `none`.
  - `data`: the front matter. Empty when there is none.
  - `body`: the text after the front matter, with LF line ends and no byte order mark. A page with no front matter is all body.

`ctx.contracts.call("import-frontmatter.data", "parse", input)`

- Input: `{ format: yaml | toml | json, text }`: a whole configuration text (`hugo.toml`, `_config.yml`, `config.json`).
- Output: `{ data }` or `{ error }`.

## The shape of `data`

Every map is a map, every list is a list, and **every other value is a string**. `draft: true`, `weight = 10` and an unquoted TOML date come back as `"true"`, `"10"` and `"2026-03-09T14:30:00+02:00"`, the same from all three formats and from both runtimes. An empty value is `null`. An importer compares against the strings it expects (`"true"`, `"false"`) and parses numbers and dates itself.

## What is read

- **YAML:** block maps and lists, quoted and plain scalars, `[a, b]` lists, `|` and `>` text, comments. Not read: anchors and aliases, flow maps (`{a: 1}`), multi-document files, tags. A quoted list item that holds a comma splits at the comma.
- **TOML:** tables, arrays of tables, dotted and quoted keys, basic and literal strings, multi-line strings, arrays over several lines, inline tables, comments. Numbers, booleans and dates are kept as written. A line that is not TOML is skipped and the rest still reads.
- **JSON:** an object; a list or a scalar at the top is not front matter.

## What it implements

Contract `import-frontmatter.data`, operations `split` and `parse`, which it also defines (`config/contracts.yaml`). Each has an `Implements contract import-frontmatter.data, operation ...` docblock directly above it in `src/nodejs` and `src/php`. The generated table other plugins carry lists core contracts only (spec/GAPS.md, 2a), so this section is written by hand.

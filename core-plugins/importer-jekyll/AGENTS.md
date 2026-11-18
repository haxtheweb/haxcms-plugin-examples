# AGENTS.md (importer-jekyll)

## Purpose
A Jekyll site (a GitHub repository or a zip of one) to JSON Outline Schema items via import.platform, by reading its
pages, posts, collections, front matter and _config.yml as data.

## Rules
- Run nothing from the site: no Liquid rendering, no layouts, no includes, no Ruby plugins. Liquid is read by
  scanning for {% %} and {{ }}; never evaluate a condition or a loop.
- Never fetch, open a zip or parse front matter here. The site's files come from
  `ctx.contracts.call("import-source.tree", "list" | "read", ...)`, front matter and configuration from
  `ctx.contracts.call("import-frontmatter.data", "split" | "parse", ...)`, markdown from import.file. All three
  plugins are dependencies.
- Front matter values are strings (`"true"`, `"2"`): compare and parse them as text.
- Never drop content silently: a Liquid tag or value that is not converted is counted in stats.unmapped.
- Leave fenced code alone in the kramdown pass. Liquid inside code is read as Jekyll reads it; {% raw %} keeps text.
- Node and PHP must return identical results. Sort with byText (byte order), lower-case with ASCII rules only, and
  keep maps keyed by paths out of plain JS objects. PHP must not contain a literal backtick (use \x60 or FENCE).
- Fixtures are synthetic: never commit a real site's content.

## Build, test, validate
`node scripts/validate.mjs core-plugins/importer-jekyll`; `node harness/run-cases.mjs core-plugins/importer-jekyll`;
`node harness/check/run.mjs core-plugins/importer-jekyll`; `node scripts/plugin-docs.mjs core-plugins/importer-jekyll --check`.
The zips in tests/cases/jekyll.yaml are written inline as base64; the header of that file lists what each holds.

## Diagnose
- "no Jekyll site found": there is no `_config.yml`. A zip of only the `_posts` folder is the usual cause.
- "no pages found": every candidate is excluded, has a name starting with `_` or `.`, or is HTML without front matter.
- A page is missing: its name starts with `_`, `.` or `#`, it sits in an excluded folder or `_drafts`, or it is
  `README`/`LICENSE`/`CHANGELOG` without front matter.
- A page sits at the top instead of under its parent: its `parent` names a title no page has (titles must match
  exactly), or the chain loops.
- Posts are missing: the file name lacks the `YYYY-MM-DD-` date, or the post sits under a folder starting with `_`.
- A link stayed as written: it points at an address Jekyll makes from a layout (a tag page, a paginated list), or the
  site's `permalink` uses a placeholder this importer does not fill (`:week`, `:y_day`, `:short_day`).
- "no active implementer of ...": import-source, import-frontmatter or import-markdown is not enabled.

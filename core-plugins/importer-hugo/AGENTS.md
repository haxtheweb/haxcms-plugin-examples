# AGENTS.md (importer-hugo)

## Purpose
A Hugo site (a GitHub repository or a zip of one) to JSON Outline Schema items via import.platform, by reading its
content tree, front matter and configuration as data.

## Rules
- Run nothing from the site: no Go templates, no theme, no shortcode templates.
- Never fetch, open a zip or parse front matter here. The site's files come from
  `ctx.contracts.call("import-source.tree", "list" | "read", ...)`, front matter and configuration from
  `ctx.contracts.call("import-frontmatter.data", "split" | "parse", ...)`, markdown from import.file. All three
  plugins are dependencies.
- Front matter values are strings (`"true"`, `"10"`): compare and parse them as text.
- Never drop content silently: a shortcode that is not converted is counted in stats.unmapped, and so is content in a
  format that is not read.
- Leave fenced code alone: shortcode examples inside ``` blocks are content.
- Node and PHP must return identical results. Sort names with byText (byte order; PHP compares digit-only strings as
  numbers otherwise), lower-case with ASCII rules only, and keep maps keyed by paths out of plain JS objects.
- Fixtures are synthetic: never commit a real site's content.

## Build, test, validate
`node scripts/validate.mjs core-plugins/importer-hugo`; `node harness/run-cases.mjs core-plugins/importer-hugo`;
`node harness/check/run.mjs core-plugins/importer-hugo`; `node scripts/plugin-docs.mjs core-plugins/importer-hugo --check`.
The zips in tests/cases/hugo.yaml are written inline as base64; the header of that file lists what each holds.

## Diagnose
- "no Hugo site found": there is no `hugo.*` file, and no `config.*` beside `content/`, `layouts/`, `themes/` or
  `archetypes/`. A zip of only the content folder is the usual cause; zip the whole site.
- "no pages found under <folder>": the configuration names a `contentDir` that holds no `.md`, `.markdown` or `.html`.
- The wrong site was picked in a repository with several: the shallowest wins, then `hugo.*` over `config.*`.
- A page is missing: it sits inside a page bundle (a folder with `index.md`), so Hugo treats it as a resource.
- A page has no title or date: its front matter was not read (`format: none` from import-frontmatter; see that
  plugin's AGENTS.md).
- The wrong language imported: set `defaultContentLanguage` in the site configuration.
- An image stayed as written: the file is not beside the page or under `static/` or `assets/`, or has an extension
  outside the importable list.
- "no active implementer of ...": import-source, import-frontmatter or import-markdown is not enabled.

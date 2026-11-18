# AGENTS.md (importer-grav)

## Purpose
A Grav site (a GitHub repository or a zip of one) to JSON Outline Schema items via import.platform, by reading its
pages folder as data: one page per folder.

## Rules
- Run nothing from the site: no PHP, no Twig, no plugin code. Read YAML with the subset reader here, never eval.
- Never fetch or open a zip here: the site's files come from `ctx.contracts.call("import-source.tree", "list" | "read", ...)`;
  import-source is a dependency and the only plugin that reaches GitHub. Markdown goes to import.file.
- Never drop content silently: what is removed and not converted (Twig, shortcode tags) is counted in stats.unmapped.
- Leave fenced code alone: Twig and shortcode examples inside ``` blocks are content.
- Node and PHP must return identical results. Sort names with byText (byte order; PHP compares digit-only strings as
  numbers otherwise), and keep maps keyed by paths out of plain JS objects (use Map and Set).
- Fixtures are synthetic: never commit a real site's content.

## Build, test, validate
`node scripts/validate.mjs core-plugins/importer-grav`; `node harness/run-cases.mjs core-plugins/importer-grav`;
`node harness/check/run.mjs core-plugins/importer-grav`; `node scripts/plugin-docs.mjs core-plugins/importer-grav --check`.
The zips in tests/cases/grav.yaml are written inline as base64; the header of that file lists what each holds.

## Diagnose
- "no Grav pages found": the repository or zip has no `user/pages/`, no `pages/`, and no numbered folders at its
  top. A zip of the wrong folder (one level too high or too low) is the usual cause.
- A page is missing: its folder sits under a module folder (`_name`), or it has no `.md` file.
- A page imports hidden: its folder has no numeric prefix and its header does not say `visible: true`.
- The wrong language imported: set `languages.supported` in `user/config/system.yaml`, first language first.
- An image stayed as written: the file is not in the repository or zip, is behind a `theme://` stream, or has an
  extension outside the importable list.
- Twig shows in a page: the page does not set `process: twig: true` (and the site does not), so it was treated as text.
- "no active implementer of import-source.tree" or "markdown could not be converted": import-source or
  import-markdown is not enabled.

# AGENTS.md (importer-astro)

## Purpose
An Astro or Starlight site (a GitHub repository or a zip of one) to JSON Outline Schema items via import.platform, by
reading its pages, collections, front matter and astro.config.* as data.

## Rules
- Run nothing from the site: no Astro, no components, no expressions, no Vite. astro.config.* is read with the literal
  reader (keyPosition, literalValue, parseJsLiteral): plain data only; anything else is counted as config:sidebar.
- JSX in MDX and .astro is read by scanning (jsx(), braceEnd(), jsxTagEnd()); never evaluate it.
- Never fetch, open a zip or parse front matter here. The site's files come from
  `ctx.contracts.call("import-source.tree", "list" | "read", ...)`, front matter from
  `ctx.contracts.call("import-frontmatter.data", "split", ...)`, markdown from import.file.
- Wrappers (stop-note) are html parts and the text inside them is converted on its own; never pass a wrapper tag
  through markdown, or it comes back inside <p>.
- Never drop content silently: a component, expression, directive or export that is not converted is counted.
- Node and PHP must return identical results. In PHP, parseJsLiteral returns stdClass for objects: read entries with
  is_object() and ->prop. Sort with byText. PHP must not contain a literal backtick (use \x60).
- Fixtures are synthetic: never commit a real site's content.

## Build, test, validate
`node scripts/validate.mjs core-plugins/importer-astro`; `node harness/run-cases.mjs core-plugins/importer-astro`;
`node harness/check/run.mjs core-plugins/importer-astro`; `node scripts/plugin-docs.mjs core-plugins/importer-astro --check`.
The zips in tests/cases/astro.yaml are written inline as base64; the header of that file lists what each holds.

## Diagnose
- "no Astro site found": there is no astro.config.*. A zip of only `src/` is the usual cause.
- A Starlight site imported as a plain Astro site (`stats.starlight: false`): the config does not mention Starlight,
  or `src/content/docs/` holds no .md or .mdx.
- The Starlight outline is the folder tree, not the sidebar: `stats.unmapped["config:sidebar"]` says the sidebar is
  built from code (a variable, a spread, a function); write it as plain data, or accept the folder order.
- A page sits at the end and out of the menu: the sidebar does not list it, or names it by a slug that does not match
  its file (slugs are lower case).
- An .astro page is nearly empty: its content comes from components or expressions, which are not run.
- An image stayed as written: it is imported through an alias (`~/…`, `@/…`), or lives outside `public/` and is not
  beside the page.
- "no active implementer of ...": import-source, import-frontmatter or import-markdown is not enabled.

# AGENTS.md (import-source)

## Purpose
List and read the files of a site from a GitHub repository URL or an uploaded zip of the same folder, for site
importers, through the contract this plugin defines and implements (import-source.tree: list, read).

## Rules
- Return a result or { error }; never throw out of list or read.
- Fetch only api.github.com (repository and file tree) and raw.githubusercontent.com (files), through ctx.fetch. A zip
  upload fetches nothing. Never follow a URL found inside a file.
- Read zips only with ctx.archive.read; core owns the limits. Never write to disk.
- Nothing here knows a generator: no config names, no markdown, no outline. That belongs to the importer.
- Node and PHP must return identical results: files is a list of { path, data }, never a map (PHP cannot tell an
  empty map from an empty list, and turns numeric path keys into list indexes).
- A change to the input or output shape is a change to config/contracts.yaml and to every importer that depends on
  this plugin (search for `import-source.tree`).

## Build, test, validate
`node scripts/validate.mjs core-plugins/import-source`; `node harness/run-cases.mjs core-plugins/import-source`;
`node harness/run-cases.mjs core-plugins/importer-vitepress` (the first importer on it);
`node scripts/plugin-docs.mjs core-plugins/import-source --check`. Fixtures are synthetic zips written inline.

## Diagnose
- "url must be a GitHub repository": the URL is not on github.com, or points at a file instead of the repository.
- "unable to read the file tree of <repo> (HTTP 404)": the branch in the URL does not exist, or the repository is
  private. "(HTTP 403)": GitHub's rate limit for requests without a token.
- A zip lists paths with one folder too many: the archive holds more than one top-level entry, so no folder is removed;
  zip the folder's contents, or use GitHub's "Download ZIP".
- `data` is null for a file that `list` showed: `read` was given a different `match` or no `prefix`.

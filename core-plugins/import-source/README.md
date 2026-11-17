# Import source (repository or zip) (core, hidden)

The one place site importers read "a site's files" from. A person either gives a GitHub repository URL or uploads a zip of the same folder; an importer for a static site generator (VitePress today; Grav, Hugo, Jekyll and Astro in https://github.com/haxtheweb/issues/issues/3364) should not care which. This plugin defines and implements the contract `import-source.tree`; an importer lists `import-source` in `dependencies` and calls it through the platform.

**Why a plugin and not code inside each importer:** `importer-vitepress`, `importer-quarto` and `importer-notion` each carried the same GitHub reader, and the first two the same zip reader. With it here, an importer holds only what is particular to its generator (config, outline, content dialect), needs no `network:egress` capability, and gets zip upload for free. Only this plugin may reach `api.github.com` and `raw.githubusercontent.com`.

## The contract

`ctx.contracts.call("import-source.tree", "list", input)`

- Input: `{ url }` (`https://github.com/<owner>/<repo>`, optionally `/tree/<branch>`), or `{ files: [{ name, data (base64 zip) }], match? }`. `match` is a regular expression on the archive's own paths; only matching entries are opened (and listed).
- Output: `{ kind: github | archive, name, repo, branch, prefix, rawBase, paths }` or `{ error }`.
  - `paths`: every file, relative to the site's root. A repository's are in tree order; a zip's are sorted.
  - `prefix`: the single top folder a GitHub download wraps everything in (`<repo>-<branch>/`), already removed from `paths`; `""` when there is none. Hand it back to `read`.
  - `rawBase`: where a repository file can be fetched from (`<rawBase>/<path>`), for an importer to list media as `files: [{ path, url }]`. `null` for a zip.
  - `repo` (`<owner>/<repo>`) and `branch` are `null` for a zip. `name` is the repository's name or the upload's name without `.zip`.

`ctx.contracts.call("import-source.tree", "read", input)`

- Input: `{ repo, branch, paths }` for a repository, or `{ files, prefix, match?, paths, binary? }` for a zip (the same `files` and `match` given to `list`).
- Output: `{ files: [{ path, data }] }` or `{ error }`: each path once, in the order asked. `data` is the file's text, or `null` when it is not there. From a zip, CRLF line ends become LF, and `binary: true` returns base64 of the bytes instead (for media an importer returns as `files: [{ path, data }]`).

Ask for everything a step needs in one `read`: a zip is opened once per call.

## Limits

- GitHub only for repositories (other forges are not read); a branch name with a `/` cannot be given in the URL.
- A zip is read under core's `ctx.archive.read` limits (5000 entries, 100 MB expanded). The platform has no way to list an archive without opening its entries, so `list` without `match` opens all of them; pass `match` when media is not needed yet.
- `binary` reads are for zips. A repository's media is listed by URL for core to fetch.

## What it implements

Contract `import-source.tree`, operations `list` and `read`, which it also defines (`config/contracts.yaml`). Each has an `Implements contract import-source.tree, operation ...` docblock directly above it in `src/nodejs` and `src/php`. The generated table other plugins carry lists core contracts only (spec/GAPS.md, 2a), so this section is written by hand.

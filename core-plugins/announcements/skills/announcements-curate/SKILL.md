---
name: announcements-curate
description: "Add, edit or retire What's New entries and HAX tips in the announcements plugin's data before a release. Use when preparing release notes for HAXcms, adding a tip, or fixing announcements data. Ships with the plugin package; never published to sites."
version: 0.1.0
license: Apache-2.0
metadata:
  author: haxtheweb
  plugin: announcements
  audience: developer
  tags: [hax, haxcms, announcements, release, curation]
---

# Curating announcements

Data lives in the plugin's `data/` folder (package stores, read-only at runtime):

- `data/types.json`: the six types (`idea`, `feature`, `block`, `theme`, `template`, `improvement`). Rarely changes.
- `data/announcements.json`: entries.
- `data/locales/<lang>.json`: `{ "<uuid>": { label, description, alt } }` translations; English is the source.
- `data/visuals/`: screenshot files referenced by `visual.file`.

## Add an entry

1. Collect candidates: merged PRs and closed issues since the last release (the unified tracker is https://github.com/haxtheweb/issues), plus entries already `ready`.
2. For each, write: a new `uuid` (generate once, never regenerate), a `slug`, `kind` (`update` or `tip`), `type` (a type **uuid**), `version` = the release being cut (updates only), `label` (no "New" prefix), a one-line `description`, `links`.
3. Visual: a new element gets `{ "mode": "element", "tag": "<tag>" }` (the dialog renders its first demo schema item); an admin surface gets `{ "mode": "screenshot", "file": "<name>.svg|png", "alt": "<required>" }` with the file in `data/visuals/`; otherwise none.
4. Set `status` to `draft` until it is approved, then `ready`. Only `ready` entries for released versions are served; `status` and `notes` are never served.
5. Validate: `hax plugin validate` from the plugin folder, then the plugin tests (`node --test tests/nodejs/announcements.test.mjs`, and the parity run that compares Node and PHP).
6. Open a PR. Never merge it yourself, and never run release or ubiquity commands.

## Tips

Add, retire (delete the entry) and check coverage by type. Tips have no `version`.

## Don't

- Don't advertise unreleased work: a future `version` is hidden until that version runs, but keep drafts as `draft` anyway.
- Don't put the HAXcms version anywhere else in the data.
- Don't change an existing `uuid`; translations and dismissal state depend on it.

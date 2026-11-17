# AGENTS.md (importer-drupal)

## Purpose
Drupal JSON:API (pages, books, files, media, menu links) to JSON Outline Schema items via import.platform.

## Rules
- Return { title, items, files } or { error }; never throw.
- Fetch only under the host the person gave; egress refuses any other host, including pagination links that point elsewhere. File URLs on other hosts may be listed in files (core fetches them), never read here.
- Keep Node and PHP output identical: Node uses Map for anything keyed by node id (a plain object would reorder numeric keys); PHP arrays keep insertion order. Helpers share names across runtimes.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/importer-drupal`.

## Diagnose
- "no Drupal JSON:API found": the JSON:API module is off, or anonymous users cannot read it.
- Everything lands under "additional pages": the menu links point at aliases (`internal:/about`) rather than `entity:node/<nid>`, or the site uses a menu-items module this plugin does not read yet.
- Missing images: the files are private, temporary, or have an extension core's bulk import refuses.

# AGENTS.md (importer-wordpress)

## Purpose
WXR to JSON Outline Schema items via import.platform.

## Rules
- Return { title, items, files? } or { error }; never throw.
- Parse with the same regular expressions in both runtimes.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/importer-wordpress`.

## Diagnose
- Missing pages: they were in the trash, or are a custom post type (only page and post are imported).

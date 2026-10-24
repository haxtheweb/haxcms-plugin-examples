# AGENTS.md (reading-time)

## Purpose
Word count and reading time per page.

## Rules
- Only the declared fields (words, minutes).

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/reading-time`.

## Diagnose
- No label: the page has not been saved since the plugin was enabled.

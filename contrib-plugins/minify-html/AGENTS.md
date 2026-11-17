# AGENTS.md (minify-html)

## Purpose
Smaller published pages.

## Rules
- Stage transform only, so seal and store see the minified bytes.
- Never touch script, style, pre or textarea contents.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/minify-html`.

## Diagnose
- Layout changed: whitespace between inline elements was meaningful; wrap it in a span or turn the plugin off for that site.

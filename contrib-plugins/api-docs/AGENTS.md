# AGENTS.md (api-docs)

## Purpose
Developer-facing combined API document.

## Rules
- Never add x-hax-proxy or settings values to the document.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/api-docs`.

## Diagnose
- A plugin's routes are missing: it is not active (check its unmet requirements).

# AGENTS.md (data-store example)

## Purpose
Shows the four store kinds, an upgrade step and personal-data flags.

## Layout
`config/datastores.yaml`, `config/entities.yaml`, `migrations/`, `src/nodejs`, `src/php`.

## Build, test, validate
`hax plugin validate` and `npm test` from the repo root.

## Diagnose
Upgrade failures while enabling turn the plugin off with the reason in `hax plugin log data-store`.

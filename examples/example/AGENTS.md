# AGENTS.md (example plugin)

## Purpose
A teaching fixture that exercises every hook and extension point in the spec. Not shipped functionality; keep it small and obviously fake.

## Layout
- `plugin.yaml`: manifest. `config/`: OpenAPI contract, data stores, entities, settings. `registries/`: themes, elements, skeletons, Merlin, appstore, locales. `frontend/dist/`: plain ES modules. `src/nodejs`, `src/php`: backend entries. `skills/`: one site skill, one developer skill. `docs/prompts.yaml`: copyable prompts for the plugin screen.

## Rules
- Tags must start with `awesome-`; skills must start with `example-`.
- Never add tracking, egress or secrets outside the settings form.
- When a hook or extension point is added to the spec, implement it here in both runtimes in the same change.

## Build, test, validate
- `hax plugin validate` (or `node scripts/validate.mjs examples/example`) and `npm test` from the repo root before finishing.

## Diagnose
- Status comes from `hax plugin status example [--site]`; recent entries from `hax plugin log example`.
- Inactive with `settings.greeting`: the requirements hook is waiting on that setting; `hax plugin config set example greeting <text>`.
- Warnings naming `ext.awesome`: a hook returned fields for a schema the plugin did not declare in `config/entities.yaml`.

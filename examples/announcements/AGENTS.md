# AGENTS.md (announcements)

## Purpose
What's New and HAX Tips for HAXcms. Core and required: always on, both runtimes, first plugin on the new architecture.

## Layout
`plugin.yaml`; `config/` (OpenAPI, entities, data stores); `data/` (types, entries, locales, visuals); `src/nodejs` and `src/php` (logic file plus entry, mirrored function for function); `frontend/dist` (dashboard button, dialog, state); `registries/` (elements, Merlin); `skills/`; `docs/prompts.yaml`; `tests/`.

## Rules
- Node and PHP must give identical results: change `announcements.js` and `Announcements.php` together and keep the parity run green.
- Every route requires both the JWT and the user token. Never add a public route; the responses carry the running version.
- Never serve `status`, `notes` or screenshot file names. Never serve drafts or versions newer than the running one.
- Element tags start with `announcements-`. Do not let anything open on its own in the dashboard.
- Entry uuids are permanent.

## Build, test, validate
- `hax plugin validate` (or `node scripts/validate.mjs examples/announcements` from the repo root).
- `node --test tests/nodejs/announcements.test.mjs` from this folder; `npm test` at the repo root also runs the Node/PHP parity check.

## Diagnose
- Enable vetoed with "points at an unknown type": an entry's `type` is not a uuid in `data/types.json`.
- Chip never appears: no `ready` update has a version at or below the running version, so `latestVersion` is null.
- Chip never goes away: the browser cannot store `whatsNew` (private mode); expected.
- 401 or "X-HAXCMS-User-Token header is required": the caller lacks one of the two credentials; this is correct behavior.

## Upgrade notes
- New entries ship with new plugin versions; `plugin.after.upgrade` drops the cache.

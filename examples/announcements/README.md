# announcements

What's New and HAX Tips: curated release highlights and evergreen tips, shown in the dashboard (a button with a "New" chip and a dialog), in Merlin, through the system API and the `hax` CLI. Plan: https://github.com/haxtheweb/issues/issues/3172.

**Core and required:** it ships with HAXcms and is always on, so it implements both runtimes and is the first real test of the plugin architecture (https://github.com/haxtheweb/issues/issues/3176).

| Piece | Where |
|---|---|
| Data (types, entries, translations, screenshots) as read-only package stores | `data/`, `config/datastores.yaml` |
| Entities `announcementType` and `announcement` (uuid keys) | `config/entities.yaml` |
| System-scope routes, all requiring JWT + user token | `config/openapi.yaml` |
| Logic: filters, `latestVersion`, tip of the day, translation, source-field stripping | `src/nodejs/announcements.js`, mirrored in `src/php/Announcements.php` |
| Route handlers and hooks | `src/nodejs/index.js`, `src/php/Plugin.php` |
| Dashboard button, "New" chip and dialog, declared as data and rendered by app-hax with its existing elements (no plugin front-end code) | `registries/dashboard/whats-new.yaml` |
| Merlin "What's new" and "HAX tips" (`api` programs, no JS) | `registries/merlin/` |
| Skills: ask what's new (system), curate entries (developer); prompts | `skills/`, `docs/prompts.yaml` |
| Tests: Node unit tests, a Node/PHP parity run, behavior cases | `tests/` |

## Behavior

- Only `ready` entries are served, and updates only when their `version` is not newer than the running HAXcms. `status` and `notes` never leave the server.
- `latestVersion` is the newest version with curated entries, so releases without entries never re-trigger the chip.
- The tip of the day is chosen by an FNV-1a hash of the UTC date (plus optional seed), identical in Node and PHP, so the web, CLI and agents agree.
- Dismissal is per browser: `{ seenVersion, dismissedVersion }` in user scaffold memory, kept by the dashboard for the contribution's badge. The chip shows until the latest version is dismissed. Nothing opens by itself.
- Screenshot files are served by the authenticated visual route; the file name is never exposed.

## Tests

From this folder: `node --test tests/nodejs/announcements.test.mjs`. The repository's `npm test` also runs `tests/nodejs/run-parity.mjs` and `tests/php/run-parity.php` over `tests/parity-calls.json` and fails if the two runtimes disagree.

## Differences from the plan

- No plugin elements: the button, chip and dialog are a dashboard contribution that app-hax renders with elements it already has (the plan proposed a new `hax-whats-new` element). Merlin rows open it with `hax-dashboard-open`.
- Data is JSON in package stores so both runtimes read it without a YAML dependency.
- The sample entries are for development only (`notes: SAMPLE ENTRY`); the curation skill replaces them.

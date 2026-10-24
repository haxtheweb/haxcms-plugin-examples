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
| CLI: `hax whats-new`, `hax tips`, `hax tip` (aliases of `hax announcements ...`) | `registries/cli/` |
| Skills: ask what's new (system), curate entries (developer); prompts | `skills/`, `docs/prompts.yaml` |
| Tests: Node unit tests, a Node/PHP parity run, behavior cases | `tests/` |

## Behavior

- Only `ready` entries are served, and updates only when their `version` is not newer than the running HAXcms. `status` and `notes` never leave the server.
- `latestVersion` is the newest version with curated entries, so releases without entries never re-trigger the chip.
- The tip of the day is chosen by an FNV-1a hash of the UTC date (plus optional seed), identical in Node and PHP, so the web, CLI and agents agree.
- Dismissal is per browser: `{ seenVersion, dismissedVersion }` in user scaffold memory, kept by the dashboard for the contribution's badge. The chip shows until the latest version is dismissed. Nothing opens by itself.
- Screenshot files are served by the authenticated visual route; the file name is never exposed.

## Separation: what disappears when it is disabled

Announcements is required, so it is never disabled in practice, but nothing in core refers to it. Every touchpoint is a generic extension point that asks enabled plugins what they provide:

| Surface | How announcements appears | Generic mechanism in core | When disabled |
|---|---|---|---|
| Backend routes | `/system/api/v1/plugins/announcements/*` | unified contract built from enabled plugins | 404; absent from the served OpenAPI |
| Entities | `announcementType`, `announcement` | entity registry | absent from the entity list |
| Dashboard | top-bar button, chip, modal | app-hax renders dashboard contributions from `GET /system/api/v1/plugins/contributions` with its own elements | not in the response, nothing rendered |
| Dashboard data calls | `@system/announcementsListLatest`, ... | app-hax registers operations from the contract | not registered |
| Merlin | "What's new", "HAX tips" | Merlin loads declarations of enabled plugins | options absent |
| CLI | `hax whats-new` (alias of `hax announcements whats-new`), `tips`, `tip` | CLI loads `registries/cli` of enabled plugins, aliases included | commands and aliases absent from help |
| Agents | system skill, prompts | agent-skills index and `register.*.prompts` built from enabled plugins | unpublished |
| Hooks | `plugin.before.enable`, `plugin.after.upgrade` | hook dispatcher | never run |
| Published sites | none | n/a | n/a |

Two spec conformance cases enforce this in each backend (`load-115`, `load-116`): disabling a plugin leaves no trace, and core source contains no plugin ids, operation ids or tags.

## Tests

From this folder: `node --test tests/nodejs/announcements.test.mjs`. The repository's `npm test` also runs `tests/nodejs/run-parity.mjs` and `tests/php/run-parity.php` over `tests/parity-calls.json` and fails if the two runtimes disagree.

## Differences from the plan

- No plugin elements: the button, chip and dialog are a dashboard contribution that app-hax renders with elements it already has (the plan proposed a new `hax-whats-new` element). Merlin rows open it with `hax-dashboard-open`.
- CLI commands are contributed by the plugin (`hax announcements whats-new`, `tips`, `tip`) with aliases `hax whats-new`, `hax tips` and `hax tip`; nothing is added to create's own command list.
- Dashboard calls use operations registered from the contract, not entries added to app-hax's alias list.
- Data is JSON in package stores so both runtimes read it without a YAML dependency.
- The sample entries are for development only (`notes: SAMPLE ENTRY`); the curation skill replaces them.

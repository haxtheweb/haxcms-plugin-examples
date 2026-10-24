# Related schemas the plugin spec reuses

The plugin contract does not invent formats that HAX already documents. Each of these repositories is the source of truth for its format; this repo pins them as dev dependencies (git commits, none are on npm yet) and validates plugin fixtures against them.

| Plugin surface | Existing schema | What the plugin spec takes from it |
|---|---|---|
| `registries/merlin/` | https://github.com/haxtheweb/merlin-schema | `option:` is a real MerlinOption; programs follow the program contract (7.2) |
| `registries/elements/` (blocks) | https://github.com/haxtheweb/hax-schema | block elements ship a `*.haxProperties.json` validated by `haxProperties.schema.json`; tag prefix and HAX rules still apply |
| `config/settings.schema.json` | https://github.com/haxtheweb/hax-schema | plugin settings are a `settings` object (`configure` / `advanced` / `developer` field lists) in the haxProperties field format (`property`, `title`, `inputMethod`, `options`, `required`). Fixtures validate against the `settings` definition |
| `registries/skeletons/` | https://github.com/haxtheweb/json-outline-schema | each skeleton validates against `skeleton.schema.json` |
| manifest store slot (`metadata.plugins.<id>`) | https://github.com/haxtheweb/json-outline-schema | `site.json` allows unknown keys inside `metadata.*` groups, so a plugin slot is compatible. Item-level plugin data must live inside the item's `metadata` (`metadata.plugins.<id>`) because HAXcms drops unknown top-level item keys on save |
| `demoSchema` / insertion payloads, announcement `element` visuals | https://github.com/haxtheweb/hax-element-schema | `{ tag, properties, content }`; the first `demoSchema` entry is what is inserted or previewed |
| theme registry entries | `schema/theme-registry-entry.schema.json` (draft, in this repo) | derived from the 34 entries in `coreConfig/themes.json`; adds a proposed `extends` for child themes. Candidate to move into a shared schemas repo |
| site / node settings forms | https://github.com/haxtheweb/hax-schema (field format) | `coreConfig/siteFields.json` and `nodeFields.json` already use the haxProperties field format with `tabs` / `properties` grouping, so plugin settings panels use the same format |

## Rules inherited from those repos
- Custom keys must start with `x-` in haxProperties, MerlinOption and HAXElementSchema; every other unknown key is an error. Plugin tools must not invent new keys inside them.
- Plugin fixtures run each repo's own validators in conformance (`merlin-validate --scan`, `haxproperties-validate`, `jos-validate`, `hax-element-validate`); wiring them as CLI steps is still to do.
- When one of those schemas changes, the pinned commit here is bumped in the same PR as any spec change it forces, with a `spec/CHANGELOG.md` entry.

## Conformance check against the live code (2026-10-23)

Run with `node scripts/check-core-config.mjs <coreConfig dir>` and each repo's validator.

| Check | Result |
|---|---|
| `themes.json` against the draft theme schema | 34 of 34 entries pass; registry key equals `element` in every entry |
| `siteFields.json`, `nodeFields.json` against the haxProperties field definition | pass |
| the 9 core skeletons against `skeleton.schema.json` | 9 of 9 pass, with warnings (string booleans `"1"`/`""` for `published`/`hideInMenu`, comma-separated `tags` strings, repeated sibling `order`, indent not matching depth) |
| every `*.haxProperties.json` in webcomponents against hax-schema | 92 of 97 pass. 5 fail: concept-quest-game, concept-map-game, concept-runner-game (camelCase `unsetAttributes`), lrndesign-sidenote (`options` not an object), radar-chart (`canPosition` unknown key). hax-schema's README says all 94 pass, so the repo and schema have drifted |
| haxcms-nodejs vs haxcms-php `coreConfig/*.json` and `entities.yaml` | byte-identical today |
| `languages.json`, `publishers.json`, `dynamicElementLoader.json`, `entities.yaml` | no schema exists |

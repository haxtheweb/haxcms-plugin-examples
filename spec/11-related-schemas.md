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
| theme registry entries | (no standalone schema found) | `coreConfig/themes.json` entries, currently documented only in code; candidate for a new schema |

## Rules inherited from those repos
- Custom keys must start with `x-` in haxProperties, MerlinOption and HAXElementSchema; every other unknown key is an error. Plugin tools must not invent new keys inside them.
- Plugin fixtures run each repo's own validators in conformance (`merlin-validate --scan`, `haxproperties-validate`, `jos-validate`, `hax-element-validate`); wiring them as CLI steps is still to do.
- When one of those schemas changes, the pinned commit here is bumped in the same PR as any spec change it forces, with a `spec/CHANGELOG.md` entry.

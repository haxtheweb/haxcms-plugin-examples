# Registries, settings and front-end assets

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Registries and forms

`registries/` holds declarative contributions to registries core already has. Each folder matches a registry; the loader merges them (registries become merge-aware: entries from every enabled provider in cascade order, with provenance, replacement by key, and fallback to the lower provider or core default).

| Folder | Feeds | Format |
|---|---|---|
| `themes/` | theme list (`coreConfig/themes.json` today) | one YAML or JSON file per theme, same fields |
| `skeletons/` | skeleton list | existing skeleton JSON |
| `elements/` | tag-to-file registry (`wc-registry.json`) | one file per tag; `role: block` (insertable, needs `haxProperties`) or `injected` (page singleton, none needed) |
| `locales/` | languages and message overlays | `en.yaml` with only changed keys, merged per key with fallback |
| `merlin/` | Merlin (super-daemon) options and programs | one YAML declaration per option; `kind: static\|api\|module` (7.2) |
| `editor/` | HAX editor entries (block-picker category, media source) | provisional; same data-plus-lazy-module pattern |
| `embeds/` | embed providers (video, oEmbed) | provisional |
| `forms/` | reserved: extensions to existing core forms; plugin settings default to their own panel (see 7.1) | additional fields |
| later | deploy targets, import platforms | same pattern |

### 7.1 Plugin settings
- A plugin's settings are a HAXSchema form (`config/settings.schema.json`) shown as its own panel in the admin area at **admin/plugins/`<id>`/settings**, at system level and, where the plugin is site-scoped, at site level.
- Save/read routes follow the same shape: `/system/api/v1/plugins/<id>/settings` and `/x/api/v1/plugins/<id>/settings` (site). Both require authentication; fields flagged secret are never returned.
- When a setting moves out of core into a plugin, it leaves the core form and appears only in that plugin's panel. Plugin settings are stored outside `site.json` by default (the `site` data store, 4.2), which keeps the manifest from growing further. The `manifest` store stays available for data that must travel inside `site.json`.
- Legacy: a plugin may read and interpret an old core location (such as `metadata.site.settings.gaID`) as a fallback, with a one-time `upgrade` step to move it.
- Admin menu structure is not final; this area will be informed by the API structure and revised.

### 7.2 Merlin options and programs

The Merlin contract is documented in https://github.com/haxtheweb/merlin-schema (option schema, program schema, rules for tools registering commands). Plugins do not invent their own shape: a declaration in `registries/merlin/*.yaml` wraps a real MerlinOption (`option:`) and is validated against that repository's `merlin-option.schema.json` (`schema/merlin-declaration.schema.json` here adds the plugin-side wrapper).

- Only options expressible as data are declarable: `super-daemon-run-program`, `hax-super-daemon-insert-tag`, `execute-keyboard-shortcut`, `disabled`, or a custom event name with JSON detail. Options that need live references (`super-daemon-element-method` / `-click` targets) are registered from a plugin module, not declared.
- For `super-daemon-run-program`, `option.value.program` is omitted and a `program:` block says how the host builds it, so the option is listed without loading plugin JavaScript:
  - `kind: static`: `results` are listed MerlinOption rows.
  - `kind: api`: an `operation` from the plugin's own contract, a `map` from response fields to row fields, and a `row` template for the fixed parts (eventName, value shape).
  - `kind: module`: a `module` under `frontend/dist` and a `factory` export. The host registers the usual lazy `import()` of a `createXProgram(context)` factory, exactly the pattern the existing programs use (`async (input, values) => MerlinOption[]`). The context carries an authenticated call helper for the plugin's operations and translation helpers.
- `machineName` and `name` are required on programs so they can be launched by machine name. Context arrays, `inline`/`inlineOnly`, `hidden`, `voice` and `shortcut` follow the merlin-schema rules.
- Conformance: module files must pass `merlin-validate --scan` from merlin-schema.

## Front-end assets

### 8.1 What exists today (verified in code)
Sites load `./custom/build/custom.es6.js` as a module with an import map scope mapping `@haxtheweb/`. A `metadata.theme.path` not starting with `@` is loaded and preloaded verbatim as a site-relative URL. `wc-registry.json` maps tag to path, and `dynamic-import-registry` always imports `${basePath}${path}` (the one place a verbatim path is needed); `WCAutoloadRegistryFile` already accepts an array. The backend generates the page shell, the registry and preload hints.

### 8.2 Methodology
1. **The asset manifest is the only way a plugin file becomes web-reachable.** `hax plugin build` records every file under `frontend/dist/` with hash, size and content type. The asset id is the path under `frontend/dist/` (so `assets/authImage.png` works). Only an extension allowlist is served; never `src/`, `config/` or `data/`; `nosniff`; dotfiles, traversal and symlink escapes are rejected; a hash mismatch refuses the asset.
2. **Live delivery.** `GET /x/api/v1/plugins/<id>/assets/<assetId>` is the only unauthenticated route reserved for static files; every other plugin route is secured unless it declares `x-hax-public: true` itself. Admin-only assets use the system namespace. The URL carries a content hash, never the HAXcms version. A disabled plugin's assets 404.
3. **Caching.** The asset index is built once at load and held in memory (Node). In PHP the existing file-based `Cache` class (`_config/cache/`, with `_config/tmp/` as temp) holds discovery and the asset index; APCu is optional. Responses carry `ETag`, immutable `Cache-Control` for hashed URLs, `304`, build-time brotli and gzip, and a per-plugin size cap enforced by `validate`. The route is rate limited and CDN friendly.
4. **Static delivery.** Only when output calls for them, assets of each plugin enabled for the site and actually used (its theme, elements present in its content) are copied to `files/haxcms-managed/plugins/<id>/` with a `registry.json`; the generated shell then uses site-relative URLs, adds the registry to the `WCAutoloadRegistryFile` array, and adds an import map scope. The site records `metadata.plugins: [{id, version, assetsHash}]`. Remix and export still render because the code travels with the site.
5. **Redistribution.** A restricted asset (a theme with an embedded mark) is copied into the owner's own published site but is never included in a remix or export for others. Content can still be imported from such a site; the receiving site falls back to a default theme with a warning.
6. **Namespacing.** Every plugin declares a `tagPrefix` and may define only tags with that prefix. Core plugins keep legacy tags through the reserved `legacy` block. Browser scoped custom element registries (shipping in Chrome and Edge 146, Safari 26 listing support, Firefox in technology preview, per https://developer.chrome.com/blog/scoped-registries) scope definitions to shadow roots, whereas HAX content uses page-level tags, so the prefix rule stays and scoped registries are a later evaluation.
7. **Editing.** Blocks authors can insert must ship `haxProperties`. Injected singletons (a paywall scrim) need none and arrive through `output.alterPage`.
8. **Trust.** Front-end plugin code runs in every visitor's browser. HAXiam production allows it only from admin-installed tiers. Assets are same-origin with no inline script, so a CSP stays enforceable.
9. **Small platform changes this implies:** the shell generator emits the extra registry file and import map scope; `dynamic-import-registry` accepts a verbatim path; theme and element registries merge plugin entries; the publish-time copy step.

### Authoring

Plugins ship plain ES modules resolved through import maps, the same way custom elements work in sites today. A compile/optimize step (hash, minify, asset manifest) runs as part of `hax plugin build` when preparing to ship; there is no required build step during development.

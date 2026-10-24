# Registries, settings and front-end assets

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Registries and forms

`registries/` holds declarative contributions to registries core already has. Each folder matches a registry; the loader merges them (registries become merge-aware: entries from every enabled provider in cascade order, with provenance, replacement by key, and fallback to the lower provider or core default).

| Folder | Feeds | Format |
|---|---|---|
| `themes/` | theme list (`coreConfig/themes.json` today) | one YAML or JSON file per theme, same fields |
| `skeletons/` | skeleton list | existing skeleton JSON |
| `elements/` | tag-to-file registry (`wc-registry.json`) | one file per tag; `role: block` (insertable, needs `haxProperties`) or `injected` (page singleton, none needed) |
| `locales/` | languages and message overlays | `en.yaml` with only changed keys, merged per key with fallback; when two plugins set the same key, hook priority then the cascade decides, with an overwrite warning |
| `merlin/` | Merlin (super-daemon) options and programs | one YAML declaration per option; `kind: static\|api\|module` (7.2) |
| `appstore/` | the HAX editor appstore (media providers, upload targets, reusable stax, autoloaded blocks) | JSON fragments of the appstore payload, validated by https://github.com/haxtheweb/appstore-spec (7.4) |
| `forms/` | reserved: extensions to existing core forms; plugin settings default to their own panel (see 7.1) | additional fields |
| later | deploy targets, import platforms | same pattern |

### 7.1 Plugin settings
- A plugin's settings are a HAXSchema form (`config/settings.schema.json`) shown as its own panel in the admin area at **admin/plugins/`<id>`/settings**, at system level and, where the plugin is site-scoped, at site level.
- Save/read routes follow the same shape: `/system/api/v1/plugins/<id>/settings` and `/x/api/v1/plugins/<id>/settings` (site). Both require authentication; fields flagged secret are never returned.
- When a setting moves out of core into a plugin, it leaves the core form and appears only in that plugin's panel. Plugin settings are stored outside `site.json` by default (the `site` data store, 4.2), which keeps the manifest from growing further. The `manifest` store stays available for data that must travel inside `site.json`.
- Settings are saved as part of the plugin's configuration (CMI). When a setting moves from core into a plugin, it is removed from the global form; the plugin's install hook (spec/06) migrates the value from `site.json` the first time the plugin is enabled for a site.
- Legacy: a plugin may read and interpret an old core location (such as `metadata.site.settings.gaID`) as a fallback, with a one-time `upgrade` step to move it.
- Admin menu structure is not final; this area will be informed by the API structure and revised.

### 7.2 Merlin options and programs

The Merlin contract is documented in https://github.com/haxtheweb/merlin-schema (option schema, program schema, rules for tools registering commands). Plugins do not invent their own shape: a declaration in `registries/merlin/*.yaml` wraps a real MerlinOption (`option:`) and is validated against that repository's `merlin-option.schema.json` (`schema/merlin-declaration.schema.json` here adds the plugin-side wrapper).

- Only options expressible as data are declarable: `super-daemon-run-program`, `hax-super-daemon-insert-tag`, `execute-keyboard-shortcut`, `disabled`, or a custom event name with JSON detail. Options that need live references (`super-daemon-element-method` / `-click` targets) are registered from a plugin module, not declared.
- For `super-daemon-run-program`, `option.value.program` is omitted and a `program:` block says how the host builds it, so the option is listed without loading plugin JavaScript:
  - `kind: static`: `results` are listed MerlinOption rows.
  - `kind: api`: an `operation` from the plugin's own contract, a `query` (`{{input}}` is the search text; the host handles the debounce), an `items` dot path to the array in the response, and a `row` template read per item (`{{path}}` reads that item's fields): title, description, icon, tags, path, eventName and value. Rows bypass `defineOption`, so the host sets any `shortcutLabel`. Logic beyond templates belongs in a `module` program.
  - Declarations stay. The same options can also be registered from frontend code, which is how a plugin does it today when the options do not come from an endpoint; a plugin-served listing of options is expected later.
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
7. **Editing.** Blocks authors can insert must ship `haxProperties`. Injected singletons (a paywall scrim) need none and arrive through `render.after.body`.
8. **Trust.** Front-end plugin code runs in every visitor's browser. HAXiam production allows it only from admin-installed tiers. Assets are same-origin with no inline script, so a CSP stays enforceable.
9. **Small platform changes this implies:** the shell generator emits the extra registry file and import map scope; `dynamic-import-registry` accepts a verbatim path; theme and element registries merge plugin entries; the publish-time copy step.

### Authoring

Plugins ship plain ES modules resolved through import maps, the same way custom elements work in sites today. A compile/optimize step (hash, minify, asset manifest) runs as part of `hax plugin build` when preparing to ship; there is no required build step during development.

### 7.3 Core settings that may move into plugins later
From `coreConfig/siteFields.json` (the site settings form). Not part of this work; recorded so the extension points are designed against real cases.

| Setting(s) today | Candidate plugin | Note |
|---|---|---|
| `gaID` (Google Analytics ID) | `google-analytics` | first real case; depends on cookie-consent |
| `sw` (service worker), `forceUpgrade` | PWA / offline | optional behavior with a policy side |
| author contact and social links (`phone`, `location`, `website2`, `socialLink`, `socialLink2`) | author profile / social | keep name, email, image, license in core |
| theme banner, palette, accent, icon (`theme.variables.*`) | each theme's own settings | belongs to the theme plugin that defines them |
| `regions` | `regions` plugin with its own storage type | today a hack attached to the site outline. As a plugin it owns region storage; themes keep rendering them through the `site-region` tag, without the current back-association |
| appstore apps in core (YouTube, NASA image search and others) | one plugin per provider | peeled off into integration plugins, each with its own settings |
| advanced SEO, AI/LLM optimization tuning | SEO / AI optimization plugin | baseline SEO, social cards, sitemap and llms.txt stay in core |
| `lang` | stays core | drives `<html lang>`; translations tooling could be a plugin |
| `private`, `canonical`, `pathauto`, `publishPagesOn` | stay core | baseline platform behavior |

### 7.4 Appstore contributions
HAX already has a format for what a plugin wants to add to the editor: the appstore payload (https://github.com/haxtheweb/appstore-spec), returned by each backend's `generateAppStore` and read by `HaxStore._loadAppStoreData`. Plugins contribute fragments in `registries/appstore/*.json`; the backend merges the fragments of every enabled plugin into the payload it already serves.

- `apps`: media providers and upload targets (an embed provider is an app). Secrets are not shipped or stored in the appstore payload: they live with the plugin, tucked away in its configuration (CMI), and requests that need a key are brokered by the plugin's own route (`connection.url` points at it) so the browser never sees the key. The appstore spec is expected to move away from `{{NAME}}` placeholders in this direction.
- `stax`: reusable content stacks.
- `autoloader`: block availability. A `role: block` entry in `registries/elements/` generates its autoloader entry automatically (`tag -> { import, haxProperties }`), so a plugin does not repeat itself. Platform filtering still applies: HAXcms filters the autoloader by `settings/enabledBlocks.json` when that file exists, and the `onlineMedia` platform setting hides apps without an `add` operation.
- Merge order is the same cascade as plugin loading: core system plugins first, then outward through the tiers. Built-in providers such as YouTube and NASA image search are expected to become plugins themselves.
- Top-level keys only (`status`, `apps`, `stax`, `autoloader`); a payload wrapped in `data` is ignored by HAX, and the validator rejects it.

## Skills

Plugins ship agent skills in the agentskills.io `SKILL.md` format the site boilerplate already uses (`.well-known/agent-skills/index.json`, discovery schema 0.2.0), one folder per skill under `skills/<name>/`, declared in the manifest with an audience:

- `audience: site`: helps an agent working on a site that has the plugin enabled (authoring with the plugin's elements, using its content types). When the plugin is enabled for a site, the site rebuild adds the skill to that site's `.well-known/agent-skills/` with a sha256 digest, next to the boilerplate skills, and removes it on disable. Only `.md`, `.json` and `.txt` files, matching the existing copy rules.
- `audience: system`: published in the system's front-end `.well-known/agent-skills` so agents can discover what the deployment offers (for example an MCP plugin describing how to connect). Same file rules as site skills.
- `audience: developer`: helps someone working on the plugin or the system (structure, `hax plugin add`, validation, upgrading). Read straight from the installed plugin package by `create` and coding agents; not copied into the system layer and never published.

Rules the validator enforces: the name starts with the plugin id and a dash (one namespace per plugin), the frontmatter `name` equals the folder, a `description` is present, no machine-specific paths, and undeclared skill folders warn. The example ships one of each.

## AGENTS.md

Every plugin ships an `AGENTS.md`, required by the audit like the README. Plugins are expected to be written and maintained mostly by agents, so it carries everything an agent needs to understand, extend and diagnose the plugin. Recommended sections: Purpose, Layout, Rules, Build/test/validate, Diagnose (what log entries and statuses mean and the commands that fix them), Upgrade notes.

## Plugin screen

Skills are for agents and docs for people. The plugin's screen in the dashboard shows the README, links to view each skill, and the plugin's **prompts** (`docs.prompts`, `schema/prompts.schema.json`): copyable prompts a person can paste into a web or local agent. `diagnose` prompts appear next to the health chip and are filled with the plugin's status, unmet requirements and recent log entries (secrets never included). Prompts are collected through the `register.before.prompts` hook, whose subject starts as the list in `docs/prompts.yaml`; a plugin can add prompts for its current state. The optional core MCP plugin (not required, enabled when wanted) fires the same hook and offers each prompt through MCP's prompts feature unless the prompt sets `mcp: false`, alongside the operations that opted in with `x-hax-mcp: true` (spec/05).

Upgrades rely on one generic upgrade skill and prompt from the spec package (the planned `hax-plugin-upgrade`); a plugin may add its own `kind: upgrade` prompts and Upgrade notes in AGENTS.md for anything specific.

## Tests

Plugins are expected to be generated by agents through the CLI (`hax plugin create` and `add` write test stubs alongside code) and filled in with tests. A plugin ships `tests/cases/*.yaml` (`schema/test-case.schema.json`, the same shape as the spec's conformance cases, optionally naming the `hook` or `operation` under test and the runtimes) plus runtime tests under `tests/nodejs` and `tests/php`. The audit requires tests unless the manifest says `untested: true`, which is shown as the derived tag `untested` on the plugin screen and in listings. Packs with no code are exempt.

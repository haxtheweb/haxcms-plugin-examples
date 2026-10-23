# Plugin anatomy and manifest

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Anatomy of one plugin

The folder name is the plugin id (kebab-case) and must be unique within a tier. The entire plugin exists once per runtime: `src/nodejs` is the whole plugin in Node, `src/php` the whole plugin in PHP. Everything shared and declarative sits outside `src/`, so a port to another language only adds a `src/<runtime>` folder.

```
<id>/
  plugin.yaml            manifest (YAML)
  README.md  AGENTS.md  CHANGELOG.md
  config/
    openapi.yaml         this plugin's operations (paths relative to /v1/plugins/<id>/)
    entities.yaml        entities, extensions and annotations
    contracts.yaml       provider contracts this plugin defines
    datastores.yaml      data stores (4.2)
    settings.schema.json HAXSchema settings form (JSON)
    defaults.yaml        default settings
    admin.yaml           dashboard panel and menu entry
  registries/            declarative contributions to core registries (see 7)
    themes/  skeletons/  elements/  locales/  forms/  (later: deploy-targets/, import-platforms/)
  data/                  read-only shipped data
  frontend/dist/         built front-end assets (only web-eligible folder, and only if listed under assets)
  migrations/            versioned upgrade steps (4.3)
  src/
    nodejs/  index.js  lib/
    php/     Plugin.php  lib/
  tests/                 nodejs/  php/  fixtures/
```

### 2.1 Manifest keys

Unknown keys are rejected. Keys marked reserved are validated and documented but have no behavior yet.

| Key | Meaning |
|---|---|
| `specVersion` | version of this spec the plugin targets; the loader refuses a newer one |
| `id`, `uuid`, `title`, `description`, `version` | identity; `version` is semver, distributed like an npm package |
| `kind` | `plugin` or `pack` (declarative-only, no backend code; safe at any tier) |
| `group` | dashboard grouping |
| `requires.haxcms` | compatible platform range (runtime versions are implied by this; no runtime-specific keys) |
| `dependencies` | plugin ids, optionally with a range (`id@>=0.0.0`); a bare id means any version |
| `suggests` | soft dependencies: works better with these |
| `testDependencies` | only for running the plugin's tests |
| `core` | shipped with the platform |
| `required` | core only: auto-enabled, cannot be disabled, cannot be supplanted |
| `defaultEnabled` | initial state when discovered (the example plugin: false) |
| `hidden` | not listed in the dashboard (helpers, test fixtures) |
| `lifecycle`, `lifecycleLink` | `stable` (default), `experimental`, `deprecated`, `obsolete`; deprecated and obsolete require a docs link. Dashboard badge and enable-time warning; obsolete is refused |
| `license`, `redistribution` | `allowed` or `restricted` default for the plugin's assets (see 8.4) |
| `runtimes` | `nodejs`, `php`; required core plugins list both |
| `entry` | per-runtime entry file |
| `openapi`, `entities`, `contracts`, `datastores`, `settings`, `admin` | pointers into `config/` |
| `implements` | provider contracts this plugin implements |
| `hooks` | hook subscriptions with optional `priority` (default 0) and entity filters |
| `registries` | generated summary of `registries/` (written by `hax plugin build`) |
| `assets` | generated list of web-reachable files with hash, size, type, optional `redistribution` per asset |
| `tagPrefix` | the only prefix the plugin's custom element tags may use |
| `staticCapable` | whether the plugin's behavior works without a backend |
| `egress` | outbound hosts the plugin may call |
| `capabilities` | permissions requested, shown at enable time (see 9.1) |
| `privacy` | `tracking`, categories, cookies set, hosts that receive data, `requiresConsent` categories |
| `managedFiles` | managed output paths the plugin owns |
| `schedules` | reserved: recurring jobs |
| `legacy` | reserved: aliases for extracted core routes, tags and registry paths |
| `packaged`, `integrity` | reserved: written by `hax plugin pack` (date, hash, signature reference) |

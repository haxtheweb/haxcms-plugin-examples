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
| `specVersion` | full semver of this spec the plugin targets; the loader refuses a newer major (pre-1.0: a newer minor) |
| `id`, `uuid` (required; generated once by the CLI), `title`, `description`, `version` | identity; `version` uses semver syntax with HAX's calendar scheme (year.month.release-in-month, for example `26.8.1`), distributed like an npm package |
| `kind` | `plugin` or `pack` (declarative-only, no backend code; safe at any tier) |
| `group` | dashboard grouping |
| `requires.haxcms` | compatible platform range (runtime versions are implied by this; no runtime-specific keys) |
| `dependencies` | plugin ids, optionally with a range (`id@>=0.0.0`); a bare id means any version |
| `suggests` | soft dependencies: works better with these |
| `testDependencies` | only for running the plugin's tests |
| `core` | shipped with the platform |
| `required` | core only: auto-enabled, cannot be disabled, cannot be supplanted |
| `category` | one category from `schema/categories.json` (`other` when none fits); required by the audit |
| `tags` | free-form author tags for filtering. **Derived tags** (`schema/derived-tags.json`: needs-server, runs-commands, sends-data-out, stores-secrets, injects-output, writes-files, reads-user-data, single-runtime, tracks-users, not-stable) are computed from the manifest and always shown, because they carry security or longevity implications; authors cannot set or hide them |
| `icon` | an iconset name or a path to an image in the plugin (see https://github.com/haxtheweb/issues/issues/3173); required by the audit |
| `screenshots` | optional images (`src`, `alt`) for the dashboard and registry |
| `docs` | `readme` (default `README.md`, required by the audit) and an optional `help` URL the dashboard links to |
| `skills` | agent skills under `skills/<name>/SKILL.md` with an `audience` (spec/07, Skills) |
| `defaultEnabled` | initial state when discovered (the example plugin: false) |
| `hidden` | not listed in the dashboard (helpers, test fixtures) |
| `lifecycle`, `lifecycleLink` | `stable` (default), `experimental`, `deprecated`, `obsolete`; deprecated and obsolete require a docs link. Dashboard badge and enable-time warning; obsolete is refused |
| `license`, `redistribution` | `allowed` or `restricted` default for the plugin's assets (see 8.4) |
| `runtimes` | `nodejs`, `php`. Core required plugins must list both. First-party contrib plugins should (the audit warns when they do not). Other plugins may list one, for example a HAXiam-specific plugin with no Node variation |
| `entry` | per-runtime entry file |
| `openapi`, `entities`, `contracts`, `datastores`, `settings`, `admin` | pointers into `config/` |
| `implements` | provider contracts this plugin implements |
| `hooks` | hook subscriptions with optional `priority` (default 0) and entity filters |
| `registries` | generated summary of `registries/` (written by `hax plugin build`) |
| `assets` | generated list of web-reachable files with hash, size, type, optional `redistribution` per asset |
| `tagPrefix` | the only prefix the plugin's custom element tags may use; one namespace per plugin, by design |
| `staticCapable` | whether the plugin works on a statically published site. `false` is shown as a "needs a server" tag wherever the plugin is listed and the publish step warns, because it infringes the portable-static pillar. The validator warns when a plugin with routes leaves it unset or true |
| `egress` | outbound hosts the plugin may call |
| `capabilities` | permissions requested, shown at enable time (see 9.1) |
| `privacy` | `tracking`, categories, cookies set, hosts that receive data, `requiresConsent` categories |
| `managedFiles` | managed output paths the plugin owns |
| `schedules` | recurring jobs run through `schedule.run` (spec/06) |
| `legacy` | reserved: aliases for extracted core routes, tags and registry paths |
| `packaged`, `integrity` | reserved: written by `hax plugin pack` (date, hash, signature reference) |

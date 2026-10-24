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
| `tags` | up to three free-form author tags for search and filtering (exactly one `category`, plus tags). **Derived tags** (`schema/derived-tags.json`: needs-server, runs-commands, sends-data-out, stores-secrets, injects-output, writes-files, reads-user-data, single-runtime, tracks-users, not-stable, untested) are computed from the manifest and always shown, because they carry security or longevity implications; authors cannot set or hide them |
| `icon` | an iconset name or a path to an image in the plugin (see https://github.com/haxtheweb/issues/issues/3173); required by the audit |
| `screenshots` | optional images (`src`, `alt`) for the dashboard and registry |
| `docs` | `readme` (default `README.md`) and `agents` (default `AGENTS.md`), both required by the audit; optional `prompts` file and `help` URL (spec/07, Plugin screen) |
| `skills` | agent skills under `skills/<name>/SKILL.md` with an `audience` (spec/07, Skills) |
| `tests`, `untested` | tests folder (default `tests`), required by the audit unless `untested: true`, shown as the derived tag `untested` (spec/07, Tests) |
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
| `staticFallback` | for a plugin with routes that still sets `staticCapable: true`: one sentence on what a statically hosted copy gets instead ("static copies show approved comments as of publish time; posting needs the server"). Shown on the plugin screen; without it the validator asks for `staticCapable: false` |
| `egress` | outbound hosts the plugin may call |
| `capabilities` | permissions requested, shown at enable time (see 9.1) |
| `privacy` | `tracking`, categories, cookies set, hosts that receive data, `requiresConsent` categories, and optionally `consentSetting`: a boolean setting that decides per site whether `requiresConsent` applies (a cookieless tracker that asks only when the site's policy wants it). Core resolves it before handing the plugin list to anyone, so a consent plugin only sees what is in effect |
| `managedFiles` | managed output paths the plugin owns |
| `schedules` | recurring jobs: `id`, `cron`, `handler` (exported by the backend entry), `scope` (system or once per site), optional `timeout`; run by `hax plugin schedule run` (spec/06) |
| `legacy` | keeps existing sites working after a feature moves out of core: `tags` (old tag → plugin tag, the old tag still renders), `routes` (old core path, optionally after a method such as `DELETE /x/api/v1/files/{fileUuid}`, → operationId in this plugin's contract), `settings` (plugin setting → old location: a `site.json` path, or `config:<path>` in the core config). Reads fall back to the old location until a value is saved; on the first enable in a scope core moves each value into the plugin's settings, coerced to the settings field's type (`"1"` → `true` for a boolean field), removes the old key and any parent it leaves empty, through the normal config and entity hooks. A plugin writes no install code for this; if the old shape needs converting, `config.before.save` normalizes it. Moving needs no capability, because core does it |
| `settingsScope` | `system` (default), `site` (each site has its own values, like the old `site.json` settings) or `both` (system default, site override) |
| `packaged`, `integrity` | reserved: written by `hax plugin pack` (date, hash, signature reference) |

### 2.2 Documenting what a plugin implements

Every implementation carries a docblock, the way Drupal documented each `hook_*()` implementation: the first line says what it implements, the next paragraph says what this plugin does there and why, then the parameters. Both runtimes use the same text.

```js
/**
 * Implements hook page.before.save.
 *
 * Counts the words of the page and stores the reading time in metadata.plugins.reading-time, so themes and the
 * render hook can show it without counting again.
 *
 * @param {object} ctx  ctx.subject: the page as submitted; ctx.previous: the stored page.
 * @returns {Promise<object>}  the page with the computed fields.
 */
"page.before.save": async (ctx) => { ... }
```

```php
/**
 * Implements hook page.before.save.
 *
 * Counts the words of the page and stores the reading time in metadata.plugins.reading-time, ...
 *
 * @param object $ctx  subject: the page as submitted; previous: the stored page.
 * @return array  the page with the computed fields.
 */
public function pageBeforeSave($ctx) { ... }
```

The first line is one of `Implements hook <name>.`, `Implements operation <operationId>.`, `Implements contract <name>, operation <op>.`, `Implements schedule <id>.` or `Implements upgrade <version>.`. The validator requires one for every hook subscription, operation, contract operation and schedule in each runtime, and `scripts/plugin-docs.mjs` writes the README's **What it implements** table from `plugin.yaml`, the hook contracts (when each hook runs) and the first sentence of each docblock, so a person sees every hook a plugin leans on and an agent can read the same list. Declarative pieces (proxy operations, registries) are listed from the manifest.

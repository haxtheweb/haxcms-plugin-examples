# Examples and conformance

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Examples repository and conformance

Repository `haxtheweb/haxcms-plugin-examples` (created; work starts there): the spec, JSON Schema for `plugin.yaml`, hook reference, the language-neutral conformance suite, the example plugins, and a mirror script (called by the ubiquity process) that copies the primary example and spec files into both backends. The example repo must be standalone and carry the spec, yet also be pulled into each backend. Today the shared boilerplate can drift between backends; unifying it with this mirroring is a goal, and how it is pulled in (submodule, ubiquity copy, or package) remains open. A backend counts as plugin-supporting only when the entire suite passes in Node's test runner and PHPUnit, and every example plugin's executable cases pass through that backend's adapter (spec/13 section 9; the in-memory reference harness in `harness/` runs them today). Spec conformance cases carry the same kind of `run` block, over small fixture plugins in `conformance/fixtures/`; `node conformance/run.mjs` reports how many are executable and how many are still prose. Each one was checked by breaking the matching rule in the harness and watching it fail. Rule: any new hook or extension point is added to the spec and demonstrated in the comprehensive example with a test in the same change; CI fails if coverage is missing.

**Where core plugins live.** Core plugins go in each backend's core plugins directory, mirrored between the Node and PHP backends (one folder per plugin with `src/nodejs` and `src/php`). Work happens on Node first, where the CLI can validate and test, then PHP repeats the same plugin and passes the same cases. Underneath sits the **HAX backend platform contract**: what every backend implements to load and work with plugins and sites (core config, the templates that stamp standardized files across platforms, the plugin loader, hooks, stores and routes). It is about the backend only and is kept separate from how front-end assets (web components, themes) are produced, which already have their own tooling. Its full shape is not specified yet.

Example set to start:
1. **Comprehensive `example`**: implements every hook (log or comment where trivial), every extension point, and the novelty case: a `.awesome` file type (`awesomeFile` extending `file`), an `awesome-explosion` element, an `awesome-explosions` theme built on the theme base, plus an even more awesome child theme that extends it (tests theme-to-theme dependency and fallback) and an `awesome` skeleton that fills a page with explosions, a message overlay, a form extension, an annotation, a settings schema with a secret, a veto and a warning, assets, a public operation, a restricted asset, and a same-named override fixture. Disabled by default.
2. **Minimal declarative pack**: the smallest valid plugin.
3. **Data-store plugin**: the writable store kinds, an upgrade step, `personalData`.
6. **Announcements** (`core-plugins/announcements`): the first real plugin. Core and required, system-scope routes behind both credentials, package stores, both runtimes with a Node/PHP parity test, dashboard elements with role `admin`, Merlin `api` programs, a system skill and a developer skill.
4. **Provider-contract pair**: a definer and an implementer, exercising dependency validation.
5. **Restricted-assets pack**.

## Shape checks against other plugins (informative; not built)

- **Views** (core, optional first, later required): entity `view` (site scope, with write routes), a separate read-only system entity for built-in views (two entities), contracts `views.source` and `views.display`, a `x-hax-public: true` results operation with its own anonymous filtering, `rebuild.after` writing snapshots and feeds to `managedFiles`, an upgrade step from `site.json`, `legacy` aliases for `/x/api/v1/views`.
- **Comments:** `comment` entity in `siteData`, `personalData: true`, signed-in HAXcms users only until local login lands, `optional` read access by setting, injected thread element, moderation panel, cascade delete through entity hooks, read-only snapshot at rebuild for static sites, `suggests` views.
- **Custom importer:** provider contract `import.platform` with `inputMode: url|upload` and `surfaces: [admin, cli, mcp]`; cannot override a core importer; guarded fetch, secret settings, declared egress; progress reserved.
- **PSU pack** (HAXiam contrib, locked): themes, skeletons, `polaris-` elements, locale overlay, restricted assets, built in the owner's own repo with `hax plugin build`; legacy registry paths reserved so existing sites keep working.

## Implement now versus reserve

**Implement now:** manifest schema and reserved keys; five tiers, rescan, status and lock config; dependencies with ranges and `suggests`; unified contract with scoping, `x-hax-public: true`, `optional` auth, `x-hax-rate-limit`; the full hook list with before/after pairs; entity `extends` and annotations; the four store kinds, storage helper and upgrade steps; registry merging for themes, skeletons, elements, locales and forms; assets (route, caching, publish copy, redistribution); declared and shown capabilities and privacy; dashboard plugin list; `hax plugin` commands and pillar report; conformance suite and examples; announcements.

**Reserve only (keys and docs, no behavior):** scheduler runner and `schedules`; importer jobs and progress; signing and integrity verification; `legacy`; translations; mail transport; the import, export, search, consent and spam contracts themselves (the contract mechanism ships; these specific contracts follow).

The scheduler needs a single-runner design in every runtime: Node can use an in-process timer with a lock to prevent duplicate runs across replicas, PHP needs a cron-called endpoint or a request-driven fallback; jobs are idempotent, time-bounded and logged.

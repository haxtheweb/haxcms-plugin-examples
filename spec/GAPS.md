# Spec gap list (for review)

Found while writing the examples, validator and conformance cases. Each is a decision or a hole, not a bug report. Resolved items are kept so the reasoning is visible.

## Resolved in this PR
0o. **Extra fields and veto.** A plugin must declare the schema it extends; undeclared added fields are warned about and discarded. A veto fails the whole operation with an error to the caller. Failures (including detached hooks) must be surfaced as plugin health; see item 12.
0l. **Hook return contract**: return the updated subject (PHP parity); `ctx` is the context object with `veto`, `warn`, `settings`, `storage`, `log`, `fetch`, `respond`. Timeouts: 5 s before hooks, detached after hooks 60 s, no emergency switch. Overwrites by a later hook log a warning.
0m. **Render pipeline and injected singletons.** `output.alter*` replaced by `render.before/head/content/body.start/body.end/after`; singletons are written by `render.body.end` with settings baked in; SSR runs in `render.content`; caching via `render.before` short-circuit plus `render.after` store.
0n. **Process execution.** No general exec; `exec:run` capability plus an `exec` command list, statically scanned.
0f. **Hook subject, mutation and previous.** Subject by reference; before and after hooks may both change it; `ctx.previous` on update; page and manifest saves and git commits have their own hooks (added `page.*`, `manifest.*`, `git.*`). Return shapes are still open (item 6).
0g. **Formats formalized.** `config/datastores.yaml`, `config/entities.yaml` and `registries/locales/*.yaml` have schemas (`schema/`) checked by the validator. Locale overlays are flat per plugin, merged per key.
0h. **Themes.** `terrible` is deprecated and folds into `hidden`. Regions become their own plugin and storage type; themes still render them via `site-region`. A child theme falls back to the parent's registry entry. Disabling a plugin whose theme is in use is refused.
0i. **Appstore.** Merge uses the plugin loading cascade; secrets stay in plugin config (CMI) and are brokered by the plugin's routes; core providers will be peeled off into plugins.
0j2. **Themes and skeletons.** A skeleton whose theme's plugin is disabled falls back to the default theme with a warning; disabling a plugin whose theme is in use is refused (0h).
0j. **Assets and capabilities.** Asset ids are paths under `frontend/dist/` with `sha256-` hashes. `network:egress` and `settings:secret` are enforced first; the rest are declared, shown and audited.
0k. **Conformance runners and consumption.** `create` uses both backends from each repo, so the cases and harness must be stand-alone or published with the plugin examples package (`files` now includes `conformance/` and `examples/`). Runner adapters per backend are still to write.
0c. **Manifest `uuid` is required**, generated once by `hax plugin create`. The site UUID is the root `id` of `site.json`.
0d. **Moving a core setting into a plugin.** Saved as part of the plugin's configuration (CMI), removed from the global form, migrated from `site.json` by the plugin's install hook on first enable (spec/06, spec/07). Candidate future splits are in spec/07 section 7.3.
0e. **Hook subject.** The context carries the thing the hook is about (entity, page or manifest, plugin, site, user, request/response); per-hook fields are still open (item 6).
0. **Namespacing is by design.** A plugin is limited to one `tagPrefix`, deliberately (one namespace per plugin). The child theme in the example is `awesome-awesomer-theme` for that reason. (Was gap 3.)
0b. **Version scheme.** HAX versions are calendar style: year, month, then the release number within that month (`26.8.1`). Plugin and platform versions are compared as dotted numbers, which the semver syntax already accommodates, so `requires.haxcms` and dependency ranges use semver range syntax over calendar versions. (Was gap 4.)
1. **Public and rate-limit keys.** The spec said `public: true` per operation, but OpenAPI only allows `x-` extension keys. Now `x-hax-public: true` and `x-hax-rate-limit`.
2. **`hax validate`.** `hax audit schema` already exists in https://github.com/haxtheweb/create and shells out to each schema repo's validator. The spec now extends that command instead of adding a new one.

## Need a decision
12. **Plugin logging and health.** Hook discards, warnings, vetoes, timeouts and detached failures need a store, a viewer and an API (admin/plugins/<id>/health?). Shape, retention and what the site owner sees are not specified.
13. **Merlin declarations vs modules.** If a `module` plugin file imports the store and registers with Merlin directly, `static` and `api` declarations may be redundant. Candidate: keep declarations only for what tooling must see without running JS (audit, listing, permissions).
6. **Per-hook subject fields.** The hook list is fixed but each hook's context and return shape (veto, warnings, annotations) is not specified yet. The example uses `ctx.entity` and `{ veto, message }` as placeholders.

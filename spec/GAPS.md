# Spec gap list (for review)

Found while writing the examples, validator and conformance cases. Each is a decision or a hole, not a bug report. Resolved items are kept so the reasoning is visible.

## Resolved in this PR
0c. **Manifest `uuid` is required**, generated once by `hax plugin create`. The site UUID is the root `id` of `site.json`.
0d. **Moving a core setting into a plugin.** Saved as part of the plugin's configuration (CMI), removed from the global form, migrated from `site.json` by the plugin's install hook on first enable (spec/06, spec/07). Candidate future splits are in spec/07 section 7.3.
0e. **Hook subject.** The context carries the thing the hook is about (entity, page or manifest, plugin, site, user, request/response); per-hook fields are still open (item 6).
0. **Namespacing is by design.** A plugin is limited to one `tagPrefix`, deliberately (one namespace per plugin). The child theme in the example is `awesome-awesomer-theme` for that reason. (Was gap 3.)
0b. **Version scheme.** HAX versions are calendar style: year, month, then the release number within that month (`26.8.1`). Plugin and platform versions are compared as dotted numbers, which the semver syntax already accommodates, so `requires.haxcms` and dependency ranges use semver range syntax over calendar versions. (Was gap 4.)
1. **Public and rate-limit keys.** The spec said `public: true` per operation, but OpenAPI only allows `x-` extension keys. Now `x-hax-public: true` and `x-hax-rate-limit`.
2. **`hax validate`.** `hax audit schema` already exists in https://github.com/haxtheweb/create and shells out to each schema repo's validator. The spec now extends that command instead of adding a new one.

## Need a decision
6. **Hook payloads.** The hook list is fixed but each hook's context and return shape (`ctx.entity`, veto, warnings, annotations) is not specified yet. The example uses `ctx.entity` and `{ veto, message }` as placeholders.
7. **Hook defaults.** Per-hook timeout value, max chain length, and what `HAXCMS_DISABLE_HOOKS=1` disables exactly.
8. **Datastore and entity extension formats.** `config/datastores.yaml`, `config/entities.yaml` (`extends`, `annotations`) are illustrative in the examples and have no schema yet.
9. **Locale overlays.** `registries/locales/*.yaml` is a flat key map in the example. The real keys (I18NMixin `this.t` keys? backend message catalogs?) and the merge rules need defining.
10. **Merlin `api` kind rows.** The `row` template and `map` fields are a first guess; the final shape should be confirmed with how real programs build rows.
11. **Theme `extends`.** Not read by core today. Needs a core change (registry fallback and regions inheritance) and a decision on what a child inherits.
12. **`terrible` theme flag.** Present on every theme entry; its meaning is undocumented.
14. **Injected singletons.** `role: injected` elements load through `output.alterPage`. How the host guarantees the module is imported (import map or registry) before the element is used is not specified.
15. **Asset ids.** Path under `frontend/dist/` with subfolders, and hash format `sha256-...`, are assumed; confirm.
16. **Capability enforcement.** The vocabulary is open and warns; what each runtime actually enforces on the host API is undefined.
17. **Skeleton and theme references to plugins.** A skeleton names a theme tag; when the providing plugin is disabled the fallback and the warning shown are specified only in outline.
18. **Conformance runners.** Cases exist (`conformance/`) but no runner in either backend.
19. **Consuming this repo.** How haxcms-nodejs and haxcms-php pull the spec and examples, and how that relates to the boilerplate that currently can drift between them.

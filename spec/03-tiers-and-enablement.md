# Tiers, priority and enablement

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Tiers, priority, enablement

| Priority | Tier | Location |
|---|---|---|
| 5 | Site | `<site>/_plugins/<id>/` |
| 4 | System contrib | `<HAXCMS_ROOT>/_plugins/<id>/` |
| 3 | System core | PHP `system/plugins/<id>/`; Node `src/plugins/<id>/` |
| 2 | HAXiam contrib | `<HAXIAM_ROOT>/_plugins/<id>/` |
| 1 | HAXiam core | HAXiam `system/plugins/<id>/` (none today) |

Load order is the reverse (lowest first), and a higher tier wins on a name collision.

- **Required** is for core plugins only. A contrib plugin cannot declare itself required; an administrator locks it in deployment config (`_config/plugins/plugins.yaml`, `locked: true`), and the dashboard shows it as required. A dependency can also make a plugin needed by another plugin.
- **Required plugins cannot be disabled or supplanted.** For other plugins, a same-named plugin at a higher tier loads in priority and the loader warns (log plus a registry entry). A core importer cannot be overridden by a plugin.
- **Auth** may be supplied only by the highest-order context of the deployment profile: HAXiam when `haxiam-managed`, the system when `self-hosted-multi-site`, the site itself only when `single-site`. A site plugin never supplies auth in a multi-site or multi-tenant deployment.
- **Enablement** happens in the system dashboard (plugin list: tier, version, enabled, required, locked, lifecycle, warnings), per site where applicable, and from the CLI. Enabling a plugin auto-enables its dependencies after confirmation (`--y` in the CLI). Disabling a plugin that others depend on is refused (409 with the dependents). A plugin that was only enabled because of a dependent is not auto-disabled when the dependent goes away; the dashboard marks it "enabled, not in use" and suggests disabling.
- **Discovery** needs an explicit rescan (admin action and CLI), so adding a plugin does not need a restart. No file watchers. PHP discovers at boot (cached); Node discovers at server start, not at build. The CLI loads Node plugins in-process.
- **Backend code gating.** A per-deployment flag decides which tiers may run backend code. HAXiam production: plugins are written locally and copied by an administrator to test or production, where they load automatically; site-tier backend and front-end code is off. Declarative `pack` plugins need no gate.
- **Failure isolation.** An invalid plugin is disabled with its reason shown. It never stops boot, and the next provider or the core default takes over.
- **Bootstrap.** The loader is irreducible core code.
- **Missing plugins on a site.** A site that references a plugin that is off or absent still works and shows a warning. Anything not required for rendering degrades silently (comments disappear, a restricted theme falls back to a default).
- **Per-site readiness.** A dependency is satisfied for a site only after the dependency's own per-site upgrade has run. A plugin that depends on a newly extracted core plugin cannot be enabled on an older site until that site's upgrade step has completed.

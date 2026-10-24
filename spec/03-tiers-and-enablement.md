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
- **Enablement** happens in the system dashboard (plugin list: tier, version, enabled, required, locked, lifecycle, warnings), per site where applicable, and from the CLI. Enabling a plugin auto-enables its dependencies after confirmation (`--y` in the CLI). Disabling a plugin that others depend on is refused (409 with the dependents), and the dashboard shows the dependency in both directions (A requires B, so B cannot be disabled until A is), as Drupal's module list does. If anything fails while enabling (install hook, upgrade step, dependency check), the plugin is turned back off with the reason recorded; no rollback of partial store changes is specified, because failures there are expected to be rare. Disabling a plugin that supplies a theme still in use by any site is also refused (409 listing the sites): the theme must be changed first. This is one reason themes can ship as stand-alone `pack` plugins instead of inside a larger plugin. A plugin that was only enabled because of a dependent is not auto-disabled when the dependent goes away; the dashboard marks it "enabled, not in use" and suggests disabling.
- **Discovery** needs an explicit rescan (admin action and CLI), so adding a plugin does not need a restart. No file watchers. PHP discovers at boot (cached); Node discovers at server start, not at build. The CLI loads Node plugins in-process.
- **Backend code gating.** A per-deployment flag decides which tiers may run backend code. HAXiam production: plugins are written locally and copied by an administrator to test or production, where they load automatically; site-tier backend and front-end code is off. Declarative `pack` plugins need no gate.
- **Failure isolation.** An invalid plugin is disabled with its reason shown. It never stops boot, and the next provider or the core default takes over.
- **Bootstrap.** The loader is irreducible core code.
- **Missing plugins on a site.** A site that references a plugin that is off or absent still works and shows a warning. Anything not required for rendering degrades silently (comments disappear, a restricted theme falls back to a default).
- **Status.** A plugin is `available` (installed on disk), `enabled` and `active`, `enabled` but `inactive` (unmet requirements from `plugin.requirements`, spec/06), `disabled`, or `failed` (turned off after an error while enabling). A warn or error in the log adds a health status shown as a chip.
- **Scope.** A plugin enabled at system level applies to the whole system and sites cannot turn it off. Many plugins are made available at system level through the cascade but enabled site by site; those can be enabled and disabled per site.
- **Optional companions and conflicts.** `suggests` lists plugins that add something when present; the install page shows them, and code checks with `ctx.pluginEnabled(id)`. `conflicts` lists plugins known not to work alongside this one; enabling both is allowed with a warning.
- **Same plugin at two tiers.** The more specific copy wins by the cascade (site over system), with a warning that it overrides the other copy and both versions.
- **Disable versus uninstall.** Disabling keeps data and runs no uninstall hooks. Uninstall is offered only after disable, and uninstall purges the plugin's data by design.
- **Plugin health.** A plugin with discards, warnings, vetoes, timeouts or detached failures shows a badge on its dashboard row. Site owners and system admins can see it for now; roles and permissions are to be teased out later. A hook that keeps failing keeps running and keeps logging; nothing is auto-disabled after enabling succeeded. The messages themselves go to the log plugin (spec/06).
- **Per-site readiness.** A dependency is satisfied for a site only after the dependency's own per-site upgrade has run. A plugin that depends on a newly extracted core plugin cannot be enabled on an older site until that site's upgrade step has completed.

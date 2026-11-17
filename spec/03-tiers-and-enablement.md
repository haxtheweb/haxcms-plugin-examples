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

- **Enabled by default** means core and required, nothing else: required core plugins are always on; every other plugin, core or not, is off until enabled (when `google-analytics` is extracted it ships in core but is opt-in). There is no `defaultEnabled` key. Enabling a plugin on every site at once is a CLI convenience (`hax plugin enable <id> --all-sites`), not a manifest setting.
- **Required** is for core plugins only. A contrib plugin cannot declare itself required; an administrator locks it in deployment config (`_config/plugins/plugins.yaml`, `locked: true`), and the dashboard shows it as required. The opposite is `blocked: true`: the plugin cannot be enabled anywhere in that deployment, shown with the reason (HAXiam blocks the MCP plugin this way until it is tested further). A dependency can also make a plugin needed by another plugin.
- **Required plugins cannot be disabled or supplanted.** For other plugins, a same-named plugin at a higher tier loads in priority and the loader warns (log plus a registry entry). A core importer cannot be overridden by a plugin.
- **Auth** may be supplied only by the highest-order context of the deployment profile: HAXiam when `haxiam-managed`, the system when `self-hosted-multi-site`, the site itself only when `single-site`. A site plugin never supplies auth in a multi-site or multi-tenant deployment. Delegated access (the `oauth` plugin issuing tokens for what an already signed-in person may do) is not auth in this sense: it signs no one in (spec/05, OAuth).
- **Enablement** happens in the system dashboard (plugin list: tier, version, enabled, required, locked, lifecycle, warnings), per site where applicable, and from the CLI. Enabling a plugin auto-enables its dependencies after confirmation (`--y` in the CLI). Disabling a plugin that others depend on is refused (409 with the dependents), and the dashboard shows the dependency in both directions (A requires B, so B cannot be disabled until A is), as Drupal's module list does. If anything fails while enabling (install hook, upgrade step, dependency check), the plugin is turned back off with the reason recorded; no rollback of partial store changes is specified, because failures there are expected to be rare. Disabling a plugin that supplies a theme still in use by any site is also refused (409 listing the sites): the theme must be changed first. This is one reason themes can ship as stand-alone `pack` plugins instead of inside a larger plugin. A plugin that was only enabled because of a dependent is not auto-disabled when the dependent goes away; the dashboard marks it "enabled, not in use" and suggests disabling.
- **Discovery** needs an explicit rescan (admin action and CLI), so adding a plugin does not need a restart. No file watchers. PHP discovers at boot (cached); Node discovers at server start, not at build. The CLI loads Node plugins in-process.
- **Backend code gating.** A per-deployment flag decides which tiers may run backend code. HAXiam production: plugins are written locally and copied by an administrator to test or production, where they load automatically; site-tier backend and front-end code is off. Declarative `pack` plugins need no gate.
- **Failure isolation.** An invalid plugin is disabled with its reason shown. It never stops boot, and the next provider or the core default takes over.
- **Bootstrap.** The loader is irreducible core code.
- **Missing plugins on a site.** A site that references a plugin that is off or absent still works and shows a warning. Anything not required for rendering degrades silently (comments disappear, a restricted theme falls back to a default).
- **Dependencies show how things plug together**, including between required core plugins that always load. They are informational there and enforced like any other. `outline` depends on `git`; if version control were ever swapped for something else, the dependency would point at a contract (for example `vcs`) that `git` implements, so keeping all version-control behavior inside one plugin keeps that possible.
- **Status.** A plugin is `available` (installed on disk), `enabled` and `active`, `enabled` but `inactive` (unmet requirements: every `required` settings field without a value, which core reports itself, plus whatever `plugin.before.requirements` subscribers add, spec/06), `disabled`, or `failed` (turned off after an error while enabling). A warn or error in the log adds a health status shown as a chip.
- **Scope.** A plugin enabled at system level applies to the whole system and sites cannot turn it off. Many plugins are made available at system level through the cascade but enabled site by site; those can be enabled and disabled per site.
- **Optional companions and conflicts.** `suggests` lists plugins that add something when present; the install page shows them, and code checks with `ctx.pluginEnabled(id)`. `conflicts` lists plugins known not to work alongside this one; enabling both is allowed with a warning.
- **Same plugin at two tiers.** The more specific copy wins by the cascade (site over system), with a warning that it overrides the other copy and both versions.
- **Disable versus uninstall.** Disabling keeps data and runs no uninstall hooks. Uninstall is offered only after disable, and uninstall purges the plugin's data by design.
- **Skeletons are starting points.** A skeleton's `site.plugins` only decides what is enabled when a site is created from it; changing or removing the skeleton later has no effect on sites made from it.
- **Sites carry their plugin list.** `site.json` records the plugins the site was made with (id, version, scope) and keeps it current on enable and disable. Exporting or duplicating a site carries that list, plus site-scope plugins and their siteData. When the site is added to another deployment, any listed plugin that is missing or older is written to that site's log as a warning.
- **Provenance.** The lock config records two independent flags per plugin: **tested** (the CLI ran the validator, `exec` scan and the plugin's tests) and **signed** (a valid signature from the release workflow or a supplier). Placing a plugin by hand (copying a folder over FTP, local development, then refreshing the plugins page to load it) is allowed and expected, but the plugin shows "not tested" and "not signed", with a note that this is not the ideal path, the CLI commands that would check it, and a link to the reference documentation. Enabling it needs an explicit confirmation that it is not from an official source and may carry risk, the way Windows asks before running an app downloaded directly from the web. Running `hax plugin verify <id>` (or updating through the CLI) clears "not tested" when the checks pass; "not signed" stays until the package is signed.
- **Plugin health.** A plugin with discards, warnings, vetoes, timeouts or detached failures shows a chip on the plugin dashboard, where plugins are enabled and their settings managed. Core keeps the counts and last message itself, so chips work without the log plugin; the log plugin is optional and adds the full history. Site owners and system admins can see it for now; roles and permissions are to be teased out later. A hook that keeps failing keeps running and keeps logging; nothing is auto-disabled after enabling succeeded. The messages themselves go to the log plugin (spec/06).
- **Per-site readiness.** A dependency is satisfied for a site only after the dependency's own per-site upgrade has run. A plugin that depends on a newly extracted core plugin cannot be enabled on an older site until that site's upgrade step has completed.

## The plugin registry

Core keeps track of every installed plugin in one place per scope, and every surface (dashboard, CLI, agents, the publish step) reads that instead of looking at folders.

**What is stored.** `_config/plugins/plugins.yaml`, at `<HAXCMS_ROOT>` for the system and in each site for that site (`schema/plugin-registry.schema.json`):

```yaml
version: 1
enabled: [announcements, quick-poll]   # ids enabled in this scope; required and locked plugins are on without being listed
locked: []                             # deployment config: enabled, and cannot be turned off here or in any site
blocked: [mcp]                         # deployment config: cannot be enabled anywhere in this deployment
plugins:                               # what core recorded when each was enabled
  quick-poll: { version: 26.11.1, enabledAt: "2026-11-16T21:00:00Z", by: btopro }
```

A site's file lists what that site turned on in addition to the system's list. A plugin is enabled for a site when the system list or that site's list names it, unless the deployment blocked it.

**What is served.** `GET /system/api/v1/plugins` (both credentials) and `GET /x/api/v1/plugins` (site credentials, for that site) return one entry per installed plugin:

| Field | Meaning |
|---|---|
| `id`, `title`, `version`, `tier`, `kind` | identity and where the copy in use comes from |
| `status`, `reason` | `available`, `active`, `inactive`, `disabled`, `failed` or `refused`, with why |
| `enabled`, `required` | whether it is on in this scope, and whether it can be turned off |
| `unmet` | requirements that keep it inactive: settings to fill in, and what this backend's target cannot give it (spec/14) |
| `limited` | what it cannot do on this backend's target while still running (spec/14) |
| `needs`, `targets`, `staticCapable` | what it needs from a backend, how it fits each target (`full`, `limited`, `no`), and whether it works on a static copy |
| `dependencies`, `dependents` | both directions, so a screen can say why something cannot be turned off |
| `sites` | system scope only: the sites that enabled it themselves |

**What changes it.** `POST /system/api/v1/plugins/<id>/enable` and `.../disable` (both credentials) for the system; `POST /x/api/v1/plugins/<id>/enable` and `.../disable` (site credentials) for one site. Each runs the lifecycle in spec/13 section 2 (install hooks on the first enable in a scope, `plugin.before.enable`, requirements), writes the registry file only when that succeeded, and answers with the plugin's registry entry. The refusals are the ones above: 409 with `dependencies` to enable first, 409 with `dependents`, 409 for a required, locked or blocked plugin, 404 for one that is not installed. The CLI's `hax plugin enable|disable|list|status` are these calls made in process.

**Nothing loads until it is enabled.** A plugin that is installed and not enabled is `available`: its manifest was read and validated, none of its code was loaded, it has no routes, hooks or registry entries, and it appears only in the registry.

# Packaging, dashboard, CLI and audit

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Versioning, packaging, suppliers

Plugins are distributed like npm packages (composer kept in sync if feasible) before any dedicated registry. `hax plugin pack` writes the reserved `packaged` and `integrity` keys (date, hash, GPG signature reference), mirroring the project's release workflow. Announcements, being core, does not need signing. The loader verifies integrity only when present. Suppliers (https://github.com/haxtheweb/issues/issues/213) are an additive layer: any individual can run fully autonomously, and curated suppliers (Ubuntu Pro or RHEL style) enable "add to my site", "add to my system", or "on by default for all users", which map onto the existing tiers plus deployment config. Grav's package manager is the closest precedent for the CLI flow.

## Dashboard, CLI, audit

### CLI operations

Everything the dashboard can do, the CLI can do, at system level or for one site (`--site <name|uuid>`; without it the command targets the system). Every command takes `--json` for agents and `--y` to accept confirmations.

| Command | What it does |
|---|---|
| `hax plugin install <@scope/name[@range]\|git-url\|path>` | Fetches the plugin (npm, git, path, or a tarball from `hax plugin pack` for offline servers) and places it in the plugins directory for the tier. Without `--tier`, it asks, defaulting to system (also the default when not inside a site). Validates, runs the `exec` scan and runs the plugin's own tests. The CLI is Node, so it runs the cases and `tests/nodejs`; PHP compatibility is verified by the project's release and deployment pipeline, and arriving from an official source is what attests to it; a failing test stops the install unless `--allow-failing-tests`, recorded in the lock config. Then asks whether to enable it, for this site when run inside one; `--enable [--site]` scripts that. Records the installed version and range in the CMI lock config for the scope it was installed in |
| `hax plugin enable <id> [--site]` | Enables (auto-enables dependencies after confirmation); runs `plugin.requirements` and reports `active` or `inactive` with what is missing |
| `hax plugin disable <id> [--site]` | Disables; refused with the dependents or sites using its theme |
| `hax plugin uninstall <id>` | Only after disable, and refused while enabled anywhere. Runs uninstall hooks and purges the plugin's data by design, then removes the files |
| `hax plugin config get\|set\|unset <id> <key> [value] [--site]` | Reads or writes the plugin's CMI settings, validated against its settings schema; secrets are write-only |
| `hax plugin status [<id>] [--site]` | Status, health, unmet requirements, dependents, conflicts |
| `hax plugin list [--site] [--enabled\|--available]` | Plugins with tier, version, status and health |
| `hax plugin move <id> --to site\|system [--site]` | Moves the installed copy between tiers, keeping data and enablement; updates both lock configs |
| `hax plugin verify <id>` | Runs the install checks (validator, `exec` scan, Node tests, signature check) on a plugin already in place, for example one copied in by hand; clears "not tested" when they pass, leaves "not signed" unless a valid signature is present |
| `hax plugin restore [--site]` | Installs exactly what the scope's lock config lists, like `npm ci` |
| `hax plugin update <id> [--to <range>]` | Fetches a newer version within the recorded range (or `--to`), validates and scans it, runs upgrade steps, updates the lock config |
| `hax plugin schedule run [--site]` | Runs due scheduled jobs once (meant for system cron) |
| `hax plugin log [<id>] [--site] [--level]` | Reads the unified log (needs the log plugin) |
| `hax plugin create`, `add <piece> <name>`, `build`, `validate`, `audit`, `pack` | Authoring commands (below) |

The typical flow is install at system, enable per site: from inside a site, `hax plugin install @haxtheweb/announcements --tier system --enable --site .` (or the same in two commands). The validator, `exec` scan and the plugin's tests run at install and update, so a plugin that would brick the system never lands; `enable` does not repeat them. Tests only run through the CLI: the dashboard cannot run them and the backend runs them only when the CLI asks. The lock config (CMI, per scope) lists each plugin's source, installed version and accepted range; at site scope it is committed with the site's git. Unsigned packages (local development, site-specific custom plugins) install with an info-level notice, not a warning, since custom plugins without an official source are expected to be common.


- **Dashboard:** a Plugins area under system admin, simple for now: every plugin with tier, version, group, lifecycle, enabled, required, locked, warnings, capabilities and privacy summary, pillar verdict, and a link to its configuration (settings form or admin panel). Locked plugins cannot be toggled.
- **CLI (`hax plugin ...`)** writes templated files the way site and webcomponent commands do (templates are the example plugin minus the demo parts): `create`, `list`, `install <path|git-url|npm>`, `add <piece> <name>` (adds a piece to a plugin: `theme`, `element`, `skeleton`, `route`, `entity`, `hook`, `datastore`, `setting`, `locale`, `contract`, `merlin`, `migration`; writes the stub in the right place, registers it, adds a test stub, then runs `validate`; never overwrites; `--dry-run`, `--json`; element stubs reuse the `hax webcomponent` generator with the plugin's `tagPrefix`), `enable|disable [--site] [--y]`, `build` (assets, registries summary), `validate`, `audit`, later `pack`. `--json` output for agents.
- **Audit** checks the manifest schema, spec rules (security, scoping, naming), runtime parity for required plugins, backend code for unsafe patterns, dependencies, forbidden syntax per repo rules, accessibility and DDD for front-end elements, and `haxProperties` presence.
- **Pillar report.** Every plugin gets a verdict: **aligned**, **partial** (declared deviations such as needs a backend or an outside service), or **non-aligned** (undeclared violations such as undeclared tracking or egress, content that breaks without it, or unexplained restrictions). Checks: static capability, where data lives and portability, content survival if removed, external services, accessibility audit, privacy declaration, load-only-when-used, redistribution and license, tag prefix and `haxProperties`. The verdict appears in the audit and the dashboard so installers see violations before they install.

### Schema validation in `hax audit schema`
`hax audit schema` already exists in https://github.com/haxtheweb/create: it finds HAX schema documents under a path and runs each schema repo's validator (`jos-validate`, `haxproperties-validate`, `hax-element-validate`, `appstore-validate`, `merlin-validate`). Plugins plug into that command rather than adding a new one: a `plugin` kind is discovered by `plugin.yaml` and runs `hax-plugin-validate` from `@haxtheweb/haxcms-plugin-spec` (this repo, `scripts/validate.mjs`). `hax plugin validate` and `hax plugin audit` call the same validator. JSON output matches the other validators. Prerequisites: the validator packages are published to npm (this one and merlin-schema are not yet), and CI runs the audit against the live monorepo so drift is caught.

### Release and versioning
The HAX schema packages are versioned with the rest of the ecosystem and published by the ubiquity release (see the Releasing section of https://github.com/haxtheweb/appstore-spec), which tags and publishes every package with one calendar version. `@haxtheweb/haxcms-plugin-spec` is intended to join that release so it is published and versioned the same way; until then it is unpublished and `package.json` carries a placeholder version. The `specVersion` plugins declare is a separate, semver-syntax version of the contract itself.

### Test stubs

`hax plugin create` and every `hax plugin add` write a test case next to the code they generate: a basic passing case, **commented out**, so a person can read it and learn the shape while the suite stays honest. An agent then uncomments and fills it in, typically after the plugin fails the audit or conformance. A cases file holding only commented stubs counts as no tests.

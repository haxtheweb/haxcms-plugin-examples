# Packaging, dashboard, CLI and audit

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Versioning, packaging, suppliers

Plugins are distributed like npm packages (composer kept in sync if feasible) before any dedicated registry. `hax plugin pack` writes the reserved `packaged` and `integrity` keys (date, hash, GPG signature reference), mirroring the project's release workflow. Announcements, being core, does not need signing. The loader verifies integrity only when present. Suppliers (https://github.com/haxtheweb/issues/issues/213) are an additive layer: any individual can run fully autonomously, and curated suppliers (Ubuntu Pro or RHEL style) enable "add to my site", "add to my system", or "on by default for all users", which map onto the existing tiers plus deployment config. Grav's package manager is the closest precedent for the CLI flow.

## Dashboard, CLI, audit

- **Dashboard:** a Plugins area under system admin, simple for now: every plugin with tier, version, group, lifecycle, enabled, required, locked, warnings, capabilities and privacy summary, pillar verdict, and a link to its configuration (settings form or admin panel). Locked plugins cannot be toggled.
- **CLI (`hax plugin ...`)** writes templated files the way site and webcomponent commands do (templates are the example plugin minus the demo parts): `create`, `list`, `add <path|git-url|npm>`, `enable|disable [--site] [--y]`, `build` (assets, registries summary), `validate`, `audit`, later `pack`. `--json` output for agents.
- **Audit** checks the manifest schema, spec rules (security, scoping, naming), runtime parity for required plugins, backend code for unsafe patterns, dependencies, forbidden syntax per repo rules, accessibility and DDD for front-end elements, and `haxProperties` presence.
- **Pillar report.** Every plugin gets a verdict: **aligned**, **partial** (declared deviations such as needs a backend or an outside service), or **non-aligned** (undeclared violations such as undeclared tracking or egress, content that breaks without it, or unexplained restrictions). Checks: static capability, where data lives and portability, content survival if removed, external services, accessibility audit, privacy declaration, load-only-when-used, redistribution and license, tag prefix and `haxProperties`. The verdict appears in the audit and the dashboard so installers see violations before they install.

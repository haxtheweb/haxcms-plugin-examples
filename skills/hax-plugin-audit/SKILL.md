---
name: hax-plugin-audit
description: "READ-ONLY audit of a HAXcms plugin: does it still validate and pass its tests, is it safe (routes, secrets, commands, data), does it follow the HAX pillars, and is it documented for agents. Use when asked to review, audit or check a HAX plugin, or before installing one from an unofficial source. Reports; does not change files."
version: 0.1.0
license: Apache-2.0
metadata:
  author: haxtheweb
  tags: [hax, haxcms, plugin, audit, security]
---

# Auditing a HAXcms plugin

Spec: https://github.com/haxtheweb/haxcms-plugin-examples. Diagnose only; hand fixes to `hax-plugin-dev` or `hax-plugin-upgrade`.

## Run

1. `hax plugin validate <folder>` (or `node scripts/validate.mjs <folder>` from the spec repo). Record errors, warnings and derived tags.
2. Run the plugin's tests: `hax-plugin-test <folder>` for executable cases in both runtimes (parity included), and `tests/nodejs/*.test.mjs` with `node --test`. Note `untested: true` and cases with no `run` block.
3. `hax audit schema <folder>` when available, for the HAX schemas inside it (haxProperties, skeletons, appstore, Merlin).

## Check

**Safety**
- Every route: `security` present, or `x-hax-public: true` with a reason and a rate limit. No route returns the HAXcms version without both credentials.
- Secrets: only in settings marked secret; never in registries, appstore fragments, rendered output or logs. `settings:secret` plus `output:inject` deserves a close look at render hooks.
- Commands: only those in `exec`, with `exec:run`; the validator's static scan must be clean.
- Outbound calls: only through `ctx.fetch` to declared hosts with `network:egress`.
- Personal data: `personalData` stores, or `privacy.export` / `privacy.delete` with `users:full`. Tracking declared with consent.
- Paths: no file access outside the plugin's stores and `data/`; user input never builds a path.

**Pillars**
- Works on a static site, or says `staticCapable: false` (shown as "needs a server").
- Does not break core: only extends through hooks, routes under its own namespace, tags under its own prefix.
- Both runtimes for core and first-party plugins, with matching behavior.

**Agents and people**
- `AGENTS.md` explains purpose, layout, rules, how to test and how to diagnose. README, category, icon present.
- Skills have the right audience; site and system skills contain only .md, .json and .txt; no machine paths.

## Report

A short table per area (Safety, Pillars, Tests, Docs) with pass, warning or fail, each finding with the file and line and the fix to make. Lead with anything that would block installing it.

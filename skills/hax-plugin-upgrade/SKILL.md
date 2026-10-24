---
name: hax-plugin-upgrade
description: "Upgrade a HAXcms plugin to a newer plugin spec version or HAXcms release, applying the spec's upgrade recipes and proving with tests that behavior did not change. Use when a plugin fails validation after an update, when the spec CHANGELOG has a new version, or when asked to upgrade or modernize a HAX plugin."
version: 0.1.0
license: Apache-2.0
metadata:
  author: haxtheweb
  tags: [hax, haxcms, plugin, upgrade, maintenance]
---

# Upgrading a HAXcms plugin

The goal is that plugins written once keep working, and that an agent can upgrade one with tests proving it. Spec and recipes: https://github.com/haxtheweb/haxcms-plugin-examples (`spec/CHANGELOG.md`).

## Before changing anything

1. Run the plugin's tests and record the results. If they fail before you start, report that first; do not upgrade on a red baseline.
2. Note the current `specVersion`, plugin `version`, and `requires.haxcms` range.
3. Read every `spec/CHANGELOG.md` entry between the plugin's `specVersion` and the target. Each lists renamed keys, renamed hooks and the recipe to apply.
4. Read the plugin's `AGENTS.md` "Upgrade notes" and any `kind: upgrade` prompts in `docs/prompts.yaml`.

## Apply

- Apply each recipe in order: rename manifest keys and hooks (for example `render.body.end` became `render.after.body`), move files, update schemas. Change both runtimes together.
- Keep identities stable: never change `id`, `uuid`, entity uuids, store ids or operation ids unless a recipe says so.
- Data shape changes go in an upgrade step (`migrations/`) that runs per site, not in ad-hoc code.
- Bump `specVersion` to the target and the plugin `version` (minor for compatible changes).

## Prove it

1. Validate: `hax plugin validate` with no errors.
2. Run the same tests as the baseline: every case that passed before still passes. Add cases for anything the recipe changed.
3. Run the Node/PHP parity check when the plugin has one.
4. Diff behavior, not just files: routes, hook subscriptions and derived tags should match the baseline unless the changelog says otherwise.

## Hand off

A PR with: what changed and why (link the changelog entries), the before and after test results, and anything you could not upgrade. Never merge it yourself. Security fixes are audited separately (`hax-plugin-audit`).

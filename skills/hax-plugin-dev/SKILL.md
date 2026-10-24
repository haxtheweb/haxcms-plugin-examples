---
name: hax-plugin-dev
description: "Create a HAXcms plugin or add pieces to one (routes, entities, data stores, hooks, settings, elements, themes, skeletons, Merlin options, skills, tests) following the HAXcms plugin spec. Use when the user asks to build, scaffold or extend a HAX plugin, or to add a hook, route, theme or block to one."
version: 0.1.0
license: Apache-2.0
metadata:
  author: haxtheweb
  tags: [hax, haxcms, plugin, development]
---

# Building a HAXcms plugin

The spec and examples live in https://github.com/haxtheweb/haxcms-plugin-examples. Read the comprehensive example (`examples/example`) when unsure how a piece looks; read `examples/announcements` for a real plugin.

## 1. Decide what the plugin needs

Start from what it must do, then pick only the pieces it needs:

| Need | Piece | Spec |
|---|---|---|
| store data | `config/datastores.yaml` (site, siteData, system, manifest, package) | spec/04 |
| a new kind of record | `config/entities.yaml` (`extends` an entity, or a new one with a store) | spec/04 |
| an API | `config/openapi.yaml`, `x-hax-scope: site\|system`, secured unless `x-hax-public` | spec/05 |
| react to or change what core does | hooks in `plugin.yaml`; look up the subject and return in `schema/hook-contracts.json` | spec/06 |
| settings | `config/settings.schema.json` (haxProperties settings format, stored in CMI) | spec/07 |
| blocks, themes, skeletons, Merlin, appstore, locales | `registries/<kind>/` | spec/07 |
| agent help | `skills/<id>-<name>/SKILL.md` with `audience: site\|system\|developer`; `docs/prompts.yaml` | spec/07 |

If one plugin would need two tag prefixes, it is two plugins.

## 2. Scaffold

- When the CLI has the commands: `hax plugin create`, then `hax plugin add <piece> <name>` for each piece. Each `add` writes the stub where it belongs, registers it, and writes a **commented-out** test case.
- Until then: copy `examples/minimal-pack` (declarative) or the structure of `examples/announcements` (with code), set `id` to the folder name and generate a new `uuid`.

Required for every plugin: `plugin.yaml`, `README.md` (people), `AGENTS.md` (agents: purpose, layout, rules, build/test/validate, diagnose, upgrade notes), `category`, `icon`, and tests unless `untested: true`.

## 3. Write code that fits the contract

- Both runtimes for core and first-party plugins: `src/nodejs/index.js` and `src/php/Plugin.php`, same behavior. Put logic in a pure module mirrored in each runtime and keep the entry files thin.
- Hooks return the updated subject (or nothing). Veto only in before hooks with `ctx.veto(message)`. Filter inside the hook: core fires for everything.
- In bulk work, mark and defer: set `ctx.transaction.marks["<id>.<what>"]` and act once in `transaction.before.end` or `.after.end`.
- Read config with `ctx.settings`, data with `ctx.storage`, never by path. Never bake secrets into output.
- Declare what you touch: `capabilities`, `exec` commands (with `exec:run`), `privacy`, `staticCapable: false` when routes or server work are needed.
- Other plugins' hooks: list the definer in `dependencies` (hard) or `suggests` (soft; check `ctx.pluginEnabled(id)`).

## 4. Test

- Uncomment and complete the generated cases in `tests/cases/*.yaml` (`hook` or `operation` under test, given, when, then).
- Give cases a `run` block (a `call` or a `fire` plus `expect`) so they execute: `hax-plugin-test <folder>` (or `node harness/run-cases.mjs <folder>` from the spec repo) runs them in Node and PHP and fails if the two disagree. See `harness/README.md`.
- Add runtime unit tests (`tests/nodejs/*.test.mjs`) for logic worth testing directly.

## 5. Validate and hand off

- `hax plugin validate` (or `node scripts/validate.mjs <plugin folder>` from a clone of the spec repo). Fix every error; read every warning.
- Check the derived tags it prints (needs-server, runs-commands, sends-data-out, ...) match what you intended.
- Open a PR; never merge it yourself.

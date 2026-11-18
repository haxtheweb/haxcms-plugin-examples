# Spec changelog

Every change to the specification, schema or hook list is recorded here with an **upgrade recipe** and a **fixture**. This is what lets an agent bring an existing plugin forward and prove the result against the conformance suite.

Entry format:

```
## <spec version>
- Change: what changed and why
- Upgrade recipe: exact, mechanical steps for a plugin author or agent
- Fixture: path under tests/fixtures/ that fails before and passes after
```

## 0.1.0 (draft)
- Initial draft. No upgrade recipes needed yet.

### Choosing an importer on every surface (0.1.0 draft)
- Change: an implementer of a contract the caller chooses (`import.platform`) says what to ask for in its `implements` entry: `input` (url, upload, html, xml), `uploads` (file types for a picker) and optional `surfaces` (admin, cli, mcp). Both contributions responses carry `choices` for `admin`; the CLI and MCP list `cli` and `mcp`. A hidden plugin is never offered. Engines gain `contractImplementers(name, { surface })` and `contractChoices(surface)`; cases gain `choices` and `implementers: { name, surface }` steps.
- Upgrade recipe: a plugin that implements `import.platform` replaces `implements: [import.platform]` with `- { name: import.platform, input: [...] }`, listing the inputs its convert reads (`input.url` → url, `input.files` → upload, `input.html` → html, `input.xml` → xml) and, for file inputs, `uploads: [.ext]`. The validator now refuses a chosen implementer without `input`, and one that is `hidden`. A backend adds `choices` to its contributions responses and the `contractChoices` adapter method.
- Fixture: `conformance/fixtures/fx-chooser`, `fx-chooser-hidden` (plat-017, plat-018); `core-plugins/importer-hugo` (importer-hugo-004).

### Stacks of plugins and the log (0.1.0 draft)
- Change: spec/06 says how plugins stack and how to reach a plugin that may be off (a hook you define, a contract, or the log). Backends deliver log entries to `log.sink` implementers and have a log call for core.
- Upgrade recipe: nothing breaks. A plugin that wrote to the log to be seen should keep doing so; it now reaches the `log` plugin when that is on. A plugin that fired another plugin's hook never worked and still does not: define a contract in the plugin that should be called, or a hook in the plugin where the event happens.
- Fixture: `conformance/fixtures/fx-stack-mid`, `fx-stack-top`, `fx-log-sink` (hooks-021, hooks-022, hooks-023).

### Core events, the cli target and the targets check (0.1.0 draft)
- Change: both backends fire the file, site lifecycle, sign-in and git commit hooks (GAPS 1w lists exactly which and what is not applied). `cli` is a deployment target. `hax-plugin-check` gains a `targets` layer, and `hax-plugin-test` takes `--target`.
- Upgrade recipe: nothing breaks. A plugin whose `targets` lists every target should add `cli` if it is meant for the command line. Run `hax-plugin-check --only targets <plugin>` and read the row: a `full` target whose cases fail is a real problem; a `limited` one is a sentence to put in the plugin's description.
- Fixture: `conformance/fixtures/fx-core-events` (hooks-019, hooks-020); `conformance/cases/targets.yaml` (target-005).

### Outline saves as page events, and the served contract (0.1.0 draft)
- Change: an outline save and a bulk page create fire the page hooks for every page they add, change or remove, inside one bulk transaction whose origin is `saveOutline` or `createNode`; a veto refuses the whole request before anything is written (spec/06, Transactions). The contract of what plugins add is served at `.../plugins/openapi.json|yaml` and per plugin at `.../plugins/<id>/openapi.json|yaml` (spec/13 section 5).
- Upgrade recipe: nothing breaks. A plugin whose `page.before.save` or `page.before.delete` vetoes now also refuses outline saves that include the page; check that the veto message makes sense to someone reordering an outline. A plugin that does expensive work in `page.after.save` should mark and defer when `ctx.transaction.bulk` is true.
- Fixture: `conformance/cases/routes.yaml` (routes-010, routes-011); the outline behaviour is tested in each backend against `conformance/fixtures/fx-probe-a` and `fx-vetoer`.

### Secrets bound to hosts, from the pokeapi plugin (0.1.0 draft)
- Change: settings fields may carry `x-secret-egress` (a list of `egress` entries: hosts or `{ setting }`). `ctx.fetch` and `x-hax-proxy` refuse a request that carries a bound secret's value (URL, headers or body; as written, URL-encoded or base64) to any other host, on every redirect hop. The validator refuses entries not in `egress` and the key on non-secret fields, and warns when a secret could reach more than one egress host without it. The harness records request header names (never values) with each fetch, so cases can check where a key travelled. Shared front-end/back-end logic now lives under `frontend/dist/` instead of `src/shared/`, because only assets reach the browser. spec/05 names the three kinds of appstore provider (pack, proxy plugin, plugin with an operation).
- Upgrade recipe: nothing breaks; secrets without the key behave as before. For a plugin with a secret and more than one egress entry, add `"x-secret-egress": [<the entry the secret belongs to>]` to that field in `config/settings.schema.json`, copied exactly from `egress`, and run `hax plugin validate`. A plugin that kept a shared module in `src/shared/` moves it to `frontend/dist/` and imports it from the Node entry as `../../frontend/dist/<module>.js`.
- Fixture: `conformance/fixtures/fx-secret-host` (plat-011, plat-012) and `conformance/fixtures/fx-secret-bad` (plat-013); `contrib-plugins/pokeapi/tests/cases` (pokeapi-009: a mirror redirecting to an allowed host cannot take its key along).

### Enablement, registry and deployment targets (0.1.0 draft)
- Change: a plugin is enabled only when its scope's `enabled` list names it (or it is required or locked); otherwise it is `available` and loads no code. Core keeps that list in `_config/plugins/plugins.yaml`, serves a registry and answers `enable` / `disable` (spec/03). A backend says which target it is (`ctx.haxcms.target`: server, desktop, browser); needs are derived from the manifest and a plugin the target cannot run is inactive, one it half supports is limited (spec/14). New optional manifest key `targets`. Plugin YAML must read the same in both backends (spec/02 section 2.2). `enable`, `disable` and `settings` are reserved sub-paths.
- Upgrade recipe: run `hax plugin validate`. Quote any value inside `{ }` or `[ ]` that it reports. Rename an operation whose path starts with `/enable`, `/disable` or `/settings`. Nothing else changes for a plugin; a deployment enables the plugins it had by listing them under `enabled`.
- Fixture: `conformance/cases/targets.yaml`, `fx-server-only`; load-120 and load-121; the YAML, reserved-path and target rejections in `tests/check-examples.mjs`.

### OAuth and MCP during the 0.1.0 draft
- Change: new optional core plugin `oauth` (OAuth 2.1 authorization server) defining the `oauth.resource` contract; `mcp` now depends on it and implements `oauth.resource` instead of issuing its own tokens (`mcpTokenCreate`, `mcpTokenList`, `mcpTokenRevoke` and the `X-HAX-MCP-Token` header are gone). `ctx.plugins.list()` entries gain `implements`. New OpenAPI key `x-hax-well-known`.
- Upgrade recipe: a plugin that accepted MCP tokens directly does nothing; one that wants tokens for its own audience implements `oauth.resource` (`describe`, `check`) and lists `oauth` in `dependencies`. Read the verified grant from the `x-hax-oauth-grant` header, never from a client.
- Fixture: `core-plugins/oauth/tests/cases` with `harness/fixtures/demo-resource`; `core-plugins/mcp/tests/cases`.

### Renames during the 0.1.0 draft (for anyone who wrote against an earlier draft)
- Upgrade recipe: rename hook subscriptions and implementations: `rest.request` → `rest.before.request`; `rest.response` → `rest.after.request`; `plugin.requirements` → `plugin.before.requirements`; `register.routes|entities|contracts|prompts` → `register.before.*`; `render.head` → `render.before.head`; `render.content` → `render.before.content`; `render.body.start` → `render.before.body`; `render.body.end` → `render.after.body`; `schedule.run` → a `schedules` entry plus `schedule.before.run` / `schedule.after.run`; `output.alterHead` / `output.alterPage` → `render.before.head` / `render.after`. Remove `defaultEnabled`. Return `ctx.veto(message)` instead of `{ veto, message }`.
- Fixture: `examples/example` (regenerated from `schema/hook-contracts.json`).

### Additions from the first community plugins (0.1.0 draft)
- Change: `ctx.exec` (list-enforced, no shell, temp `files`); `privacy.consentSetting`; `staticFallback`; `optional` auth spelled `[{}, {bearerAuth: []}]`; response envelope rule (integer `status`, only `status`/`headers`/`body`); render context `mode`; hooks `user.before/after.export` and `user.before/after.erase`; save warnings returned to the caller.
- Upgrade recipe: a plugin that returns a record with `status` and `body` fields keeps working (it is now a plain value); one that relied on such a record being read as a response must return `{ status: <int>, body }`. Spawned commands should move to `ctx.exec(cmd, args)`; credential files go in `files` and are referenced as `{tmp}/<name>`. Nothing else changes for existing plugins.
- Fixture: `contrib-plugins/comments` (envelope, optional auth, erase hooks), `contrib-plugins/rsync-deploy` (exec), `contrib-plugins/plausible-analytics` (consentSetting), `contrib-plugins/a11y-check` (mode, save warnings).

### Additions from the second core batch (0.1.0 draft)
- Change: `x-hax-proxy` declarative operations; core moves `legacy.settings` on first enable; required settings fields are unmet requirements by core; `managedFiles` entries may carry `title`/`type` (advertised in llms.txt); `ctx.site.url`; `ctx.now()`; `entities.list("page", { listed: true })`; render context `cacheable`; core contracts `dispatch: all | chosen`; `import.platform` output `files`; category `publishing`.
- Upgrade recipe: delete `plugin.after.install` code that only copied a `legacy.settings` value and removed the old key, and the `site:*`/`settings:*` capabilities it needed. Delete `plugin.before.requirements` code that only checked a `required` settings field. Replace `Date.now()` / `time()` with `ctx.now()`. Filter pages for anything public with `{ listed: true }` instead of reading `published` yourself. Call `import.platform` with a chosen plugin.
- Fixture: `core-plugins/youtube` (proxy, legacy move, required field), `core-plugins/feeds` (listed, now, advertised files), `core-plugins/page-cache` (cacheable), `core-plugins/importer-wordpress` (chosen dispatch).

### Additions from the last community batches (0.1.0 draft)
- Change: hook `stages` (render.after: transform, seal, store); `egress` / `privacy.recipients` entries `{ setting }` and `{ any, reason }` with derived tags `admin-chosen-hosts` and `reaches-any-host`; dashboard `action.kind: tour` with fixed anchors; locale keys for declarative UI; `ctx.plugins.contract()`; `ctx.entityType`; `ctx.registries.theme()` and theme `colorSchemes`; `entities.yaml` `metadata.<type>.fields` and `form` for plugin fields on core records; no hook re-entry; schedules run as one bulk transaction.
- Upgrade recipe: a plugin that writes its own keys into a page's `metadata` moves them under `metadata.plugins.<id>` and declares them, or core drops them. A render.after subscriber that edits the document says `stage: transform`; one that stores it says `stage: store`. A plugin that sends data to admin-entered URLs replaces fixed hosts with `{ setting }`.
- Fixture: `conformance/cases/platform.yaml` (plat-001 to plat-010) and their `fx-*` fixtures.

### Additions during the 0.1.0 draft (round: importers and docblocks)
- Change: every hook, operation, contract operation, schedule and upgrade implementation needs a docblock whose first line is `Implements hook <name>.` (or operation, contract, schedule, upgrade), directly above it. README "What it implements" tables are generated from them.
- Upgrade recipe: run `node scripts/validate.mjs <plugin>`; for each "missing docblock" error add the block above the named function, then run `node scripts/plugin-docs.mjs <plugin>`.
- Fixture: `examples/example` (every hook carries one).
- Change: `open-media-apps` split into five contrib plugins; youtube, vimeo, giphy, unsplash and flickr are contrib (no `core: true`).
- Upgrade recipe: a deployment that enabled `open-media-apps` enables `appstore-nasa`, `appstore-sketchfab`, `appstore-dailymotion`, `appstore-wikipedia` and `appstore-cc-mixter` instead.
- Fixture: `contrib-plugins/appstore-nasa`.
- Change: new contract `import.file` (`dispatch: accepts`); `implements` entries may be objects `{ name, accepts }`.
- Upgrade recipe: a file importer that implemented `import.platform` with a file input switches to `import.file` and lists its extensions in `accepts`.
- Fixture: `core-plugins/import-markdown`.

### Additions from the Insights plan (0.1.0 draft)
- Change: admin contributions take `surface: dashboard | site`; site placements `siteMenu` and `slot` with slots `site-settings.panel`, `insights.section`, `insights.action`; `order`; action kind `run`; `GET /x/api/v1/plugins/contributions`; reserved plugin id `contributions`. Core contracts gain `dispatch: provides`, `implements` entries `{ name, provides }`, and `advertise: true`, listed as `contracts` in both contributions responses; new core contract `insights.check`. Transactions gain opt-in `atomic` (`x-hax-transaction: atomic`, `ctx.transaction.run(fn, { atomic: true })`). Shared front-end/backend logic goes in `src/shared/`.
- Upgrade recipe: nothing to change for existing plugins: `surface` defaults to `dashboard`, and transactions stay non-atomic unless asked. A plugin named `contributions` must be renamed. A plugin that rolled back its own partial writes by hand can declare `x-hax-transaction: atomic` on the operation and delete that code.
- Fixture: `conformance/cases/hooks.yaml` (hook-100 to hook-103, `conformance/fixtures/fx-atomic`), `contrib-plugins/link-checker` (link-checker-002), `examples/example/registries/dashboard/explosions-insights.yaml`.

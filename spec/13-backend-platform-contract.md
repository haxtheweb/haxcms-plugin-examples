# HAX backend platform contract

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

What every HAX backend (haxcms-nodejs, haxcms-php, and anything later) implements so plugins load and behave the same everywhere. It covers loading and running plugins on the **backend** only. How front-end assets (web components, themes) are produced is separate and already has its own tooling; the front end only receives what this contract serves.

A backend conforms when it passes the conformance cases (`conformance/`) and runs every example plugin's own cases through its adapter (section 9). The reference harness in `harness/` implements this contract in memory and is the executable form of this document: when the two disagree, fix one of them in the same change.

## 1. Where things live

| What | Node | PHP |
|---|---|---|
| Core plugins (tier 3) | `src/plugins/<id>/` | `system/plugins/<id>/` |
| System contrib (tier 4) | `<HAXCMS_ROOT>/_plugins/<id>/` | same |
| Site plugins (tier 5) | `<site>/_plugins/<id>/` | same |
| Deployment config: required, locked, blocked | `<HAXCMS_ROOT>/_config/plugins/plugins.yaml` | same |
| Lock config (installed version, source, range, tested, signed), per scope | `_config/plugins/plugins.yaml` in that scope | same |
| Plugin settings (CMI), system scope | `<HAXCMS_ROOT>/_config/plugins/config/<id>.json` | same |
| Plugin settings (CMI), site scope | `<site>/_config/plugins/config/<id>.json` | same |
| Secret settings (never in a site folder, never in git) | `<HAXCMS_ROOT>/_config/plugins/secrets/<id>.json`; site scope under `<HAXCMS_ROOT>/_config/siteData/<siteUuid>/plugins/<id>.secrets.json` | same |
| Data stores | spec/04 table (`site`, `siteData`, `system`, `manifest`, `package`) | same |

Core plugin folders are mirrored between the two backends (one folder per plugin with both `src/nodejs` and `src/php`). Work lands in Node first, then PHP passes the same cases.

## 2. Loader lifecycle

The loader runs at boot and again on any install, enable, disable, update or settings change that affects status ("rescan"). Each step either passes the plugin on or records a reason and leaves it out; one bad plugin never stops boot.

1. **Discover** plugin folders in every tier, lowest priority first (HAXiam core, HAXiam contrib, system core, system contrib, site). A higher tier wins a name collision, with a warning naming both versions.
2. **Read and validate** `plugin.yaml` against `schema/plugin.schema.json`, plus its referenced files. Unknown keys refuse the plugin. A `specVersion` newer than the backend supports refuses it with a version message.
3. **Apply deployment config**: `blocked` plugins are refused; `locked` and `required` plugins are enabled and cannot be disabled.
4. **Resolve relationships**: missing or out-of-range `dependencies` keep a plugin disabled with the reason; `conflicts` warn; `suggests` only inform.
5. **Order** enabled plugins: dependencies before dependents, then required first, then tier low to high, then id. This order is the "loading cascade" used everywhere below.
6. **Status**: run `plugin.before.requirements` / `plugin.after.requirements`; a plugin with unmet requirements is enabled but **inactive** and contributes nothing below until they are met.
7. **Load entries** of active plugins for the backend's runtime (section 3). A load error turns the plugin off (`failed`) with the error recorded.
8. **Register**, for each active plugin in cascade order: routes into the unified contract (section 5); entities and annotations; contracts and implementations; registries (themes, elements, skeletons, Merlin, appstore, locales, dashboard contributions, CLI commands, skills); hook subscriptions, with aliases expanded (section 6). Then fire `register.before.*` / `register.after.*`.
9. **Ready.** Serve. A disabled or inactive plugin is absent from every surface (spec/07, separation rule).

Install and enable additionally run, in order: the validator and `exec` scan (CLI only), upgrade steps when the version changed, `plugin.before.install` / `plugin.after.install` on the first enable in a scope, then `plugin.before.enable` / `plugin.after.enable`. A failure anywhere turns the plugin back off with the reason.

## 3. Entry points

**Node** (`entry.nodejs`, an ES module). The default export (or named exports) may contain:

```js
export default {
  operations: { [operationId]: async (ctx, request) => response },
  hooks:      { [hookName]:   async (ctx) => subject | undefined },
  // scheduled job handlers named in plugin.yaml `schedules`
  async tidy(ctx) {},
};
```

**PHP** (`entry.php`). The file defines one class, `<StudlyId>Plugin` (`announcements` → `AnnouncementsPlugin`, `data-store` → `DataStorePlugin`). Operations are public methods named exactly as the `operationId`; hooks are public methods named by camel-casing the hook (`page.before.save` → `pageBeforeSave`); schedule handlers are public methods named as in `schedules`. One instance per process.

Both runtimes keep logic in plain modules the entry calls (the announcements plugin does this), so the two can be compared call for call.

## 4. The context object (`ctx`)

Passed to every hook, operation and scheduled job. Node uses properties and methods as written; PHP uses the same names as properties (`$ctx->subject`) and methods (`$ctx->veto(...)`), with associative arrays for data.

| Member | Available in | What it is |
|---|---|---|
| `subject` | hooks | the thing the hook is about, per `schema/hook-contracts.json` |
| `previous` | hooks where the contract lists one | the stored version before the operation |
| `request` | `rest.after.request` | the request that produced the response |
| `target`, `format`, `upload` | `site.*.duplicate`, `site.*.export`, `file.before.save` | extra operation details |
| `veto(message, status = 409)` | before hooks | fail the whole operation with an error to the caller; returns a value the hook should return |
| `warn(message, severity = "warning")` | hooks, operations | collect a warning the UI can show; the operation continues |
| `respond(html)` | `render.before` | short-circuit the render with a finished document |
| `settings` | everywhere | the plugin's settings for the current scope, read-only; secret values are present server-side and never serialized to clients |
| `config.save(values, { scope })` | everywhere | write the plugin's own settings (an install migration moving a value out of `site.json`, for example); validated against its settings schema and run through `config.before.save` / `config.after.save` like any other save; `scope` follows `settingsScope` |
| `plugins.list()` / `plugins.skills(audience)` | everywhere | read-only list of active plugins (`{ id, version, privacy, capabilities, skills }`; how cookie consent knows whether any tracker is enabled), and the skills of active plugins for one audience with their files, read by core (how agent-skills publishes them) |
| `assets.url(path)` | everywhere | the URL of one of the plugin's own files under `frontend/dist`, valid on the live site and in a static publish (spec/07, assets) |
| `storage.read(storeId)` / `storage.write(storeId, value)` | everywhere | the plugin's own stores (spec/04); `package` stores are read-only; `siteData` stores resolve to the current site |
| `package.read(path, { binary })` / `package.list(folder)` | everywhere | read a file, or list files recursively, under the plugin's `data/` folder; refuses paths outside it |
| `files.writeManaged(path, content)` / `files.readManaged(path)` | everywhere | write a generated file into the site (service worker, discovery index); needs `output:managedFiles` and a path matching the manifest's `managedFiles` patterns (`*` within a folder, `**` across folders); one plugin owns each path |
| `haxcms` | everywhere | `{ version, runtime }` (`runtime` is `nodejs` or `php`) |
| `plugin` | everywhere | `{ id, version, scope }` of the running plugin |
| `site` | site-scope calls | `{ id, name, path }`, otherwise `null` |
| `user` | when a user is involved | the limited record (`id, name, displayName, roles, avatar`), the full record only with `users:full`, otherwise `null` |
| `log.info / .warn / .error(message, data?)` | everywhere | the unified log, tagged with plugin, hook or operation, and scope |
| `fetch(url, init)` | everywhere | outbound HTTP, only with `network:egress` to a host in `egress`. Node returns a standard `Response`; PHP returns `['status', 'headers', 'body', 'json']` (`json` is the decoded body or `null`) |
| `hooks.fire(name, subject, { previous })` | everywhere | fire a hook **this plugin defines** (`hookDefinitions`, or a core contract whose `definedBy` is this plugin, such as `git.*` for `git`); returns `{ subject, veto?, warnings }` after every subscriber ran. Core hooks are fired by the platform only |
| `entities.get(type, id?)` / `entities.list(type, query?)` / `entities.save(type, record)` | everywhere | core records outside the plugin's own stores: `site` (its `site.json`; `id` defaults to the current site), `page`, `file`, `config` (`core` is the core configuration, for moving settings such as API keys out of it), and entity types other plugins define. Reading needs the matching `:read` capability (`site:read`, `items:read` for pages, `files:read`, `settings:read` for config), saving the `:write` one. `save` runs the normal entity hooks (and their aliases) inside the current transaction, so a plugin's own changes are extended and vetoed like anyone else's; it returns `{ record, veto?, conflict? }`. A record that changed after this plugin read it is refused with `conflict: true` instead of overwriting the other change: re-read and save again |
| `pluginEnabled(id)` | everywhere | whether another plugin is enabled and active in this scope |
| `transaction` | everywhere | `{ id, origin, bulk, operations, marks, run(fn, { bulk, origin }) }` (spec/06, Transactions) |

There is no general process helper: a plugin with `exec:run` spawns only the commands in its `exec` list with the runtime's own API, and the validator checks the code for anything else.

### Upgrade steps

A plugin that changes its data shape between versions ships one step per version: a recipe in `migrations/<NNNN>-<name>.md` (for people and agents) and the code, as `upgrades: { "<version>": async (ctx) => {} }` in the Node entry and `upgrade_<major>_<minor>_<patch>($ctx)` methods in PHP. On a version change the loader runs, in version order, every step newer than the installed version and not newer than the new one, between `plugin.before.upgrade` and `plugin.after.upgrade`, inside one transaction; a throwing step turns the plugin off with the reason. Steps use the same `ctx` (stores, `entities` for data that used to live in `site.json`), and keep a read fallback to the old location so a site whose upgrade has not run still works.

## 5. Operations and the unified contract

- **Mounting.** Each operation mounts under `/x/api/v1/plugins/<id>/` (site scope, the default) or `/system/api/v1/plugins/<id>/` (`x-hax-scope: system`), from the plugin's `config/openapi.yaml`. Plugins cannot place routes elsewhere. Each plugin's document is also served at `.../plugins/<id>/openapi.json` and `.yaml`.
- **Before the handler runs**, the platform enforces `security` from the contract (both credentials when both are listed), the rate limit for `x-hax-public` operations, and validates parameters and body against the schema. A handler never sees a request that fails these.
- **Handler signature.** `(ctx, request)` where `request` is `{ params, query, body, headers, files }`.
- **Response.** Return `{ status, headers?, body }`, or a plain value meaning `200` with that body. `body` may be bytes for binary responses.
- **Errors.** A thrown error becomes `500` with a generic message; the detail goes to the log only. A veto from a hook inside the operation becomes its status (default `409`) with the veto message.
- **Front end.** Every operation is callable from the dashboard as `@system/<operationId>` or `@site/<operationId>`, registered from the contract.

## 6. Hook dispatch

- **Subscriptions** come from `hooks` in `plugin.yaml`. An alias (core or plugin-defined) expands to its targets with their `entities` and `changed` filters; the plugin still receives it under the name it subscribed with, and it fires once per operation.
- **Order**: `priority` (higher first, default 0), then the loading cascade.
- **Calling**: the platform calls the hook with `ctx`. A returned value replaces the subject for the next hook after validation against the contract's subject schema; an invalid return is discarded and logged; returning nothing leaves the subject as it is. Fields a plugin adds to a schema it did not declare in `entities` are discarded with a warning. When a later hook overwrites a field an earlier hook set, the change stands and a warning names both plugins.
- **Veto** (before hooks only) stops the chain and fails the operation.
- **Errors and timeouts**: a thrown error or a timeout (before hooks 5 s by default, up to 30 s with `timeout`; detached after hooks 60 s) is logged and the chain continues with the previous subject. `detached: true` after hooks run after the response is sent; they are refused where the contract says they cannot detach.
- **Config hooks while inactive.** A plugin's own `config.*` hooks run even while it is inactive, so it can validate the setting that would activate it.
- **Every** discard, warning, veto, timeout and error updates the plugin's health counters (the dashboard chip) and goes to the log plugin when it is enabled.

## 7. Settings and secrets

`ctx.settings` is assembled from the plugin's settings schema defaults, then the system-scope file, then the site-scope file (site wins), then secrets from the secrets file. Writes go through `config.before.save` / `config.after.save` and are validated against the settings schema; secret values are write-only through every API and CLI. `plugin.before.requirements` is re-run after every save.

## 8. What the backend serves for other surfaces

- `GET /system/api/v1/plugins`: the plugin list (status, health, derived tags, dependents, conflicts).
- `GET /system/api/v1/plugins/contributions`: dashboard contributions, Merlin declarations, `admin` elements and locale overlays from active plugins. Both credentials.
- The site's appstore payload and `wc-registry.json` include plugin fragments at rebuild time (spec/07).
- `.well-known/agent-skills` includes active plugins' `site` (per site) and `system` (system front end) skills at rebuild.
- The CLI, which embeds the Node backend in-process, reads `registries/cli/` of active plugins.

## 8a. Byte-identical output

Files a plugin generates (managed files, JSON it serves) must be byte-identical between backends, so digests and caches agree: JSON with two-space indentation (PHP's `JSON_PRETTY_PRINT` uses four, so re-indent), slashes and Unicode unescaped, LF line endings, a trailing newline for files. The agent-skills plugin's parity test caught this.

## 9. Proving conformance

- **Adapter interface.** A backend is tested through an adapter that can: load a set of plugin folders with given settings and enabled scopes; call an operation by id with a request; fire a hook with a subject; report the plugin list and status. The in-memory reference adapter in `harness/` implements it; each backend repo adds its own adapter (Node in-process; PHP through a small CLI bridge) and runs the same cases.
- **Cases.** Spec conformance cases (`conformance/cases/*.yaml`) describe platform behavior. Plugin test cases (`tests/cases/*.yaml` in each plugin) may carry a machine-readable `run` block (schema in `schema/test-case.schema.json`) that any adapter executes.
- **Parity.** For plugins with code in both runtimes, the same executable cases run through the Node and PHP adapters and must give the same results.

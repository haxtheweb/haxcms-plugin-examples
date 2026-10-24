# Hooks and provider contracts

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Hooks and provider contracts

### 6.1 Hooks (current list; open vocabulary)
Every lifecycle has a before hook and an after hook. **Before** hooks run before the system works with the thing and may modify input, veto, or warn. **After** hooks run after the system has worked and may annotate output, react, or warn; they cannot veto. Plugins declare subscriptions in the manifest, so unsubscribed hooks cost nothing. The comprehensive example implements every hook below, even if the body is a console log or a comment about what could be done there.

Every hook, its subject, its previous value and what it returns are listed in **Hook contracts** below (generated from `schema/hook-contracts.json`). Every operation has a before and an after hook: before hooks see the thing about to be worked on, after hooks see it after the operation.

Semantics:
- Chains run in order: `priority` (higher first, default 0), then the loading cascade (see Ordering).
- A modifying hook's output is validated against the concrete entity's schema, including a parent's required fields. An invalid result is discarded and logged, and the chain continues with the previous data. A plugin may only add fields to a schema it defines: it must declare in its `entities` the schema it extends, otherwise the added fields are warned about and discarded. A veto returns an error to the caller (status and message) and fails the whole operation. Warnings carry a severity and messages the UI can show.
- A hook error is logged and does not crash the operation, except an explicit veto. Every discard, warning, veto, timeout and hook error, including from detached after hooks, is written to the plugin log and surfaced as plugin health to the one unified log, in a standard server log style: time, level (info, warn, error), plugin id, hook or operation, scope (system or a site id), message, optional subject reference. Hooks write to the same log through `ctx.log`; a plugin wanting a log of its own for another purpose keeps it in its own storage. Any warn or error entry sets a status on the plugin, shown as a chip on the dashboard and at login that leads to the plugin and the log. The log is a plugin. That plugin is a system-level, optional-enable plugin with one log page covering site and system scope. It keeps 500 messages by default and rotates monthly; message count and rotation period are settings in its CMI config. Plugins without it enabled still show the health badge from in-memory state (see GAPS.md item 12).
- Timeouts: a **before** hook runs in the save path and defaults to 5 seconds (a manifest `timeout`, up to 30 seconds, can raise it for one hook). An **after** hook is an event that follows the operation. It runs inline by default with the same limit so later hooks and the caller see its changes; a hook that does slow work (for example an rsync after `git.after.commit`) declares `detached: true` in the manifest, runs after the response is sent, and gets 60 seconds. There is no emergency disable-all switch: a disabled plugin already removes its hooks.
- When a later hook in a chain changes a field an earlier hook set, the change stands and the loader logs a warning naming both plugins.
- Hooks stay opt-in; core routes cannot be broken, only extended through these points.

### 6.2 Provider contracts
A plugin defines a contract in `config/contracts.yaml` (name, required operations or functions per runtime, data shapes). Other plugins `implement` it and `depend` on the defining plugin, and the loader validates that the implementer follows the contract. The defining plugin lists and calls the enabled implementers. Contracts are namespaced by their owner (`authproviders.provider`, `views.source`, `consent.subject`). The first-party mechanism ships now; specific contracts such as import, export, search, spam and mail are added later. The auth provider contract is usable only from the highest-order context (section 3).

### The context object (`ctx`)
`ctx` is short for **context**: the one argument every hook receives. It carries the `subject` (below), `previous` on update, and helpers from the host:

- `ctx.veto(message)`: stop the chain and fail the operation with the message (before hooks only)
- `ctx.warn(message)`: collect a warning that the UI can show; the operation continues
- `ctx.settings`, `ctx.storage`, `ctx.log`: the plugin's own settings (CMI), data stores and log
- `ctx.pluginEnabled(id)`: whether another plugin is enabled and active in this scope; how a plugin uses an optional companion (listed in `suggests`) and skips the feature quietly when it is absent
- `ctx.fetch`: guarded outbound request (needs `network:egress` and a declared host)
- `ctx.respond(html)`: `render.before` only; short-circuit the render with a ready document (cache hit)

### Return contract
A hook **returns the updated subject**. Returning nothing leaves the subject unchanged, and an in-place change is tolerated where the language allows it, but returning is the contract because PHP arrays are copied on assignment and would otherwise lose the change. The loader validates a returned subject against the concrete schema; an invalid one is discarded and logged. Side-effect-only hooks return nothing.

```js
"entity.before.update": async (ctx) => {
  const item = ctx.subject;
  item.fields.fireworks = true;
  if (item.name === "boring.awesome") return ctx.veto("Too boring");
  if (item.name.length > 60) ctx.warn("Long file name");
  return item;
}
```

### Render pipeline
Stages run in order for a dynamic page and again at static publish: `render.before` (render context; may return `ctx.respond(html)` for a cached document), `render.before.head` / `render.after.head` (head tags, slim CSS variables), `render.before.content` / `render.after.content` (the content before and after it is placed in the shell: a server-side rendering plugin renders custom elements to HTML in the before hook), `render.before.body` (markup right after the opening body tag), `render.after.body` (scripts and injected singletons at the end of the body; the hook writes the singleton with values from its own settings baked into the output, so the client never reads server settings), `render.after` (the final document: a caching plugin stores it here to serve on the next request or for publishing; it invalidates on the `page.*` and `manifest.*` save hooks or by expiry). Secrets must never be baked into output; audit warns when a plugin has both `settings:secret` and `output:inject`.

### Hook contracts
A hook receives a context whose `subject` is the thing the hook is about, at that moment, by reference; `previous` is the stored version before the operation where one exists. A hook returns the updated subject ("Returns"); returning nothing leaves it unchanged. Only before hooks can veto. After hooks run inline unless the subscription sets `detached: true`, which is refused where the caller waits for the result ("Can detach: no"). Extending entities fire parent first, with the concrete type in context. Page and manifest saves run their own hooks in addition to the entity hooks for the same record. An after hook's change to the subject changes what the caller gets back, not the stored record.

<!-- hook-table:start (generated by scripts/hook-table.mjs from schema/hook-contracts.json; do not edit by hand) -->
| Hook | Fires when | `ctx.subject` | `ctx.previous` | Returns | Can veto | Can detach |
|---|---|---|---|---|---|---|
| `entity.before.create` | an entity is about to be created (any entity type the subscription lists) | the entity record: `{ id, type, ...fields, ext: { <plugin>: {...} } }` as submitted | none | the record (may change it) | yes | n/a |
| `entity.after.create` | the entity was created and stored | the entity record: `{ id, type, ...fields, ext: { <plugin>: {...} } }` as stored, with its new `id` | none | the record as the caller receives it (annotations); the store is not rewritten | no | yes |
| `entity.before.read` | an entity or list is about to be read | `{ type, id?, query }` (what is being asked for) | none | the request (narrow a query, add filters) | yes | n/a |
| `entity.after.read` | the entity or list was loaded | the record, or `{ items: [records], total }` for a list, with `ext.<plugin>` annotations | none | the record or list as the caller receives it (annotate, redact) | no | no |
| `entity.before.update` | an entity is about to be updated | the entity record: `{ id, type, ...fields, ext: { <plugin>: {...} } }` with the submitted changes merged | the stored record | the record (may change it) | yes | n/a |
| `entity.after.update` | the update was stored | the entity record: `{ id, type, ...fields, ext: { <plugin>: {...} } }` as stored | the record before the update | the record as the caller receives it | no | yes |
| `entity.before.delete` | an entity is about to be deleted | the stored record | none | nothing | yes | n/a |
| `entity.after.delete` | the entity was deleted | the record as it was before deletion | none | nothing | no | yes |
| `page.before.save` | page content or metadata is about to be written (editor save, CLI, import) | the page: `{ id, siteId, title, location, slug, parent, order, content, metadata }` as submitted | the stored page | the page (may change content or metadata) | yes | n/a |
| `page.after.save` | the page was written to disk | the page: `{ id, siteId, title, location, slug, parent, order, content, metadata }` as written | the page before the save | nothing (the file is already written) | no | yes |
| `manifest.before.save` | site.json is about to be written (outline change, settings save, theme change) | the site manifest: the full `site.json` object (`{ id, title, author, metadata, items: [...] }`) as it will be written | the stored manifest | the manifest (may change it) | yes | n/a |
| `manifest.after.save` | site.json was written | the site manifest: the full `site.json` object (`{ id, title, author, metadata, items: [...] }`) as written | the manifest before the save | nothing | no | yes |
| `config.before.read` | a plugin's configuration is about to be read (subscription `config` list decides whose) | `{ plugin, scope, siteId?, keys? }` | none | the request | yes | n/a |
| `config.after.read` | the configuration was loaded | `{ plugin, scope, siteId?, values }` (the plugin whose config it is, system or site scope, the settings values); secret values are already redacted | none | the values as the caller receives them | no | no |
| `config.before.save` | configuration is about to be written (dashboard, `hax plugin config set`, install migration) | `{ plugin, scope, siteId?, values }` (the plugin whose config it is, system or site scope, the settings values) as submitted | the stored values | the values (may normalize them) | yes | n/a |
| `config.after.save` | configuration was written; requirements are re-evaluated after this | `{ plugin, scope, siteId?, values }` (the plugin whose config it is, system or site scope, the settings values) as written | the values before the save | nothing | no | yes |
| `git.before.commit` | HAXcms is about to make a git commit for a site (after a page or manifest save) | `{ siteId, message, files: [paths], author }` | none | the commit (adjust the message or add files) | yes | n/a |
| `git.after.commit` | the commit was made | `{ siteId, hash, message, files: [paths], author }` | none | nothing | no | yes |
| `rest.before.request` | a request to a plugin or core route is about to reach its handler | the request: `{ method, path, operationId, headers, query, body, user? }` | none | the request (may change headers, query or body) | yes | n/a |
| `rest.after.request` | the handler produced a response, before it is sent | the response: `{ status, headers, body }`, with the request in ctx.request | none | the response (add headers, trim fields) | no | no |
| `plugin.before.requirements` | status is being calculated (enable, settings save, dashboard load) | the list of unmet requirements so far: `[{ key, message }]` | none | the list with this plugin's own unmet requirements added | no | n/a |
| `plugin.after.requirements` | the requirements list is final and status is set | `{ id, scope, siteId?, status, unmet: [{ key, message }] }` | the previous status | nothing | no | yes |
| `plugin.before.install` | about to install (runs once, the first time the plugin is enabled in a scope) | `{ id, version, scope, siteId? }` (the plugin changing state) | none | nothing | yes | n/a |
| `plugin.after.install` | install finished | `{ id, version, scope, siteId? }` (the plugin changing state) | none | nothing | no | yes |
| `plugin.before.enable` | about to enable (runs every time the plugin is enabled in a scope) | `{ id, version, scope, siteId? }` (the plugin changing state) | none | nothing | yes | n/a |
| `plugin.after.enable` | enable finished | `{ id, version, scope, siteId? }` (the plugin changing state) | none | nothing | no | yes |
| `plugin.before.disable` | about to disable (runs when the plugin is disabled in a scope; data is kept) | `{ id, version, scope, siteId? }` (the plugin changing state) | none | nothing | yes | n/a |
| `plugin.after.disable` | disable finished | `{ id, version, scope, siteId? }` (the plugin changing state) | none | nothing | no | yes |
| `plugin.before.uninstall` | about to uninstall (runs when the plugin is uninstalled after disable; its data is purged) | `{ id, version, scope, siteId? }` (the plugin changing state) | none | nothing | yes | n/a |
| `plugin.after.uninstall` | uninstall finished | `{ id, version, scope, siteId? }` (the plugin changing state) | none | nothing | no | yes |
| `plugin.before.upgrade` | about to upgrade (runs when a newer version is installed, around its upgrade steps) | `{ id, version, scope, siteId? }` (the plugin changing state) | the installed version | nothing | yes | n/a |
| `plugin.after.upgrade` | upgrade finished | `{ id, version, scope, siteId? }` (the plugin changing state) | the installed version | nothing | no | yes |
| `site.before.create` | a site is about to be created | the site summary: `{ id, name, title, path, theme, owner }`; a skeleton or import can be adjusted in the before hook | none | the site summary (may change it) | yes | n/a |
| `site.after.create` | the site was created | the site summary: `{ id, name, title, path, theme, owner }` as it is after the operation | none | nothing | no | yes |
| `site.before.duplicate` | a site is about to be duplicated | the site summary: `{ id, name, title, path, theme, owner }`; subject is the source site; ctx.target is the new one | none | the site summary (may change it) | yes | n/a |
| `site.after.duplicate` | the site was duplicated | the site summary: `{ id, name, title, path, theme, owner }` as it is after the operation | none | nothing | no | yes |
| `site.before.archive` | a site is about to be archived | the site summary: `{ id, name, title, path, theme, owner }` | none | the site summary (may change it) | yes | n/a |
| `site.after.archive` | the site was archived | the site summary: `{ id, name, title, path, theme, owner }` as it is after the operation | none | nothing | no | yes |
| `site.before.delete` | a site is about to be deleted | the site summary: `{ id, name, title, path, theme, owner }` | none | the site summary (may change it) | yes | n/a |
| `site.after.delete` | the site was deleted | the site summary: `{ id, name, title, path, theme, owner }` as it is after the operation | none | nothing | no | yes |
| `site.before.export` | a site is about to be exported | the site summary: `{ id, name, title, path, theme, owner }`; ctx.format names the export format | none | the site summary (may change it) | yes | n/a |
| `site.after.export` | the site was exported | the site summary: `{ id, name, title, path, theme, owner }` as it is after the operation | none | nothing | no | yes |
| `user.before.login` | a user is about to login | the user: a limited record `{ id, name, displayName, roles, avatar }` by default; the full record (email and profile fields, never the password or tokens) only with the `users:full` capability | none | nothing | yes | n/a |
| `user.after.login` | the user login finished | the user: a limited record `{ id, name, displayName, roles, avatar }` by default; the full record (email and profile fields, never the password or tokens) only with the `users:full` capability | none | nothing | no | yes |
| `user.before.logout` | a user is about to logout | the user: a limited record `{ id, name, displayName, roles, avatar }` by default; the full record (email and profile fields, never the password or tokens) only with the `users:full` capability | none | nothing | yes | n/a |
| `user.after.logout` | the user logout finished | the user: a limited record `{ id, name, displayName, roles, avatar }` by default; the full record (email and profile fields, never the password or tokens) only with the `users:full` capability | none | nothing | no | yes |
| `register.before.routes` | the platform is collecting OpenAPI paths contributed by plugins | the list collected so far | none | the list with this plugin's additions | no | n/a |
| `register.after.routes` | the routes list is complete | the merged list from every plugin | none | nothing | no | no |
| `register.before.entities` | the platform is collecting entity definitions | the list collected so far | none | the list with this plugin's additions | no | n/a |
| `register.after.entities` | the entities list is complete | the merged list from every plugin | none | nothing | no | no |
| `register.before.contracts` | the platform is collecting contract implementations | the list collected so far | none | the list with this plugin's additions | no | n/a |
| `register.after.contracts` | the contracts list is complete | the merged list from every plugin | none | nothing | no | no |
| `register.before.prompts` | the platform is collecting prompts (seeded from docs/prompts.yaml) for the plugin screen and the MCP plugin | the list collected so far | none | the list with this plugin's additions | no | n/a |
| `register.after.prompts` | the prompts list is complete | the merged list from every plugin | none | nothing | no | no |
| `render.before` | a page is about to be rendered (live request or static publish) | the render context: `{ site, page, theme, head: [tags], content, body: { start: [], end: [] }, html }`, filled in as the stages progress; only site, page and theme are set | none | the context, or `ctx.respond(html)` to short-circuit with a cached document | yes | n/a |
| `render.before.head` | the head is about to be assembled | the render context: `{ site, page, theme, head: [tags], content, body: { start: [], end: [] }, html }`, filled in as the stages progress | none | the context (add to head) | no | n/a |
| `render.after.head` | the head is assembled | the render context: `{ site, page, theme, head: [tags], content, body: { start: [], end: [] }, html }`, filled in as the stages progress; head is final | none | the context | no | no |
| `render.before.content` | the page content is about to be placed in the shell | the render context: `{ site, page, theme, head: [tags], content, body: { start: [], end: [] }, html }`, filled in as the stages progress; content is the stored page HTML | none | the context (replace or transform content) | no | n/a |
| `render.after.content` | the content is placed | the render context: `{ site, page, theme, head: [tags], content, body: { start: [], end: [] }, html }`, filled in as the stages progress; content is final | none | the context | no | no |
| `render.before.body` | right after the opening body tag | the render context: `{ site, page, theme, head: [tags], content, body: { start: [], end: [] }, html }`, filled in as the stages progress | none | the context (push to body.start) | no | n/a |
| `render.after.body` | right before the closing body tag | the render context: `{ site, page, theme, head: [tags], content, body: { start: [], end: [] }, html }`, filled in as the stages progress | none | the context (push to body.end) | no | no |
| `render.after` | the document is complete | the render context: `{ site, page, theme, head: [tags], content, body: { start: [], end: [] }, html }`, filled in as the stages progress; html is the final document | none | the context (may change html) | no | no |
| `rebuild.before` | managed files are about to be regenerated (registries, page shells, static output) | `{ scope, siteId?, reason }` | none | nothing | yes | n/a |
| `rebuild.after` | managed files were regenerated | `{ scope, siteId?, reason, files: [paths] }` | none | nothing | no | yes |
| `schedule.before.run` | a scheduled job is about to run (from `hax plugin schedule run` or the timer plugin) | `{ job, plugin, scope, siteId?, lastRun }` | none | nothing | yes | n/a |
| `schedule.after.run` | the scheduled job finished | `{ job, plugin, scope, siteId?, ok, durationMs, error? }` | none | nothing | no | yes |
<!-- hook-table:end -->

### `install` versus `enable`
`plugin.before.install` / `plugin.after.install` fire the **first time** a plugin is enabled in a scope (a site, or the system). `enable` fires on every enable. Moving a setting from core into a plugin is the install hook's job: it reads the old value (for example from `site.json`), writes it to the plugin's settings, and the setting leaves the global form. Sites that already had the plugin enabled are covered by `upgrade`.

## Ordering

Plugins on the same hook run by `priority` (higher first; every subscription defaults to 0), then by the plugin loading cascade (required plugins first, then tier low to high, then alphabetical). Ordering conflicts are expected to be rare.

## Requirements

`plugin.before.requirements` runs before install and whenever status is recalculated (enable, settings save, dashboard load). Its subject is the list of unmet requirements so far; a hook returns the list with its own entries added (`{ key, message }`). `plugin.after.requirements` then sees the final list and the resulting status. A plugin with unmet requirements is **enabled but not active**: its hooks, routes and registries do not run until the list is empty. Required settings and the presence of a companion plugin are the common cases.

## Configuration hooks

Plugin configuration (CMI) is on its way to being an entity like any other piece of core. `config.before.read`, `config.after.read`, `config.before.save` (validate, normalize or veto) and `config.after.save` (react, such as clearing a cache) fire for settings reads and writes from the dashboard, the CLI (`hax plugin config set`) or an install migration. A subscription's `config` list picks whose config it sees: omitted means the plugin's own; plugin ids for specific others (a plugin adjusting itself when another's setting changes); `["*"]` for every config read and write (a backup or audit plugin; uncommon, and read hooks on `*` are costly). The subject is `{ plugin, scope, values }` with `ctx.previous` holding the old values. `plugin.before.requirements` is re-evaluated after every save, so a plugin waiting on a setting activates as soon as it is set.

## Disable cleanup

On disable, core clears render caches and rebuilds managed outputs (registries, page shells, static files) without the plugin. Anything else the plugin set up is its own to tear down in `plugin.before.disable` / `plugin.after.disable`, and to set up again in the enable hooks. Data is kept until uninstall.

## Scheduled jobs

The preferred runner is the CLI from system cron: `hax plugin schedule run [--site]` runs the due jobs declared in each plugin's `schedules` (id, cron, handler, scope) once, each wrapped by `schedule.before.run` and `schedule.after.run`, and exits, with a lock so overlapping runs skip. For hosts without cron, an optional plugin can drive the same runner from page requests and a timer (like Drupal's automated cron). Jobs are idempotent, time-bounded and logged. A statically published site runs no schedules.

## User records

User hooks and the `users:read` capability get a limited record: `{ id, name, displayName, roles, avatar }`. The full record (email and profile fields) needs the `users:full` capability, which shows as the derived tag `full-user-records` and in the scopes the dashboard asks the admin to accept. Passwords, password hashes and tokens are never exposed to plugins. A plugin with `users:full` must implement the `privacy.export` and `privacy.delete` contracts for anything it keeps outside `personalData` stores (core already exports and erases those by user id).

## API versions

Plugin operations are mounted once, under `/v1/plugins/<id>/`. These are emerging APIs without breaking changes, so there is a single version; agent-driven upgrades keep callers in step.

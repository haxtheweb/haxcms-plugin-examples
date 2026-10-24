# Hooks and provider contracts

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Hooks and provider contracts

### 6.1 Hooks (current list; open vocabulary)
Every lifecycle has a before hook and an after hook. **Before** hooks run before the system works with the thing and may modify input, veto, or warn. **After** hooks run after the system has worked and may annotate output, react, or warn; they cannot veto. Plugins declare subscriptions in the manifest, so unsubscribed hooks cost nothing. The comprehensive example implements every hook below, even if the body is a console log or a comment about what could be done there.

| Group | Hooks |
|---|---|
| Page and manifest | `page.before.save`, `page.after.save`, `manifest.before.save`, `manifest.after.save` |
| Git | `git.before.commit`, `git.after.commit` (HAXcms commits after an item or manifest save; for example rsync to a remote server afterwards) |
| Entity operations | `entity.before.create`, `.read`, `.update`, `.delete` and `entity.after.create`, `.read`, `.update`, `.delete`, subscribed by entity type |
| REST | `rest.request` (before processing), `rest.response` (before sending; skipped for streams) |
| Plugin lifecycle | `plugin.before.install`, `.enable`, `.disable`, `.uninstall`, `.upgrade` and the matching `plugin.after.*`; the after hooks are also how a plugin observes another plugin |
| Site lifecycle | `site.before.create`, `.duplicate`, `.archive`, `.delete`, `.export` and the matching `site.after.*` |
| User | `user.before.login`, `.logout` and `user.after.login`, `.logout` |
| Registration (boot) | `register.routes`, `register.entities`, `register.contracts` |
| Render | `render.before`, `render.head`, `render.content`, `render.body.start`, `render.body.end`, `render.after` (the page render pipeline; static publish runs the same stages) |
| Managed files | `rebuild.before`, `rebuild.after` |
| Schedule | `schedule.run` (hook defined; runner reserved) |

Semantics:
- Chains run in order: required plugins first, then tier low to high, then `priority` (default 0), then alphabetical.
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
Stages run in order for a dynamic page and again at static publish: `render.before` (render context; may return `ctx.respond(html)` for a cached document), `render.head` (head tags, slim CSS variables), `render.content` (the assembled content before it is placed in the shell: where a server-side rendering plugin renders custom elements to HTML), `render.body.start`, `render.body.end` (scripts and injected singletons at the bottom of the body; the hook writes the singleton with values from its own settings baked into the output, so the client never reads server settings), `render.after` (the final document: a caching plugin stores it here to serve on the next request or for publishing; it invalidates on the `page.*` and `manifest.*` save hooks or by expiry). Secrets must never be baked into output; audit warns when a plugin has both `settings:secret` and `output:inject`.

### Hook subject (context)
A hook receives a context whose `subject` is the thing the hook is about, at that moment, **by reference**:

| Hooks | Subject |
|---|---|
| `entity.before.create`, `.update` | the entity being saved |
| `entity.before.read` | the query or id being loaded (the entity does not exist yet) |
| `entity.after.read` | the loaded entity |
| `entity.before.delete`, `.after.delete` | the entity being deleted |
| `page.*`, `manifest.*` | the page, the manifest |
| `git.*` | the commit (files changed, message) |
| `plugin.*` | the plugin object |
| `site.*` | the site |
| `user.*` | the user |
| `rest.request`, `rest.response` | the request, the response |

Extending entities fire parent first, with the concrete type in context. Page and manifest saves also run their own hooks in addition to the entity hooks for the same record.

Because the subject is passed by reference, **before and after hooks may both change it**: a before hook adjusts what is about to be written (or vetoes); an after hook adjusts what the caller gets back (annotations, derived fields) or reacts to what was written. An after hook's change to the subject does not rewrite the stored record. Context also carries the `previous` version of the subject on update, so a hook can diff before and after.

Veto and warning shapes are settled above; the exact fields of each subject still need a per-hook specification; see GAPS.md.

### `install` versus `enable`
`plugin.before.install` / `plugin.after.install` fire the **first time** a plugin is enabled in a scope (a site, or the system). `enable` fires on every enable. Moving a setting from core into a plugin is the install hook's job: it reads the old value (for example from `site.json`), writes it to the plugin's settings, and the setting leaves the global form. Sites that already had the plugin enabled are covered by `upgrade`.

## Ordering

Plugins on the same hook run by `priority` (higher first; every subscription defaults to 0), then by the plugin loading cascade. Ordering conflicts are expected to be rare.

## Requirements

`plugin.requirements` runs before install and whenever status is recalculated (enable, settings save, dashboard load). Its subject is the list of unmet requirements so far; a hook returns the list with its own entries added (`{ key, message }`). A plugin with unmet requirements is **enabled but not active**: its hooks, routes and registries do not run until the list is empty. Required settings and the presence of a companion plugin are the common cases.

## Configuration hooks

Plugin configuration (CMI) is on its way to being an entity like any other piece of core. `config.before.save` (validate, normalize or veto) and `config.after.save` (react, such as clearing a cache) fire for every settings write from the dashboard, the CLI (`hax plugin config set`) or an install migration. The subject is `{ plugin, scope, values }` with `ctx.previous` holding the old values. `plugin.requirements` is re-evaluated after every save, so a plugin waiting on a setting activates as soon as it is set.

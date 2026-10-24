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
| Output | `output.alterHead`, `output.alterPage` (head and body injection), `rebuild.before`, `rebuild.after` (managed files) |
| Schedule | `schedule.run` (hook defined; runner reserved) |

Semantics:
- Chains run in order: required plugins first, then tier low to high, then `priority` (default 0), then alphabetical.
- A modifying hook's output is validated against the concrete entity's schema, including a parent's required fields. An invalid result is discarded and logged, and the chain continues with the previous data. A veto returns an explicit status and message. Warnings carry a severity and messages the UI can show.
- A hook error is logged and does not crash the operation, except an explicit veto. A per-hook timeout stops a hung hook. `HAXCMS_DISABLE_HOOKS=1` disables optional plugins' hooks as an emergency escape.
- Hooks stay opt-in; core routes cannot be broken, only extended through these points.

### 6.2 Provider contracts
A plugin defines a contract in `config/contracts.yaml` (name, required operations or functions per runtime, data shapes). Other plugins `implement` it and `depend` on the defining plugin, and the loader validates that the implementer follows the contract. The defining plugin lists and calls the enabled implementers. Contracts are namespaced by their owner (`authproviders.provider`, `views.source`, `consent.subject`). The first-party mechanism ships now; specific contracts such as import, export, search, spam and mail are added later. The auth provider contract is usable only from the highest-order context (section 3).

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

The exact fields of each subject and the return shapes (veto, warnings) still need a per-hook specification; see GAPS.md.

### `install` versus `enable`
`plugin.before.install` / `plugin.after.install` fire the **first time** a plugin is enabled in a scope (a site, or the system). `enable` fires on every enable. Moving a setting from core into a plugin is the install hook's job: it reads the old value (for example from `site.json`), writes it to the plugin's settings, and the setting leaves the global form. Sites that already had the plugin enabled are covered by `upgrade`.

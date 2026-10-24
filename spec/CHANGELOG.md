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

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

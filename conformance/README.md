# Conformance suite

Language-neutral cases every backend must pass before it counts as plugin-supporting. Each case states the rule in prose (`given`, `when`, `then`); cases with a `run` block are also executable.

```yaml
- id: hooks-001
  title: "before hooks may veto with a message"
  spec: spec/06-hooks-and-contracts.md      # section the case enforces (file must exist)
  given: "example vetoes boring.awesome"
  when: "create awesomeFile named boring.awesome"
  then: "rejected with the message"
  run:
    plugins: [fx-notes, fx-probe-a]          # fixture names (conformance/fixtures/) or repo paths; { path, tier } for tiers
    load: { settings: { fx-probe-a: { entity.before.create: veto } }, disabled: [], blocked: [] }
    steps:
      - fire: { hook: entity.before.create, entity: note, subject: { title: Hi } }
        expect: { veto: true, message: "fx-probe-a says no" }
```

Steps: `call` (operation, params, query, body, credentials), `fire` (hook, subject, previous, entity, transaction), `render` (page), `enable`, `disable`, `config` (plugin, values), `transaction` (nested steps). A case may instead `validate` a fixture folder and expect validator `errors`. `expect` keys are shared with plugin test cases (`harness/expect.mjs`): `status`, `body`, `subject`, `absent`, `contains`, `notContains`, `veto`, `message`, `marks`, `cached`, `status_of`, and `log` (`contains`, `notContains`, `order`, `count`).

Run: `node conformance/run.mjs` (part of `npm test`). It runs against the in-memory reference harness (`harness/`); a backend runs the same cases through its own adapter (spec/13 section 9). Every executable case was checked by breaking the matching rule in the harness and watching it fail.

Rule: a new hook or extension point adds cases here and an implementation in `examples/example` in the same change. Every spec change that alters behavior adds a case that fails before and passes after, and an entry in `spec/CHANGELOG.md`.

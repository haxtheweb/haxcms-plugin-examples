# Conformance suite (outline)

Language-neutral cases that every backend must pass before it counts as plugin-supporting. A backend runs them in its own test runner (Node test runner, PHPUnit); this repo only holds the cases and a structural check (`npm test`). Runners do not exist yet.

Case format (`cases/*.yaml`, a list):

```yaml
- id: cascade-001            # unique
  title: what is being proven
  spec: spec/03-tiers-and-enablement.md   # section the case enforces (file must exist)
  given: { ... }             # plugins on disk, config, caller credentials
  when:  { ... }             # the action: load, request, hook invocation
  then:  { ... }             # expected result
  runtimes: [nodejs, php]    # default both
```

Rule: a new hook or extension point adds cases here and an implementation in `examples/example` in the same change. Every spec change that alters behavior adds a case that fails before and passes after, and an entry in `spec/CHANGELOG.md`.

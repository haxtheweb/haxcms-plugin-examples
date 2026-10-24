# Reference harness

An in-memory implementation of the HAX backend platform contract (`spec/13-backend-platform-contract.md`), used to run plugins' executable test cases without a HAXcms server. It is the executable form of spec/13: when the two disagree, one of them is wrong.

- `memory-backend.mjs`: loads plugin folders, orders them, runs requirements (inactive plugins contribute nothing), enforces route security from each plugin's OpenAPI document (none, JWT only, or JWT plus user token), dispatches hooks (priority, cascade, entity filters, aliases with `changed`, veto, discard on error, transactions with marks), and builds `ctx` (settings, stores including read-only package stores, `package.read` limited to `data/`, guarded `fetch`, `hooks.fire` for plugin-defined hooks, logs, warnings).
- `php/bridge.php`: runs a plugin's PHP methods with a PHP `ctx` of the same shape, one process per call, so the same cases run in both runtimes. Effects other plugins must see during the call go back to the harness as RPC lines while the method runs (entity saves and deletes with their hooks and vetoes, store writes, hooks the plugin fires, contract calls, fetches, bulk transactions), so a PHP plugin sees the same results a Node plugin would. In a case, every plugin runs in the case's runtime: a Node-only fixture does nothing in the PHP run.
- `run-cases.mjs` (`hax-plugin-test`): runs every case with a `run` block in a plugin's `tests/cases/*.yaml`, in each runtime the plugin lists, and compares Node with PHP.
- `fixtures/`: helper plugins cases can load with `run.with` (for example `quiet-hours`, which vetoes a hook the example plugin defines).

```sh
node harness/run-cases.mjs core-plugins/announcements            # both runtimes plus parity
node harness/run-cases.mjs examples/example --runtime nodejs
node harness/run-cases.mjs examples/example --json
```

## Writing an executable case

```yaml
- id: example-001
  title: "a boring file is vetoed"
  hook: entity.before.create
  given: "an awesomeFile named boring.awesome"
  when: "create"
  then: "operation fails with 'Too boring'"
  run:
    settings: { greeting: Hi }                 # settings for the plugin under test
    fire: { hook: entity.before.create, entity: awesomeFile, subject: { name: boring.awesome } }
    expect: { veto: true, message: "Too boring" }
```

`run` takes either `call` (`operation`, `params`, `query`, `body`, `credentials: none|jwt|both`) or `fire` (`hook`, `subject`, `previous`, `entity`, `transaction`), plus optional `haxcmsVersion`, `with`, `settings` and `stores`. `expect` can check `status`, `body` (deep subset), `subject` (deep subset), `absent` keys, `contains` / `notContains` strings, `veto`, `message`, transaction `marks` and plugin `status_of`. A case limited with `runtimes: [nodejs]` skips PHP (for example when a plugin it needs is Node only). Other run keys: `exec` and `fetch` fakes, `now` (frozen clock), `urlAliases` (deployment host aliases). Other steps: `save`, `delete`, `record`, `render` (`mode`, `theme`), `rebuild`, `config`, `enable`, `disable`, `upgrade`, `schedule`, `contract`, `implementers`, `importFile`, `managed`, `exportUser`, `eraseUser`, `asUser` (null for a visitor), `clock`, `transaction`; `capture` keeps a value for later steps as `{{$name}}`.

## What it is not

Not a server and not a backend: no HTTP, no disk writes, no network, one site, one user. Each backend repository adds its own adapter with the same operations (load plugins, call an operation, fire a hook, report status) and runs the same cases against the real implementation.

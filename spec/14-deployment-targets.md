# Deployment targets: server, desktop, command line, browser, static

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

HAXcms runs in more than one place, and a plugin with backend code does not work the same in all of them. A poll needs a backend its voters can reach; a deploy plugin needs to run a command; an importer needs to fetch a URL. This chapter says where a backend can run, what a plugin can count on there, and how core keeps track of it, so nobody finds out from a broken page.

## The targets

A **target** is where a HAXcms backend runs. Every backend says which one it is (`ctx.haxcms.target`), and the table lives once, in `schema/targets.json`.

| Target | What it is | Runtime | Provides | With a caveat | Does not have |
|---|---|---|---|---|---|
| `server` | haxcms-nodejs or haxcms-php on a host people reach over the web | nodejs, php | everything | | |
| `desktop` | haxcms-nodejs inside https://github.com/haxtheweb/haxcms-desktop, on one person's computer | nodejs | backend, commands, outbound requests, secrets | scheduled jobs run only while the app is open | a backend visitors can reach |
| `cli` | haxcms-nodejs loaded in-process by the `hax` CLI for one command, with no server listening | nodejs | backend, commands, outbound requests, secrets | a scheduled job runs only when a command runs it | a backend visitors can reach |
| `browser` | haxcms-nodejs bundled into a Worker by https://github.com/haxtheweb/haxcms-browser, in one person's browser tab | nodejs | backend | outbound requests reach only hosts that allow cross-origin requests; secrets are kept in the browser's storage, where the person using it can read them | commands, scheduled jobs, a backend visitors can reach |

**Static** is not a target: a statically published site has no backend at all. `staticCapable` and `staticFallback` (spec/02) already say what a plugin does there, and the registry reports it next to the targets.

The desktop app and the browser run haxcms-nodejs unchanged, so a plugin's Node code is what runs there. A plugin with PHP code only runs on a hosted haxcms-php and nowhere else.

## What a plugin needs

Authors do not declare needs. Core derives them from the manifest, the same way it derives tags (`scripts/backend-needs.mjs`, used by the validator, the reference engine and both backends):

| Need | Derived from | If the target lacks it |
|---|---|---|
| `backend` | backend code (`entry`) or operations (`openapi`); a pack has neither | the plugin is inactive |
| `process` | the `exec:run` capability | the plugin is inactive |
| `visitors` | an `x-hax-public` or optional-auth operation | the plugin runs, **limited** |
| `schedule` | `schedules` | the plugin runs, **limited** |
| `network` | the `network:egress` capability | the plugin runs, **limited** |
| `secrets` | the `settings:secret` capability | the plugin runs, **limited** |

Two outcomes, on purpose:

- **Inactive** (an unmet requirement, spec/03 Status): the plugin cannot do its job at all there. It is enabled but contributes nothing, with the reason shown: `Needs running commands on the machine, which the browser does not have`.
- **Limited**: the plugin runs and the owner is told what will not happen. A poll in the browser lets its author place the block and see it work for themselves; the registry says `Needs a backend that visitors and other services can reach, which the browser does not have`. Nothing is hidden and nothing breaks.

The optional manifest key `targets` (a subset of `server`, `desktop`, `browser`) is for ruling a target out when the manifest cannot show why, for example a Node plugin that uses a built-in module the browser build has no shim for. A backend whose target is not listed keeps the plugin inactive. Leave the key out otherwise.

The validator shows the result as derived tags: `needs-reachable-server` (the `visitors` need), `not-in-browser`, `not-on-desktop`.

## Rules for plugin code that runs everywhere

A plugin that wants the desktop app and the browser follows what the spec already asks, which is why most do without changes:

- Reach the platform through `ctx` only: `ctx.storage`, `ctx.files`, `ctx.entities`, `ctx.fetch`, `ctx.exec`, `ctx.now()`. No `fs`, `net`, `child_process` or `process.env` of its own.
- Ship plain ES modules with relative imports of its own files. The browser loads a plugin's entry from the site's or the system's plugin folder as it is; nothing is bundled at load time.
- Do not assume anyone else can call its operations. On the desktop app and in the browser the only caller is the person at the keyboard.
- Do not treat a secret setting as hidden from that person on the browser target.

## How core keeps track

The plugin registry (spec/03) carries, for every installed plugin, its `needs`, how it fits each target (`full`, `limited` or `no`), `staticCapable`, and on the running backend its `unmet` and `limited` lists. That gives one place to answer the questions that matter before something breaks:

- **Before enabling**: the plugin screen shows the fit for this backend, and the caveats, next to the capabilities.
- **When a site moves**: a site made in the browser and opened on a server, or the other way round, carries its plugin list (spec/03). The backend that opens it compares that list with its own registry and writes one warning per plugin that is missing, inactive or limited there.
- **When publishing statically**: the publish step lists enabled plugins that are not `staticCapable`, with each one's `staticFallback` sentence.

## Conformance

`conformance/cases/targets.yaml` (target-001 to target-005) runs every backend as each target. A case chooses one with `target: desktop|cli|browser`; the default is `server`.

### Where one plugin runs

`hax-plugin-check` has a `targets` layer that answers the question for one plugin, as a row of verdicts:

```
runs on  nodejs:full(10/10)  php:full(9/9)  desktop:limited(10/10)  cli:limited(10/10)  browser:no  static:no
```

- `nodejs` and `php` are the two backends on a hosted server; `desktop`, `cli` and `browser` are the other targets; `static` is a static publish.
- The verdict (`full`, `limited`, `no`) is derived from the manifest by the same code every backend's registry uses, so the check and the plugin screen cannot disagree.
- The plugin's own cases are then run again as every target it fits (`hax-plugin-test --target <target>`). A case written for one target (`run.target`) runs only there.
- The layer fails when a target the plugin fits fully does not pass its cases, or when `targets` in the manifest lists a target the plugin cannot run on. On a limited target the count is reported and does not fail the layer, because a case may be about the very thing that target lacks.
- `--json` carries the whole matrix with the reasons (`layers.targets.matrix`), which is what a plugin listing shows before anyone installs.

What this does not do: it runs the reference engine as each target. It does not start haxcms-desktop or haxcms-browser. A plugin that passes as `browser` here has been shown not to need what the browser lacks; that it loads in a real Worker is haxcms-browser's own test (see Open).

## Open

- What it takes to make plugins run in haxcms-browser, and the decisions that are open, are in the draft chapter 15.
- haxcms-browser has to load plugin entries from its in-memory volume. The engine imports an entry by file URL today; the browser build needs to import it from a blob of the same text. That is a change in haxcms-browser, tracked with its plugin support.
- Whether the desktop app can be given a public address (a tunnel) and then report `visitors` as provided.

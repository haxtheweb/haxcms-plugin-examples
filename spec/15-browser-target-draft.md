# Plugins in the browser: design draft

Part of the HAXcms plugin specification. **Status: a draft to react to. Nothing in this chapter is built.** Chapter 14 already says what the `browser` target provides and how a plugin's fit is derived; this chapter says what it would take to make plugins actually run in https://github.com/haxtheweb/haxcms-browser, what will not work there, and which decisions are open.

## What the browser is

From haxcms-browser's own description of itself:

- haxcms-nodejs, unmodified, bundled by esbuild into one script that runs in a Worker. Packages that need a server are replaced with stubs that throw when used.
- `fs` is an in-memory volume. The sites folder is written out to browser storage, a folder the person picks, or their cloud storage.
- One local user, signed in automatically. A service worker relays the editor's requests to the Worker; the real Express app answers them.
- Nobody else can reach it. There is no address a visitor or another service could call.

## What already holds

Nothing new is needed for these; they follow from chapter 14 and are covered by conformance (target-002):

- A plugin that needs `process` (runs commands) is inactive in the browser, with the reason.
- A plugin that needs `visitors`, `schedule`, `network` or `secrets` runs, **limited**, and the registry carries one sentence per limit.
- Plugin routes are ordinary Express routes, so the service worker relay reaches them like any other route. That includes the assets route, so a plugin's front-end files would load from the Worker.
- `hax-plugin-check` reports a `browser` column for every plugin and runs the plugin's cases as that target.
- If the plugin engine cannot be loaded in a build, haxcms-nodejs treats plugins as off and saves go on. This matters now: until the work below is done, a browser build made from a haxcms-nodejs that has the plugin platform would otherwise fail on every save.

## What has to be built

In the order it would have to happen.

### 1. The engine inside the bundle

haxcms-nodejs loads the engine with a dynamic import, and the engine reads its schema files (`plugin.schema.json`, `targets.json`, the hook and contract lists) from the spec package's folder on disk, located through `import.meta.url`. In a single bundled script there is no such folder and no `import.meta.url`.

- The engine has to be importable statically, with the schema files inlined at build time (or copied into the in-memory volume at boot and read from there).
- `child_process` gets haxcms-browser's usual stub. The engine never reaches it, because a plugin that needs `process` is inactive before any of its code runs.

This is build work in haxcms-nodejs and haxcms-browser. It changes nothing a plugin author sees.

### 2. Loading a plugin's code

The engine imports a plugin's entry by file URL. A Worker has no file URLs; the plugin's files are text in the in-memory volume. Three ways to load them:

| | How | Cost |
|---|---|---|
| A. Blob import | read the entry's text, make a blob URL, `import()` it | works only for a one-file entry: relative imports inside it cannot resolve |
| B. Author builds | `hax plugin build` emits one bundled file for the browser; the manifest names it | every author has a build step, and chapter 14's "nothing is bundled at load time" goes away |
| C. Small loader | walk the entry's relative imports, turn each file into a blob URL, rewrite the specifiers, import the entry | about a hundred lines, no bundler; bare imports (`from "lodash"`) are refused, which the spec already asks |

**Proposed: C.** It keeps the rule that a plugin is plain ES modules with relative imports, and the same folder runs on a server, the desktop app and the browser. The loader refuses a plugin over a size limit and reports it as `failed` with the reason.

### 3. Where plugins come from

On a server an administrator puts a plugin folder in `_plugins`. In the browser there is no administrator, and whoever runs the deployment (browser.hax.cloud) is not the person at the keyboard.

- **First version, proposed:** only plugins that ship inside the build, as a read-only system tier. The person turns them on per site. No way to add code.
- **Later:** a person adds a plugin to their own site (`<site>/_plugins/<id>`). It travels with the site folder, which is what chapter 3 already describes; a server that later opens the site applies its own deployment rules before running any of it.

### 4. Trust

A plugin runs in the same Worker as HAXcms. On a server that is accepted, because an administrator chose the plugin. In the browser it means a plugin can call `fetch` itself instead of `ctx.fetch`, and nothing stops it: the egress list and `x-secret-egress` bind only code that goes through `ctx`.

- For plugins that ship in the build this is the same trust as the rest of the build.
- For plugins a person adds, real isolation would be one Worker per plugin with `ctx` passed over messages and a content security policy limiting where that Worker can connect. That is a larger piece of work and the reason user-added plugins are proposed for later.

### 5. What a person is told

haxcms-browser already reports what is not available (`unavailable`, shown under Details). Plugins join that report: each inactive or limited plugin with its sentence from the registry. A poll in the browser is the plain example: the block can be placed and edited, and Details says votes cannot be collected here because nobody else can reach this backend.

When such a site is published statically from the browser, the publish step lists the enabled plugins that are not `staticCapable`, with each one's `staticFallback` sentence (chapter 14).

### 6. Proving it

- The spec's conformance runner already takes a backend adapter (`--backend`). A browser adapter drives the bundled Worker in headless Chrome and runs the same cases with `target: browser`.
- The bar: every case that passes on haxcms-nodejs as the `browser` target in Node passes in the Worker too. Cases about commands and schedules are already written for the server target and do not run there.
- haxcms-browser's own parity suite gains one site with a plugin on.

## What will not work in the browser, by design

| | Why | What the person sees |
|---|---|---|
| Running commands (`ctx.exec`) | no process | plugin inactive |
| Scheduled jobs | nothing runs when the tab is closed | limited: jobs never run |
| Operations for visitors (a poll vote, a form post) | nobody can reach the backend | limited: only the person at the keyboard can call them |
| Fetching any URL | cross-origin rules | limited: only hosts that allow it answer |
| Keeping a secret from the person using it | storage is theirs to read | limited: said on the settings form |
| PHP-only plugins | the browser runs haxcms-nodejs | not offered |

## Decisions that are open

1. **Shipped-only first, or user-added from the start?** Proposed: shipped-only. It avoids the isolation work and gets real plugins in front of people.
2. **Loader C, or an author build step (B)?** Proposed: C.
3. **Does the desktop app use the same loader?** It runs real Node, so it does not have to. Using the file import there keeps one less moving part.
4. **Which plugins ship in the browser build?** A list in haxcms-browser, reviewed like the stub list, or every core plugin whose `browser` fit is not `no`?

## Not verified

This draft is written from reading haxcms-browser's build script and README and the engine's code. haxcms-browser has not been built against a haxcms-nodejs with the plugin platform, so the statement that the engine cannot load in today's bundle is an inference from how the engine finds its files, not an observed failure.

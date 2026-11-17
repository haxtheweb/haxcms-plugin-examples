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

**Decided: C.** It keeps the rule that a plugin is plain ES modules with relative imports, and the same folder runs on a server, the desktop app and the browser. The loader refuses a plugin over a size limit and reports it as `failed` with the reason.

### 3. Where plugins come from

**Decided: only plugins that ship inside the build.** They are a read-only system tier; the person turns them on per site, and there will be many core plugins to choose from. Whoever wants a custom plugin installs HAXcms (the desktop app or a server) and adds it there. The browser has no way to add code.

### 4. Trust

A plugin runs in the same Worker as HAXcms and could call `fetch` itself instead of `ctx.fetch`; the egress list and `x-secret-egress` bind only code that goes through `ctx`. With shipped plugins only, that is the same trust as the rest of the build, reviewed the same way. Isolating a plugin in its own Worker is not needed for this and is not planned.

### 4a. Where settings and plugin data are kept

Today haxcms-browser keeps one folder: the sites. Everything else HAXcms writes, the whole system layer under `_config`, lives in memory and is gone on the next load. For plugins that would mean choosing which ones are on, and filling in their settings, every time.

What has to last, and where it already lives on a server:

| | Path | Layer |
|---|---|---|
| which plugins are on for the system | `_config/plugins/plugins.yaml` | system |
| a plugin's settings | `_config/plugins/config/<id>.json` | system |
| secret settings | `_config/plugins/secrets/<id>.json` | system |
| a plugin's system stores | `_config/data/<id>/` | system |
| personal data per site | `_config/siteData/<site uuid>/<id>/` | system |
| which plugins are on for one site, and its site settings | `<site>/_config/plugins/` | site, already saved with the site |

**Proposed: keep `_config` the same way the sites are kept.** The code that mirrors the sites folder to a directory handle takes any folder, so a second mirror for `_config` is the same mechanism:

- **In this browser (the default):** the browser's own private file system. This is the same API in Chrome, Edge, Firefox and Safari, so it is not Chrome-only.
- **In a folder the person picked (Chrome, Edge):** a `_config` folder next to the sites, so the folder is a whole HAXcms that `hax serve` or the desktop app can open with the same plugins on and the same settings.
- **In cloud storage:** next to the sites there too, with the secrets file left out. A secret would otherwise sit in someone's Drive in the clear.

What follows from this:

- The system layer is where a learner's own records belong (personal data, and the CMI data a tracking plugin keeps), because they are about the person and not about one site. In a single-site install the two layers are the same folder tree, so nothing changes there.
- A secret setting saved in the browser is readable by the person using it. The settings form says so (chapter 14), and it is their own key.
- Clearing the browser's site data clears all of it. The bar that says where sites are saved has to say the same about settings.

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

## Decisions

Taken:

1. **Shipped plugins only.** A custom plugin means installing HAXcms.
2. **The small loader (C)**, no author build step.
3. **The desktop app keeps the file import.** It runs real Node, so its capabilities stay as close to a server's as they can.

Open:

4. **Which plugins ship in the browser build?** A list in haxcms-browser, reviewed like its stub list, or every core plugin whose `browser` fit is not `no`.
5. **`_config` in cloud storage:** next to the sites as proposed above, or kept only in the browser.

## Release order

The plugin platform is not in the upcoming HAXcms release; the specification is still being assessed. The release after it is planned to carry it with two plugins: `announcements`, on by default, and `log`, off by default. The browser work in this chapter follows that.

## Not verified

This draft is written from reading haxcms-browser's build script and README and the engine's code. haxcms-browser has not been built against a haxcms-nodejs with the plugin platform, so the statement that the engine cannot load in today's bundle is an inference from how the engine finds its files, not an observed failure.

# pwa (offline support)

Offline support and the old-browser upgrade prompt, extracted from core.

**Today in core:** `site.json` keeps `metadata.site.settings.sw` and `forceUpgrade`; core renders `service-worker.js` and `offline.html` as managed files and adds the registration script when `sw` is on (`getServiceWorkerScript`, `getServiceWorkerStatus`); `forceUpgrade` sends old browsers to `assets/upgrade-browser.html`.

**As a plugin:** per-site settings (off by default); `rebuild.after` writes a network-first worker and the offline page as managed files; turning it off (or disabling the plugin) writes a worker that clears its caches and unregisters itself, so visitors who installed the old one are not stuck; `plugin.after.install` moves both settings out of `site.json`.

**Core changes when extracted (not made here):** remove `sw`/`forceUpgrade` from the form and `saveManifest`, the service-worker template and registration code, and the `forceUpgrade` template variable.

Tests: `node harness/run-cases.mjs core-plugins/pwa`.

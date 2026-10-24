# Giphy (core, declarative)

**Today:** `HAXAppStoreService.loadBaseAppStore()` adds a Giphy app to the editor's appstore payload when `appStore.apiKeys.giphy` is set in the core config. The key travels to the browser inside the payload.

**As a plugin:** the key is a secret setting that never leaves the server. The appstore app (`registries/appstore/giphy.json`) points at this plugin's `search` route, which is an `x-hax-proxy`: core adds `api_key`, forwards only the listed query parameters to `https://api.giphy.com/v1/gifs/search`, and returns the answer. There is no plugin code, so it runs the same on both backends.

- Without a key the plugin is inactive, so the app disappears from the editor, as before.
- On first enable, core moves the old key out of the core config (`legacy.settings`).

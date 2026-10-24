# youtube

The YouTube appstore provider, extracted from core.

**Today in core:** `HAXAppStoreService.loadBaseAppStore()` adds a YouTube app when `appStore.apiKeys.youtube` is configured, and puts the key into the payload sent to the browser (`connection.data.key`).

**As a plugin:** the key is a secret, system-wide setting; the appstore app points at this plugin's `search` route, an `x-hax-proxy`: core adds the key and calls `www.googleapis.com` (the only host it may reach); there is no plugin code; without a key the plugin is inactive, so the app disappears from the editor, as before; core moves the key out of the core configuration on first enable (`legacy.settings` uses `config:` for that path).

Vimeo, Giphy, Unsplash and Flickr have the same shape (`core-plugins/vimeo` and so on).

Tests: `node harness/run-cases.mjs core-plugins/youtube`.

# youtube

The YouTube appstore provider, extracted from core.

**Today in core:** `HAXAppStoreService.loadBaseAppStore()` adds a YouTube app when `appStore.apiKeys.youtube` is configured, and puts the key into the payload sent to the browser (`connection.data.key`).

**As a plugin:** the key is a secret, system-wide setting; the appstore app points at this plugin's `search` route, which adds the key and calls `www.googleapis.com` (the only host it may reach); without a key the plugin is inactive, so the app disappears from the editor, as before; `plugin.after.install` moves the key out of the core configuration (`legacy.settings` uses `config:` for that path).

The same shape applies to Vimeo, Giphy, Unsplash and Flickr, each its own plugin.

Tests: `node harness/run-cases.mjs core-plugins/youtube`.

# cookie-consent

Asks visitors before any tracking plugin runs. New: core has nothing like it today (the site shell loads Google Analytics without asking).

- Shows its banner on published pages only while an active plugin declares `privacy.tracking`, listing the categories those plugins put in `requiresConsent`. It never names a tracker: it asks `ctx.plugins.list()`.
- The banner element also provides `globalThis.HAXConsent` (`granted`, `onGrant`, `set`). Trackers that depend on cookie-consent wait on `onGrant(category)`. The choice is stored in the visitor's browser only.
- Settings (deployment default, per-site override): banner message (default in `config/settings.defaults.json`) and a privacy policy link.
- Works on static hosting.

Tests: `node harness/run-cases.mjs core-plugins/cookie-consent`.

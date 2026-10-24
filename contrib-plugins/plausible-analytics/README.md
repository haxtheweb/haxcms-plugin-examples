# Plausible Analytics (community, Node only)

Adds Plausible's script to published pages for the domain set on each site. A second tracker next to google-analytics, written to prove cookie-consent stays generic: neither plugin names the other.

Plausible sets no cookies, so consent is only asked for when the site turns on **Wait for analytics consent**. That is declared with `privacy.consentSetting: waitForConsent`: `requiresConsent` counts only on sites where that setting is on, and core resolves it before any consent plugin reads the plugin list.

- Settings (per site): `domain`, `host` (self-hosted Plausible), `waitForConsent`
- Hooks: `config.before.save`, `render.before.head` (inactive until `domain` is set: it is a required field, so core reports it)

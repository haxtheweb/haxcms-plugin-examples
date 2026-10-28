# AGENTS.md (google-analytics)

## Purpose
Consent-gated Google Analytics per site. Core optional; depends on cookie-consent.

## Rules
- Never load gtag before consent; never bake anything but the validated id into output.
- Keep the legacy read path documented in `legacy.settings` until every site has migrated.
- Node and PHP behave the same (parity run).

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/google-analytics`.

## Diagnose
- Inactive: no measurement id; set it in the plugin's settings for the site.
- Nothing in the page head: the id failed validation, or the plugin is inactive.

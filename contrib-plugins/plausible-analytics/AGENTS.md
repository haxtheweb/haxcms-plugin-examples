# AGENTS.md (plausible-analytics)

## Purpose
Plausible analytics loader with optional, setting-driven consent.

## Rules
- Never name cookie-consent in code; use the generic HAXConsent API when it exists.
- Keep consentSetting pointing at a boolean field.
- No cookies: privacy.cookies stays empty.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/plausible-analytics`.

## Diagnose
- Banner shows although waitForConsent is off: a different tracker requires analytics consent.
- No script in pages: domain unset (plugin inactive) or the page is a fragment.

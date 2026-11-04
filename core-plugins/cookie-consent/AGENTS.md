# AGENTS.md (cookie-consent)

## Purpose
Consent banner and consent state for tracking plugins. Core optional; trackers depend on it.

## Rules
- Never name a tracker. Categories come from active plugins' `privacy.requiresConsent`.
- Load nothing when nothing tracks.
- Consent state stays in the visitor's browser; never send it anywhere.
- Node and PHP behave the same (parity run).

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/cookie-consent`.

## Diagnose
- Banner missing: no active plugin has `privacy.tracking: true` with `requiresConsent` categories, or the visitor already answered.

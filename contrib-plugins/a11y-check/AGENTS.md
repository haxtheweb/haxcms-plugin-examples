# AGENTS.md (a11y-check)

## Purpose
Save-time and preview accessibility checks plus a site report.

## Rules
- Warn by default; block only for missing alt text and only when the site opts in.
- Never inject anything outside preview mode.
- Keep rules fast and dependency-free (they run on every save).

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/a11y-check`.

## Diagnose
- A rule fires on fine markup: check alt="" for decorative images and real heading levels.

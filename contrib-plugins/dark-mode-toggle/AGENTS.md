# AGENTS.md (dark-mode-toggle)

## Purpose
Visitor-facing color scheme switch on themes that support both.

## Rules
- Check colorSchemes; never force dark on a light-only theme.
- No server calls from the element.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/dark-mode-toggle`.

## Diagnose
- No toggle: the active theme's registry entry does not list both schemes.

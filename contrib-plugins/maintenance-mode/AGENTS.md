# AGENTS.md (maintenance-mode)

## Purpose
Deployment-wide maintenance switch.

## Rules
- Admins are never blocked.
- Never cache the maintenance page (render.before answers before caches store anything).

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/maintenance-mode`.

## Diagnose
- Locked out: only admins pass; turn it off with hax plugin config set maintenance-mode on false.

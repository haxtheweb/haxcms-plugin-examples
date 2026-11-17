# AGENTS.md (page-cache)

## Purpose
Anonymous page cache with broad invalidation.

## Rules
- Never cache signed-in, preview or publish renders.
- Respect cacheable: false from any plugin.
- When in doubt, clear: a stale page is worse than a slow one.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/page-cache`.

## Diagnose
- Visitors see an old page: check the log for clears; a change that fires no hook (a file edited by hand) needs pageCacheClear.

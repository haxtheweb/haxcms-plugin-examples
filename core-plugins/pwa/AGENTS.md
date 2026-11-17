# AGENTS.md (pwa)

## Rules
- Never leave visitors with a worker that cannot be removed: when off, write the self-removing worker.
- Managed files are only `service-worker.js` and `offline.html`.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/pwa`.

## Diagnose
- Pages still served from cache after turning it off: the visitor has not loaded a page since the rebuild; the self-removing worker takes over on the next visit.

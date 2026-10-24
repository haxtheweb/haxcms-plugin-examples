# AGENTS.md (youtube)

## Rules
- The API key never appears in a response, the appstore payload or a log.
- Only `www.googleapis.com` (`egress`).

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/youtube`.

## Diagnose
- No YouTube in the editor: no key set (plugin inactive).
- Search returns 502: Google could not be reached or rejected the key; the log has the reason.

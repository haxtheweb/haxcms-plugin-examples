# AGENTS.md (log)

## Purpose
Unified log sink and the singular log page's data source.

## Rules
- Never names another plugin; it receives entries through log.sink only.
- Rotation drops oldest first and never more than maxEntries remain.
- Node and PHP output must stay byte-identical (null, not omitted).

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/log`.

## Diagnose
- Entries missing: check the plugin is enabled at system scope and that core calls log.sink.
- Log grows without bound: check the rotate schedule is registered (hax plugin schedules).

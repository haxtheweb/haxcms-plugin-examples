# AGENTS.md (publish-scheduler)

## Purpose
Timed publish and unpublish of pages.

## Rules
- Write only your own namespace in page metadata.
- Compare times with ctx.now(), never the runtime clock.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/publish-scheduler`.

## Diagnose
- A page did not publish: is the schedule running (hax plugin schedule run publish-scheduler publish), and is publishAt in the past in UTC?

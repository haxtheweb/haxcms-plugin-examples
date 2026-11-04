# AGENTS.md (xapi-statements)

## Purpose
xAPI capture with honest export and erasure across the LRS boundary.

## Rules
- The actor is always the caller; never accept an actor from the request.
- Empty the queue only after the LRS accepts the batch.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/xapi-statements`.

## Diagnose
- Statements pile up: the flush job fails (see the log for the LRS status).

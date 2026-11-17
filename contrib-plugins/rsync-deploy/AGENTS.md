# AGENTS.md (rsync-deploy)

## Purpose
rsync deployment by hand or after commits, using ctx.exec and a secret key.

## Rules
- Only run rsync, only through ctx.exec, only with an argument list.
- Never log, return or bake the private key anywhere.
- Deploy-on-commit stays optional: git is suggested, not a dependency.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/rsync-deploy`.

## Diagnose
- 502 from deploy now: read the log line 'rsync failed: ...' (often host key or permissions).
- Nothing happens after commits: deployOnCommit off, or git not enabled (the settings save warned).

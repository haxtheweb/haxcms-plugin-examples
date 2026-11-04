# AGENTS.md (git)

## Rules
- Run only `git`, always with an argument list (never a shell string), and only sanitized messages.
- One commit per transaction; never commit inside a bulk transaction's individual hooks.
- `git.before.commit` and `git.after.commit` are this plugin's to fire (core contracts with `definedBy: git`).

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/git`.

## Diagnose
- No commits: `git` missing on the server, or a plugin vetoes `git.before.commit` (the log says which).
- Push failures are logged as warnings; commits still happen.

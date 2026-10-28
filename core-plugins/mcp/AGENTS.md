# AGENTS.md (mcp)

## Purpose
MCP token management, discovery of x-hax-mcp operations, and scope enforcement.

## Rules
- Never store a token secret in plain text; hash it.
- Operations opt in with x-hax-mcp; never expose an operation that did not.
- A read-only token must be vetoed on any non-GET operation.
- Core never names this plugin; HAXiam blocks it by id through policy, not code.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/mcp`.

## Diagnose
- Client sees no tools: check the operations carry x-hax-mcp and the token's plugin list.
- Writes succeed with a read-only token: the rest.before.request guard is not subscribed.

# AGENTS.md (outline)

## Purpose
Applies outline edits through core entities in one transaction. Required; depends on git.

## Rules
- Never write pages or site.json directly: always ctx.entities, inside ctx.transaction.run (PHP: $ctx->runTransaction).
- Refuse loops and dangling parents before changing anything.
- Keep legacy.routes until the outline designer calls the plugin path.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/outline`.

## Diagnose
- 400 "parent chain loops": the outline nests a page under its own descendant.
- 409 with a message: another plugin vetoed a page save or delete; the rest of the edit was applied.

# AGENTS.md (changelog)

## Purpose
A page listing recent commits, and the re-entry guard's test case.

## Rules
- Only write the changelog page.
- Never fire git hooks yourself.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/changelog`.

## Diagnose
- The Changes page is one commit behind in git history: expected; it is committed with the next change.

# AGENTS.md (spam-guard)

## Purpose
Refuse or hold spammy comments through comments.before.create.

## Rules
- Never store or log comment bodies.
- Return the comment (possibly with status pending) or veto; never drop fields.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/spam-guard`.

## Diagnose
- Spam gets through: check the comment arrived through commentsCreate (hooks fire there) and the word list has one entry per line.

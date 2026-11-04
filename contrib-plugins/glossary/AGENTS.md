# AGENTS.md (glossary)

## Purpose
Glossary entity, duplicate guard and in-page definitions.

## Rules
- Definitions are text: escape them in attributes and render with textContent.
- Only wrap a term's first appearance per page.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/glossary`.

## Diagnose
- A term is not explained: it only appears inside a link, heading or code, or an earlier alias already used that definition.

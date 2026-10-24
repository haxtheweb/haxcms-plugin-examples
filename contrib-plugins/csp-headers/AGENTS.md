# AGENTS.md (csp-headers)

## Purpose
Hash-based CSP over the final document.

## Rules
- Stay in stage seal: hashing anything but the final bytes breaks pages.
- Never allow 'unsafe-inline'.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/csp-headers`.

## Diagnose
- A script is blocked: a plugin changed the document after seal (it must use stage transform), or it loads from a host missing from Also allow scripts from.

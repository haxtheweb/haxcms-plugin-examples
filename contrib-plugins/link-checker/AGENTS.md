# AGENTS.md (link-checker)

## Purpose
Weekly broken-link report.

## Rules
- HEAD only; never send page content anywhere.
- Report private addresses as refused, never retry them.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/link-checker`.

## Diagnose
- Everything is unreachable: the deployment refuses any-host egress.

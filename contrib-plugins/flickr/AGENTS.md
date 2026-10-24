# AGENTS.md (flickr)

## Purpose
Appstore provider for Flickr, declared as an x-hax-proxy so the key stays server-side.

## Rules
- Do not add code: if the provider needs logic the proxy cannot express, add an entry and an operation instead, and drop x-hax-proxy for that operation.
- Every parameter the appstore sends (search fields, data, pagination) must be in `pass`, or it is dropped.
- Keep the host in `egress` and the key `x-secret`.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/flickr`.

## Diagnose
- Searches return 502: the host is unreachable or rejected the key (see the log).
- Results ignore a filter: the parameter is missing from `pass`.

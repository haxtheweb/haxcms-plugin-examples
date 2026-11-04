# AGENTS.md (webhooks)

## Purpose
Signed outgoing webhooks to admin-chosen https URLs.

## Rules
- https only; no private or link-local addresses.
- Never send or log the signing secret.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/webhooks`.

## Diagnose
- Receiver rejects messages: compare its HMAC of the raw body with X-HAX-Signature using the same secret.

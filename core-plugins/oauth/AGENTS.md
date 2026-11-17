# AGENTS.md (oauth)

## Purpose
OAuth 2.1 authorization server for HAXcms: clients, consent, codes with PKCE, access/refresh/personal tokens, revocation, and the `oauth.resource` contract other plugins implement to accept its tokens.

## Layout
- `config/contracts.yaml`: the `oauth.resource` contract (`describe`, `check`).
- `config/openapi.yaml`: system-scope routes; `oauthMetadata` carries `x-hax-well-known: oauth-authorization-server`.
- `src/nodejs/index.js`, `src/php/Plugin.php`: the same logic in both runtimes.
- `tests/cases/oauth.yaml`: executable cases against `harness/fixtures/demo-resource`.

## Rules
- Store only hashes of tokens and codes; return a raw token exactly once.
- PKCE S256 is mandatory; `plain` is never accepted. Codes are single use and expire in 60 s.
- Never name a resource plugin in this plugin's code; find resources through `ctx.plugins.list()` (`implements`) and call the one a grant belongs to.
- Always strip `x-hax-oauth-grant` from incoming requests before setting it; resources trust that header only because of this.
- Keep both runtimes byte-identical in what they return (JSON with unescaped slashes; `encodeURIComponent` in redirects).

## Build, test, validate
`node scripts/validate.mjs core-plugins/oauth`; `node harness/run-cases.mjs core-plugins/oauth` (Node, PHP and parity).

## Diagnose
- Every request with a token gets 401: check the token kind (`hax_at_`, `hax_pt_`), its expiry, and whether its grant was revoked.
- 403 with a message: the resource's `check` refused; the message is the resource's.
- `invalid_target`: the resource plugin is inactive or not configured (its `describe` returned `error`).

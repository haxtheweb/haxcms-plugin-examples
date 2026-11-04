# AGENTS.md (mcp)

## Purpose
HAXcms's side of MCP: the instance switch (enabled = this plugin is on; `readOnly` setting), the `oauth.resource` implementation for the haxcms-mcp server URL, and discovery of `x-hax-mcp` operations and prompts.

## Rules
- Tokens belong to the oauth plugin. Never issue, store or verify tokens here; trust only the `x-hax-oauth-grant` header, which oauth sets and strips.
- `describe` offers `mcp:write` only while `readOnly` is false; `check` refuses writes unless both the grant and the instance allow them.
- Operations opt in with `x-hax-mcp`; never let a token reach a plugin operation that did not.
- Core never names this plugin; HAXiam blocks it by id through deployment config (`blocked`), not code.
- Core keeps publishing `data.mcp` on `GET /system/api/v1` from this plugin's state; that shape is a base contract haxcms-mcp depends on.

## Build, test, validate
`node scripts/validate.mjs core-plugins/mcp`; `node harness/run-cases.mjs core-plugins/mcp` (loads core-plugins/oauth).

## Diagnose
- Plugin inactive: `serverUrl` is not set (it is required).
- Consent never offers changes: `readOnly` is on (the default).
- Client sees no tools: the operations lack `x-hax-mcp`, or the token is for a different server URL.
- 401 on discovery: no token, a token from elsewhere, or a revoked/expired one.

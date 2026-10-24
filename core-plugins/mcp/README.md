# MCP (core, optional, per site)

Exposes a site to MCP clients (see https://github.com/haxtheweb/haxcms-mcp). Installed system-wide, enabled per site; HAXiam deployments block it.

- Tokens: `mcpTokenCreate`, `mcpTokenList`, `mcpTokenRevoke` (the secret is shown once; only a hash is stored)
- Discovery: `mcpDiscovery`, authenticated by the `X-HAX-MCP-Token` header, lists only operations marked `x-hax-mcp`, filtered by the token's plugin list and read-only flag, plus every plugin's prompts
- Guard: `rest.before.request` vetoes writes from read-only tokens
- Install moves the old core `mcp.readOnly` config into the plugin's settings

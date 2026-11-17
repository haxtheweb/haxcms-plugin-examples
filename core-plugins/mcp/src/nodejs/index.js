// MCP access (Node). Mirrored in src/php/Plugin.php.
// Tokens come from the oauth plugin: this plugin only says what an MCP token is for (describe) and what it may call
// (check). The oauth plugin verifies the token and passes the grant on in the x-hax-oauth-grant header.

const GRANT_HEADER = "x-hax-oauth-grant";
const READ = "mcp:read";
const WRITE = "mcp:write";
const writesAllowed = (ctx) => ctx.settings.readOnly === false;
const isWrite = (method) => String(method || "GET").toUpperCase() !== "GET";

/** The grant the oauth plugin verified for this request, or null (it removes any copy a client sends). */
function grantOf(ctx, req) {
  try {
    const g = JSON.parse((req.headers || {})[GRANT_HEADER] || "null");
    return g && g.resource === ctx.settings.serverUrl && (g.scopes || []).includes(READ) ? g : null;
  } catch {
    return null;
  }
}

export default {
  contracts: {
    "oauth.resource": {
      /**
       * Implements contract oauth.resource, operation describe.
       *
       * Names the haxcms-mcp server URL as the audience tokens are issued for, with mcp:read always and mcp:write only when this instance allows writes.
       *
       * @param {object} ctx  Platform context (spec/13); ctx.settings.serverUrl, readOnly.
       * @returns {Promise<object>}  { resource, title, scopes }, or { error } when the server URL is not set.
       */
      async describe(ctx) {
        if (!ctx.settings.serverUrl) return { error: "serverUrl is not set" };
        const scopes = [{ scope: READ, title: "Read your sites", description: "See your sites, pages, files and settings, as you can", write: false }];
        if (writesAllowed(ctx)) scopes.push({ scope: WRITE, title: "Change your sites", description: "Create, edit and delete pages, files and sites, as you can", write: true });
        return { resource: ctx.settings.serverUrl, title: "MCP (AI agents)", scopes };
      },
      /**
       * Implements contract oauth.resource, operation check.
       *
       * Decides what an MCP token may call: reads need mcp:read; writes need mcp:write and an instance that allows writes; a plugin operation must be marked x-hax-mcp; a token bound to a site stays on that site.
       *
       * @param {object} ctx  Platform context (spec/13); ctx.settings.readOnly; ctx.site.
       * @param {object} input  { grant: { scopes, site }, request: { operationId, method, path, plugin } }.
       * @returns {Promise<object>}  { allow: true } or { allow: false, message }.
       */
      async check(ctx, input) {
        const g = input.grant || {};
        const r = input.request || {};
        const scopes = g.scopes || [];
        if (!scopes.includes(READ)) return { allow: false, message: "this token has no mcp:read scope" };
        if (r.operationId === "mcpDiscovery") return { allow: true };
        if (isWrite(r.method) && !(writesAllowed(ctx) && scopes.includes(WRITE))) return { allow: false, message: "this MCP token is read-only" };
        if (r.plugin) {
          const op = (await ctx.plugins.operations({})).find((o) => o.operationId === r.operationId);
          if (!op || !op.mcp) return { allow: false, message: `${r.operationId} is not offered to MCP` };
        }
        if (g.site && ctx.site && String(r.path || "").startsWith("/x/api/") && g.site !== ctx.site.name && g.site !== ctx.site.id) return { allow: false, message: `this MCP token is for the site ${g.site}` };
        return { allow: true };
      },
    },
  },
  operations: {
    /**
     * Implements operation mcpDiscovery.
     *
     * Tells the MCP server what the calling token may use: the operations marked x-hax-mcp within its read-only state, and every plugin's prompts.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.headers["x-hax-oauth-grant"]: set by the oauth plugin for a valid MCP token.
     * @returns {Promise<object>}  { site, readOnly, scopes, operations, prompts }, or { status: 401, body: { error } }.
     */
    async mcpDiscovery(ctx, req) {
      const g = grantOf(ctx, req);
      if (!g) return { status: 401, body: { error: "an MCP token from the oauth plugin is required" } };
      const readOnly = !(writesAllowed(ctx) && g.scopes.includes(WRITE));
      const operations = (await ctx.plugins.operations({ mcp: true })).filter((op) => !readOnly || !isWrite(op.method)).map(({ plugin, operationId, method, path, summary }) => ({ plugin, operationId, method, path, summary }));
      const prompts = (await ctx.plugins.prompts()).filter((p) => p.mcp !== false).map(({ plugin, id, title, prompt }) => ({ plugin, id, title, prompt }));
      return { site: g.site, readOnly, scopes: g.scopes, operations, prompts };
    },
  },
};

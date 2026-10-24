// MCP access (Node). Mirrored in src/php/Plugin.php.
import { createHash, randomBytes } from "node:crypto";

const hash = (t) => createHash("sha256").update(String(t)).digest("hex");
const HEADER = "x-hax-mcp-token";

async function findToken(ctx, raw) {
  if (!raw) return null;
  const t = ((await ctx.storage.read("tokens")) || []).find((x) => x.hash === hash(raw));
  if (!t || t.revoked || (t.expires && t.expires < ctx.now())) return null;
  return t;
}
const allowed = (t, op) => (!t.plugins || !t.plugins.length || t.plugins.includes(op.plugin)) && (!t.readOnly || op.method === "GET") && op.mcp;

export default {
  operations: {
    /**
     * Implements operation mcpTokenCreate.
     *
     * Issues a new MCP token, scoped to a site, a list of plugins and read-only or not, and stores only its hash; the raw token is returned once.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.settings.readOnlyDefault.
     * @param {object} req  req.body: { label, site, readOnly, plugins, expiresInDays }.
     * @returns {Promise<object>}  { id, token, readOnly, plugins, site }.
     */
    async mcpTokenCreate(ctx, req) {
      const b = req.body || {};
      const token = `hax_mcp_${randomBytes(24).toString("hex")}`;
      const record = { id: `tok-${randomBytes(4).toString("hex")}`, label: String(b.label || ""), site: b.site || null, readOnly: b.readOnly ?? ctx.settings.readOnlyDefault !== false, plugins: b.plugins || [], expires: b.expiresInDays ? ctx.now() + b.expiresInDays * 86400000 : null, hash: hash(token) };
      await ctx.storage.write("tokens", [...((await ctx.storage.read("tokens")) || []), record]);
      return { id: record.id, token, readOnly: record.readOnly, plugins: record.plugins, site: record.site };
    },
    /**
     * Implements operation mcpTokenList.
     *
     * Lists the tokens that are not revoked, without their hashes.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @returns {Promise<object>}  { items }.
     */
    async mcpTokenList(ctx) {
      return { items: ((await ctx.storage.read("tokens")) || []).filter((t) => !t.revoked).map(({ hash: _h, ...rest }) => rest) };
    },
    /**
     * Implements operation mcpTokenRevoke.
     *
     * Marks a token revoked so later calls carrying it are refused.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.params.id: the token id.
     * @returns {Promise<object>}  { revoked: id }, or { status: 404, body: { error } }.
     */
    async mcpTokenRevoke(ctx, req) {
      const tokens = (await ctx.storage.read("tokens")) || [];
      const t = tokens.find((x) => x.id === req.params.id && !x.revoked);
      if (!t) return { status: 404, body: { error: "not found" } };
      t.revoked = true;
      await ctx.storage.write("tokens", tokens);
      return { revoked: t.id };
    },
    /**
     * Implements operation mcpDiscovery.
     *
     * Tells an MCP client what its token may use: the MCP-enabled operations and prompts inside the token's plugin and read-only scope.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.headers["x-hax-mcp-token"]: the raw token.
     * @returns {Promise<object>}  { site, readOnly, operations, prompts }, or { status: 401, body: { error } }.
     */
    async mcpDiscovery(ctx, req) {
      const t = await findToken(ctx, req.headers[HEADER]);
      if (!t) return { status: 401, body: { error: "missing, unknown, revoked or expired MCP token" } };
      const operations = (await ctx.plugins.operations({ mcp: true })).filter((op) => allowed(t, op)).map(({ plugin, operationId, method, path, summary }) => ({ plugin, operationId, method, path, summary }));
      const prompts = (await ctx.plugins.prompts()).filter((p) => p.mcp !== false && (!t.plugins.length || t.plugins.includes(p.plugin))).map(({ plugin, id, title, prompt }) => ({ plugin, id, title, prompt }));
      return { site: t.site, readOnly: t.readOnly, operations, prompts };
    },
  },
  hooks: {
    /**
     * Implements hook rest.before.request.
     *
     * Every call carrying an MCP token must have a valid token and stay inside its scope; otherwise the call is vetoed with 401 or 403. Calls without the header, and mcpDiscovery itself, pass through.
     *
     * @param {object} ctx  ctx.subject: the incoming request ({ headers, operationId }).
     * @returns {Promise<void>}  nothing, or a veto.
     */
    "rest.before.request": async (ctx) => {
      const raw = (ctx.subject.headers || {})[HEADER];
      if (!raw || ctx.subject.operationId === "mcpDiscovery") return;
      const t = await findToken(ctx, raw);
      if (!t) return ctx.veto("missing, unknown, revoked or expired MCP token", 401);
      const op = (await ctx.plugins.operations({})).find((o) => o.operationId === ctx.subject.operationId);
      if (!op || !allowed(t, op)) return ctx.veto(`this MCP token may not call ${ctx.subject.operationId}`, 403);
    },
  },
};

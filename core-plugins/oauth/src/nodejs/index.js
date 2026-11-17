// OAuth 2.1 authorization server (Node). Mirrored in src/php/Plugin.php.
// Tokens are opaque random strings; only their SHA-256 is stored. Prefixes say what a string is:
// hax_ac_ authorization code, hax_at_ access token, hax_rt_ refresh token, hax_pt_ personal token.
import { createHash, randomBytes } from "node:crypto";

const GRANT_HEADER = "x-hax-oauth-grant";
const hash = (t) => createHash("sha256").update(String(t)).digest("hex");
const s256 = (v) => createHash("sha256").update(String(v)).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (prefix) => `${prefix}${randomBytes(24).toString("hex")}`;
const fail = (status, error, description) => ({ status, body: { error, error_description: description } });
const read = async (ctx, id) => (await ctx.storage.read(id)) || [];
const words = (s) => String(s || "").split(/\s+/).filter(Boolean);
const issuerOf = (ctx) => String(ctx.settings.issuer || "").replace(/\/+$/, "");
// what a resource and the grant header may see of a grant (never hashes, never other people's data)
const pub = (g) => ({ id: g.id, user: g.user, client_id: g.client_id, resource: g.resource, scopes: g.scopes, site: g.site });
const redirectWith = (uri, params) => uri + (uri.includes("?") ? "&" : "?") + Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
// https anywhere, http only on this machine (native and CLI clients); custom schemes are a later decision
const redirectAllowed = (u) => typeof u === "string" && (/^https:\/\/[^\s/?#]+/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(u));

/** Every active plugin that implements oauth.resource, with what it describes (unconfigured ones are left out). */
async function resources(ctx) {
  const out = [];
  for (const p of await ctx.plugins.list()) {
    if (!(p.implements || []).includes("oauth.resource")) continue;
    const r = await ctx.contracts.call("oauth.resource", "describe", {}, { plugin: p.id });
    if (r && !r.error && r.resource) out.push({ plugin: p.id, resource: r.resource, title: r.title || p.id, scopes: r.scopes || [] });
  }
  return out;
}

/** The scopes to grant: the ones asked for, all offered by the resource, or by default every read scope. */
function pickScopes(resource, requested) {
  const offered = resource.scopes.map((s) => s.scope);
  const asked = words(requested);
  if (asked.some((s) => !offered.includes(s))) return null;
  return asked.length ? asked : resource.scopes.filter((s) => !s.write).map((s) => s.scope);
}

/** Validate an authorization request (RFC 6749 4.1.1 + PKCE + RFC 8707); returns { error } or what consent shows. */
async function checkRequest(ctx, q) {
  if (q.response_type !== "code") return fail(400, "unsupported_response_type", "only response_type=code is supported");
  const client = (await read(ctx, "clients")).find((c) => c.client_id === q.client_id);
  if (!client) return fail(400, "invalid_client", "unknown client_id");
  if (!client.redirect_uris.includes(q.redirect_uri)) return fail(400, "invalid_request", "redirect_uri is not registered for this client");
  if (q.code_challenge_method !== "S256" || !q.code_challenge) return fail(400, "invalid_request", "PKCE with code_challenge_method=S256 is required");
  const resource = (await resources(ctx)).find((r) => r.resource === q.resource);
  if (!resource) return fail(400, "invalid_target", "resource is not something this server issues tokens for");
  const scopes = pickScopes(resource, q.scope);
  if (!scopes) return fail(400, "invalid_scope", `scope must be from: ${resource.scopes.map((s) => s.scope).join(" ")}`);
  return { client, resource, scopes };
}

async function issueTokens(ctx, grant) {
  const access = rand("hax_at_");
  const refresh = rand("hax_rt_");
  const minutes = Number(ctx.settings.accessTokenMinutes) || 60;
  const days = Number(ctx.settings.refreshTokenDays) || 30;
  const tokens = await read(ctx, "tokens");
  tokens.push({ id: `tok-${randomBytes(4).toString("hex")}`, hash: hash(access), kind: "access", grant: grant.id, expires: ctx.now() + minutes * 60000, revoked: false });
  tokens.push({ id: `tok-${randomBytes(4).toString("hex")}`, hash: hash(refresh), kind: "refresh", grant: grant.id, expires: ctx.now() + days * 86400000, revoked: false });
  await ctx.storage.write("tokens", tokens);
  return { access_token: access, token_type: "Bearer", expires_in: minutes * 60, refresh_token: refresh, scope: grant.scopes.join(" ") };
}

/** Revoke a grant and every token issued under it. */
async function revokeGrant(ctx, grantId) {
  const grants = await read(ctx, "grants");
  for (const g of grants) if (g.id === grantId) g.revoked = true;
  await ctx.storage.write("grants", grants);
  const tokens = await read(ctx, "tokens");
  for (const t of tokens) if (t.grant === grantId) t.revoked = true;
  await ctx.storage.write("tokens", tokens);
}

export default {
  operations: {
    /**
     * Implements operation oauthMetadata.
     *
     * Publishes the authorization server metadata (RFC 8414) MCP clients read first; core also serves it at /.well-known/oauth-authorization-server.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.settings.issuer, dynamicRegistration.
     * @returns {Promise<object>}  the metadata document.
     */
    async oauthMetadata(ctx) {
      const issuer = issuerOf(ctx);
      const api = `${issuer}/system/api/v1/plugins/oauth`;
      const scopes = [...new Set((await resources(ctx)).flatMap((r) => r.scopes.map((s) => s.scope)))];
      return {
        issuer,
        authorization_endpoint: `${issuer}/admin/oauth/authorize`,
        token_endpoint: `${api}/token`,
        revocation_endpoint: `${api}/revoke`,
        registration_endpoint: ctx.settings.dynamicRegistration === true ? `${api}/register` : null,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: scopes,
      };
    },
    /**
     * Implements operation oauthAuthorizeCheck.
     *
     * Validates an authorization request and describes it for the consent screen: which app, which resource, which scopes.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.user is the person signed in to the dashboard.
     * @param {object} req  req.query: the authorization request parameters.
     * @returns {Promise<object>}  { client, resource, scopes }, or a 400 { error, error_description }.
     */
    async oauthAuthorizeCheck(ctx, req) {
      const r = await checkRequest(ctx, req.query || {});
      if (r.status) return r;
      return {
        client: { client_id: r.client.client_id, client_name: r.client.client_name, redirect_uri: req.query.redirect_uri },
        resource: { resource: r.resource.resource, title: r.resource.title },
        scopes: r.resource.scopes.filter((s) => r.scopes.includes(s.scope)),
      };
    },
    /**
     * Implements operation oauthAuthorizeDecide.
     *
     * Records the person's answer: on approval it stores a grant and a single-use code bound to the PKCE challenge, then returns the redirect back to the app.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.user approves for themselves only.
     * @param {object} req  req.body: the same parameters as the check, plus approve and an optional site.
     * @returns {Promise<object>}  { redirect }, or a 400 { error, error_description }.
     */
    async oauthAuthorizeDecide(ctx, req) {
      const b = req.body || {};
      const r = await checkRequest(ctx, b);
      if (r.status) return r;
      if (b.approve !== true) return { redirect: redirectWith(b.redirect_uri, { error: "access_denied", state: b.state }) };
      const grant = { id: `grant-${randomBytes(4).toString("hex")}`, user: ctx.user ? ctx.user.id : null, client_id: r.client.client_id, client_name: r.client.client_name, resource: r.resource.resource, resourcePlugin: r.resource.plugin, scopes: r.scopes, site: b.site || null, created: ctx.now(), revoked: false };
      await ctx.storage.write("grants", [...(await read(ctx, "grants")), grant]);
      const code = rand("hax_ac_");
      const codes = (await read(ctx, "codes")).filter((c) => c.expires > ctx.now());
      codes.push({ hash: hash(code), grant: grant.id, client_id: grant.client_id, redirect_uri: b.redirect_uri, challenge: b.code_challenge, expires: ctx.now() + 60000 });
      await ctx.storage.write("codes", codes);
      return { redirect: redirectWith(b.redirect_uri, { code, state: b.state }) };
    },
    /**
     * Implements operation oauthToken.
     *
     * Exchanges a code and its PKCE verifier, or a refresh token, for an access token and a new refresh token; a refresh token used twice revokes its whole grant.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.settings.accessTokenMinutes, refreshTokenDays.
     * @param {object} req  req.body: grant_type and its parameters.
     * @returns {Promise<object>}  { access_token, token_type, expires_in, refresh_token, scope }, or a 400 { error, error_description }.
     */
    async oauthToken(ctx, req) {
      const b = req.body || {};
      const grants = await read(ctx, "grants");
      if (b.grant_type === "authorization_code") {
        const codes = await read(ctx, "codes");
        const c = codes.find((x) => x.hash === hash(b.code));
        if (!c || c.expires < ctx.now()) return fail(400, "invalid_grant", "unknown or expired code");
        await ctx.storage.write("codes", codes.filter((x) => x !== c)); // single use, even when the rest fails
        if (c.client_id !== b.client_id || c.redirect_uri !== b.redirect_uri) return fail(400, "invalid_grant", "client_id or redirect_uri does not match the code");
        if (s256(b.code_verifier) !== c.challenge) return fail(400, "invalid_grant", "code_verifier does not match the code_challenge");
        const grant = grants.find((g) => g.id === c.grant && !g.revoked);
        if (!grant) return fail(400, "invalid_grant", "the approval was revoked");
        if (b.resource && b.resource !== grant.resource) return fail(400, "invalid_target", "resource does not match the approval");
        return issueTokens(ctx, grant);
      }
      if (b.grant_type === "refresh_token") {
        const tokens = await read(ctx, "tokens");
        const t = tokens.find((x) => x.kind === "refresh" && x.hash === hash(b.refresh_token));
        if (!t) return fail(400, "invalid_grant", "unknown refresh token");
        if (t.revoked) {
          await revokeGrant(ctx, t.grant); // reuse of a rotated refresh token: assume it leaked
          return fail(400, "invalid_grant", "refresh token already used; the approval has been revoked");
        }
        const grant = grants.find((g) => g.id === t.grant && !g.revoked);
        if (!grant || t.expires < ctx.now()) return fail(400, "invalid_grant", "expired or revoked");
        if (b.client_id && b.client_id !== grant.client_id) return fail(400, "invalid_grant", "client_id does not match");
        t.revoked = true;
        await ctx.storage.write("tokens", tokens);
        return issueTokens(ctx, grant);
      }
      return fail(400, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
    },
    /**
     * Implements operation oauthRegister.
     *
     * Registers a public client (no secret) when dynamic registration is turned on; redirect URIs must be https, or http on this machine.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.settings.dynamicRegistration.
     * @param {object} req  req.body: { client_name, redirect_uris }.
     * @returns {Promise<object>}  201 with the client, 400, or 403 when registration is off.
     */
    async oauthRegister(ctx, req) {
      if (ctx.settings.dynamicRegistration !== true) return fail(403, "access_denied", "dynamic client registration is turned off on this server");
      const b = req.body || {};
      const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris : [];
      if (!uris.length || !uris.every(redirectAllowed)) return fail(400, "invalid_redirect_uri", "redirect_uris must be https, or http on localhost");
      const client = { client_id: `hax_client_${randomBytes(8).toString("hex")}`, client_name: String(b.client_name || "Unnamed app"), redirect_uris: uris, registered: "dynamic", created: ctx.now() };
      await ctx.storage.write("clients", [...(await read(ctx, "clients")), client]);
      return { status: 201, body: { client_id: client.client_id, client_name: client.client_name, redirect_uris: uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] } };
    },
    /**
     * Implements operation oauthRevoke.
     *
     * Revokes a token; a refresh or personal token takes its whole grant with it. Always answers 200 so it reveals nothing about the token.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.body.token: the token to revoke.
     * @returns {Promise<object>}  {}.
     */
    async oauthRevoke(ctx, req) {
      const tokens = await read(ctx, "tokens");
      const t = tokens.find((x) => x.hash === hash((req.body || {}).token));
      if (t && t.kind === "access") {
        t.revoked = true;
        await ctx.storage.write("tokens", tokens);
      } else if (t) await revokeGrant(ctx, t.grant);
      return {};
    },
    /**
     * Implements operation oauthGrantList.
     *
     * Lists the approvals the signed-in person has given and not revoked: which app, which resource, which scopes.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.user.
     * @returns {Promise<object>}  { items }.
     */
    async oauthGrantList(ctx) {
      const me = ctx.user ? ctx.user.id : null;
      return { items: (await read(ctx, "grants")).filter((g) => g.user === me && !g.revoked).map((g) => ({ id: g.id, client_id: g.client_id, client_name: g.client_name, resource: g.resource, scopes: g.scopes, site: g.site, created: g.created })) };
    },
    /**
     * Implements operation oauthGrantRevoke.
     *
     * Takes an app's access away: the grant and every token issued under it stop working at once.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.user may revoke only their own grants.
     * @param {object} req  req.params.id: the grant id.
     * @returns {Promise<object>}  { revoked: id }, or 404.
     */
    async oauthGrantRevoke(ctx, req) {
      const me = ctx.user ? ctx.user.id : null;
      const g = (await read(ctx, "grants")).find((x) => x.id === req.params.id && x.user === me && !x.revoked);
      if (!g) return { status: 404, body: { error: "not found" } };
      await revokeGrant(ctx, g.id);
      return { revoked: g.id };
    },
    /**
     * Implements operation oauthPersonalTokenCreate.
     *
     * Issues a token for a headless client (stdio MCP, a script) without the browser flow, for one resource and its scopes; the raw token is returned once.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.user.
     * @param {object} req  req.body: { label, resource, scope, site, expiresInDays }.
     * @returns {Promise<object>}  { id, token, scope, resource, expires }, or a 400 { error, error_description }.
     */
    async oauthPersonalTokenCreate(ctx, req) {
      const b = req.body || {};
      const resource = (await resources(ctx)).find((r) => r.resource === b.resource);
      if (!resource) return fail(400, "invalid_target", "resource is not something this server issues tokens for");
      const scopes = pickScopes(resource, b.scope);
      if (!scopes) return fail(400, "invalid_scope", `scope must be from: ${resource.scopes.map((s) => s.scope).join(" ")}`);
      const grant = { id: `grant-${randomBytes(4).toString("hex")}`, user: ctx.user ? ctx.user.id : null, client_id: "personal", client_name: String(b.label || "Personal token"), resource: resource.resource, resourcePlugin: resource.plugin, scopes, site: b.site || null, created: ctx.now(), revoked: false };
      await ctx.storage.write("grants", [...(await read(ctx, "grants")), grant]);
      const token = rand("hax_pt_");
      const expires = b.expiresInDays ? ctx.now() + b.expiresInDays * 86400000 : null;
      await ctx.storage.write("tokens", [...(await read(ctx, "tokens")), { id: `tok-${randomBytes(4).toString("hex")}`, hash: hash(token), kind: "personal", grant: grant.id, expires, revoked: false }]);
      return { id: grant.id, token, scope: scopes.join(" "), resource: resource.resource, expires };
    },
    /**
     * Implements operation oauthResourceList.
     *
     * Lists what tokens can be issued for (every configured oauth.resource implementer) and the scopes each accepts.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @returns {Promise<object>}  { items }.
     */
    async oauthResourceList(ctx) {
      return { items: await resources(ctx) };
    },
  },
  hooks: {
    /**
     * Implements hook rest.before.request.
     *
     * Drops any x-hax-oauth-grant header a client sent; for a request carrying one of this plugin's tokens, refuses it unless the token is live and the resource it was issued for allows the call, then passes the grant on in that header.
     *
     * @param {object} ctx  ctx.subject: the incoming request ({ method, path, operationId, plugin, headers }).
     * @returns {Promise<object>}  the request with the grant header set or removed, or a veto (401 bad token, 403 not allowed).
     */
    "rest.before.request": async (ctx) => {
      const s = ctx.subject;
      const headers = { ...(s.headers || {}) };
      delete headers[GRANT_HEADER];
      const m = /^Bearer\s+(hax_(?:at|pt)_[0-9a-f]+)$/i.exec(String(headers.authorization || ""));
      if (!m) return { ...s, headers };
      const t = (await read(ctx, "tokens")).find((x) => (x.kind === "access" || x.kind === "personal") && x.hash === hash(m[1]));
      const grant = t && !t.revoked && (!t.expires || t.expires > ctx.now()) ? (await read(ctx, "grants")).find((g) => g.id === t.grant && !g.revoked) : null;
      if (!grant) return ctx.veto("invalid, expired or revoked token", 401);
      const verdict = await ctx.contracts.call("oauth.resource", "check", { grant: pub(grant), request: { operationId: s.operationId, method: s.method, path: s.path, plugin: s.plugin } }, { plugin: grant.resourcePlugin });
      if (!verdict || verdict.allow !== true) return ctx.veto((verdict && verdict.message) || `this token may not call ${s.operationId}`, 403);
      headers[GRANT_HEADER] = JSON.stringify(pub(grant));
      return { ...s, headers };
    },
  },
};

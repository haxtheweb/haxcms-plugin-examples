// LTI 1.3 tool (Node). The rules live in lti.js; this file reads stores, fetches key sets and answers requests.
// Random values are opaque strings and only their SHA-256 is stored: hax_ls_ login state, hax_lt_ launch ticket.
import { createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import { findKey, parseJwt, validateLaunch, validatePlatform, verifyRs256 } from "./lti.js";

const STATE_MS = 5 * 60000;
const TICKET_MS = 60000;
const KEYSET_MS = 10 * 60000;
const hash = (t) => createHash("sha256").update(String(t)).digest("hex");
const rand = (prefix) => `${prefix}${randomBytes(24).toString("hex")}`;
const fail = (status, error, description) => ({ status, body: { error, error_description: description } });
const read = async (ctx, id, empty = []) => (await ctx.storage.read(id)) || empty;
const toolUrlOf = (ctx) => String(ctx.settings.toolUrl || "").replace(/\/+$/, "");
const apiOf = (ctx) => `${toolUrlOf(ctx)}/system/api/v1/plugins/lti`;
const withQuery = (uri, params) => uri + (uri.includes("?") ? "&" : "?") + Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
// what an admin sees of a registration: all of it (a registration holds no secrets)
const pub = (p) => ({ id: p.id, title: p.title, issuer: p.issuer, clientId: p.clientId, deploymentIds: p.deploymentIds, authUrl: p.authUrl, jwksUrl: p.jwksUrl });

/** Keep the egress setting equal to the registered key set URLs, so the plugin can reach those hosts and no others. */
async function syncEgress(ctx, platforms) {
  await ctx.config.save({ keysetUrls: [...new Set(platforms.map((p) => p.jwksUrl))].join("\n") });
}

/** The LMS's public keys: the cached copy while it is fresh and holds the kid, otherwise fetched again. */
async function keysetFor(ctx, platform, kid) {
  const cache = await read(ctx, "keysets", {});
  const hit = cache[platform.id];
  if (hit && hit.url === platform.jwksUrl && hit.fetchedAt + KEYSET_MS > ctx.now() && findKey(hit.jwks, kid)) return hit.jwks;
  const res = await ctx.fetch(platform.jwksUrl, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`key set answered ${res.status}`);
  const jwks = await res.json();
  cache[platform.id] = { url: platform.jwksUrl, fetchedAt: ctx.now(), jwks: { keys: Array.isArray(jwks && jwks.keys) ? jwks.keys : [] } };
  await ctx.storage.write("keysets", cache);
  return cache[platform.id].jwks;
}

/** This tool's key pair, made on first use. The private half stays in the system store. */
async function toolKeys(ctx) {
  const keys = await read(ctx, "keys", []);
  if (keys.length) return keys;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const kid = hash(`${jwk.n}.${jwk.e}`).slice(0, 16);
  const made = [{ kid, created: ctx.now(), public: { kty: "RSA", n: jwk.n, e: jwk.e, kid, alg: "RS256", use: "sig" }, private: privateKey.export({ format: "jwk" }) }];
  await ctx.storage.write("keys", made);
  return made;
}

/** Start an OIDC login: remember a state and nonce for five minutes and send the browser to the LMS. */
async function login(ctx, p) {
  if (!toolUrlOf(ctx)) return fail(400, "invalid_request", "the Tool URL setting is not set");
  if (!p.iss || !p.login_hint || !p.target_link_uri) return fail(400, "invalid_request", "iss, login_hint and target_link_uri are required");
  const matches = (await read(ctx, "platforms")).filter((x) => x.issuer === p.iss && (!p.client_id || x.clientId === p.client_id));
  if (!matches.length) return fail(400, "invalid_request", "this LMS is not registered with this tool");
  if (matches.length > 1) return fail(400, "invalid_request", "several registrations share this issuer; the LMS must send client_id");
  const platform = matches[0];
  if (p.lti_deployment_id && !platform.deploymentIds.includes(p.lti_deployment_id)) return fail(400, "invalid_request", "lti_deployment_id is not registered for this LMS");
  const state = rand("hax_ls_");
  const nonce = randomBytes(16).toString("hex");
  const states = (await read(ctx, "states")).filter((s) => s.expires > ctx.now());
  states.push({ hash: hash(state), nonce, platform: platform.id, target: p.target_link_uri, expires: ctx.now() + STATE_MS });
  await ctx.storage.write("states", states);
  const location = withQuery(platform.authUrl, { scope: "openid", response_type: "id_token", response_mode: "form_post", prompt: "none", client_id: platform.clientId, redirect_uri: `${apiOf(ctx)}/launch`, login_hint: p.login_hint, lti_message_hint: p.lti_message_hint, state, nonce });
  return { status: 302, headers: { location, "cache-control": "no-store" }, body: null };
}

export default {
  operations: {
    /**
     * Implements operation ltiLogin.
     *
     * Starts the OIDC login an LMS sends as a form POST: finds the registration for its issuer, remembers a single-use state and nonce, and sends the browser to the LMS's authorization endpoint.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.settings.toolUrl.
     * @param {object} req  req.body: iss, login_hint, target_link_uri and the optional client_id, lti_deployment_id, lti_message_hint.
     * @returns {Promise<object>}  a 302 to the LMS, or a 400 { error, error_description }.
     */
    async ltiLogin(ctx, req) {
      return login(ctx, req.body || {});
    },
    /**
     * Implements operation ltiLoginGet.
     *
     * The same login when the LMS sends it as a GET.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.settings.toolUrl.
     * @param {object} req  req.query: the same parameters as ltiLogin.
     * @returns {Promise<object>}  a 302 to the LMS, or a 400 { error, error_description }.
     */
    async ltiLoginGet(ctx, req) {
      return login(ctx, req.query || {});
    },
    /**
     * Implements operation ltiLaunch.
     *
     * Verifies the signed launch the LMS posts (state used once, RS256 signature against the LMS's key set, then every claim), and sends the browser to the launched address with a single-use ticket that says who arrived and whether they may edit.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.settings.toolUrl, instructorsEdit.
     * @param {object} req  req.body: { id_token, state }.
     * @returns {Promise<object>}  a 303 to the launched address, or a 400 { error, error_description }.
     */
    async ltiLaunch(ctx, req) {
      const b = req.body || {};
      const states = await read(ctx, "states");
      const state = states.find((s) => s.hash === hash(b.state));
      if (!state || state.expires < ctx.now()) return fail(400, "invalid_request", "unknown or expired state; start the launch again from the LMS");
      await ctx.storage.write("states", states.filter((s) => s !== state && s.expires > ctx.now())); // single use, even when the rest fails
      const platform = (await read(ctx, "platforms")).find((p) => p.id === state.platform);
      if (!platform) return fail(400, "invalid_request", "this LMS is no longer registered with this tool");
      const jwt = parseJwt(b.id_token);
      if (!jwt) return fail(400, "invalid_token", "id_token is not a signed token");
      if (jwt.header.alg !== "RS256" || !jwt.header.kid) return fail(400, "invalid_token", "id_token must be signed with RS256 and name its key (kid)");
      let jwks;
      try {
        jwks = await keysetFor(ctx, platform, jwt.header.kid);
      } catch (e) {
        ctx.log.warn(`could not read the key set of ${platform.title}: ${e.message}`);
        return fail(400, "invalid_token", "the LMS's public keys could not be read");
      }
      if (!verifyRs256(jwt, findKey(jwks, jwt.header.kid))) return fail(400, "invalid_token", "the signature does not match the LMS's public keys");
      const r = validateLaunch(jwt.claims, { platform, state, toolUrl: toolUrlOf(ctx), now: ctx.now(), instructorsEdit: ctx.settings.instructorsEdit });
      if (r.error) return fail(400, "invalid_token", r.error);
      const ticket = rand("hax_lt_");
      const launches = (await read(ctx, "launches")).filter((l) => l.expires > ctx.now());
      launches.push({ hash: hash(ticket), expires: ctx.now() + TICKET_MS, ...r.launch });
      await ctx.storage.write("launches", launches);
      ctx.log.info(`launch from ${platform.title} as ${r.launch.role}`);
      // in the fragment, so the ticket is never sent to a server by the redirect or in a Referer header
      return { status: 303, headers: { location: `${r.launch.target}#lti_launch=${ticket}`, "cache-control": "no-store" }, body: null };
    },
    /**
     * Implements operation ltiLaunchClaim.
     *
     * Exchanges a launch ticket, once and within 60 seconds, for who the LMS said the person is and whether they may edit; stands in for a core sign-in API.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.body.ticket: the ticket from the launch redirect.
     * @returns {Promise<object>}  { user, role, platform, context, resourceLink, target, site }, or a 400 { error, error_description }.
     */
    async ltiLaunchClaim(ctx, req) {
      const launches = await read(ctx, "launches");
      const l = launches.find((x) => x.hash === hash((req.body || {}).ticket));
      await ctx.storage.write("launches", launches.filter((x) => x !== l && x.expires > ctx.now()));
      if (!l || l.expires < ctx.now()) return fail(400, "invalid_grant", "unknown, used or expired launch ticket");
      const roles = [l.role];
      return {
        user: l.userId ? { id: l.userId, name: l.userId, displayName: l.name || "LMS user", roles, avatar: null } : null,
        role: l.role,
        ltiRoles: l.ltiRoles,
        platform: l.platform,
        deploymentId: l.deploymentId,
        context: l.context,
        resourceLink: l.resourceLink,
        target: l.target,
        site: l.site,
      };
    },
    /**
     * Implements operation ltiJwks.
     *
     * Publishes this tool's public keys for LMSs to register; the key pair is made on first use and the private half never leaves the server.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @returns {Promise<object>}  { keys }: public JWKs only.
     */
    async ltiJwks(ctx) {
      return { status: 200, headers: { "cache-control": "public, max-age=3600" }, body: { keys: (await toolKeys(ctx)).map((k) => k.public) } };
    },
    /**
     * Implements operation ltiToolConfiguration.
     *
     * Lists the addresses an admin pastes into the LMS when registering this tool.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.settings.toolUrl.
     * @returns {Promise<object>}  { loginUrl, redirectUrl, jwksUrl, targetLinkUri }.
     */
    async ltiToolConfiguration(ctx) {
      const api = apiOf(ctx);
      return { loginUrl: `${api}/login`, redirectUrl: `${api}/launch`, jwksUrl: `${api}/jwks`, targetLinkUri: `${toolUrlOf(ctx)}/` };
    },
    /**
     * Implements operation ltiPlatformList.
     *
     * Lists the LMSs registered with this tool.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @returns {Promise<object>}  { items }.
     */
    async ltiPlatformList(ctx) {
      return { items: (await read(ctx, "platforms")).map(pub) };
    },
    /**
     * Implements operation ltiPlatformSave.
     *
     * Adds or changes an LMS registration (https endpoints only, one registration per issuer and client id) and keeps the list of hosts the plugin may fetch keys from in step.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.body: { id?, title?, issuer, clientId, deploymentIds, authUrl, jwksUrl }.
     * @returns {Promise<object>}  the registration, or a 400 { error, error_description }.
     */
    async ltiPlatformSave(ctx, req) {
      const b = req.body || {};
      const problem = validatePlatform(b);
      if (problem) return fail(400, "invalid_request", problem);
      const platforms = await read(ctx, "platforms");
      const existing = b.id ? platforms.find((p) => p.id === b.id) : null;
      if (b.id && !existing) return fail(400, "invalid_request", "no registration has that id");
      if (platforms.some((p) => p !== existing && p.issuer === b.issuer && p.clientId === b.clientId)) return fail(400, "invalid_request", "that issuer and client id are already registered");
      const saved = { id: existing ? existing.id : `plat-${randomBytes(4).toString("hex")}`, title: String(b.title || b.issuer), issuer: b.issuer, clientId: b.clientId, deploymentIds: [...new Set(b.deploymentIds)], authUrl: b.authUrl, jwksUrl: b.jwksUrl };
      const next = existing ? platforms.map((p) => (p === existing ? saved : p)) : [...platforms, saved];
      await ctx.storage.write("platforms", next);
      await syncEgress(ctx, next);
      return pub(saved);
    },
    /**
     * Implements operation ltiPlatformDelete.
     *
     * Removes an LMS registration, its cached keys, its logins in progress and its unclaimed launches; launches from it stop working at once.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.params.id: the registration to remove.
     * @returns {Promise<object>}  { removed: id }, or a 404.
     */
    async ltiPlatformDelete(ctx, req) {
      const id = (req.params || {}).id;
      const platforms = await read(ctx, "platforms");
      if (!platforms.some((p) => p.id === id)) return fail(404, "not_found", "no registration has that id");
      const next = platforms.filter((p) => p.id !== id);
      await ctx.storage.write("platforms", next);
      const cache = await read(ctx, "keysets", {});
      delete cache[id];
      await ctx.storage.write("keysets", cache);
      await ctx.storage.write("states", (await read(ctx, "states")).filter((s) => s.platform !== id));
      await ctx.storage.write("launches", (await read(ctx, "launches")).filter((l) => l.platform.id !== id));
      await syncEgress(ctx, next);
      return { removed: id };
    },
  },
};

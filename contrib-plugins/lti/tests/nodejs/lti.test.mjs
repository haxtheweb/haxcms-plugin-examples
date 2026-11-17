// Node tests for the signed launch (node --test): an LMS key pair is made here and tokens are signed the way an LMS
// signs them, then sent through the reference harness so stores, egress, route security and settings are the real ones.
import test from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MemoryBackend } from "../../../../harness/memory-backend.mjs";
import * as L from "../../src/nodejs/lti.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../..");
const C = "https://purl.imsglobal.org/spec/lti/claim/";
const M = "http://purl.imsglobal.org/vocab/lis/v2/membership#";
const TOOL = "https://cms.example.edu";
const TARGET = `${TOOL}/sites/bio101/lesson-1`;
const NOW = Date.parse("2026-11-14T12:00:00Z");
const PLATFORM = { title: "Canvas", issuer: "https://canvas.example.edu", clientId: "10000000000001", deploymentIds: ["1:abc"], authUrl: "https://canvas.example.edu/api/lti/authorize_redirect", jwksUrl: "https://canvas.example.edu/api/lti/security/jwks" };

const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
function lmsKey(kid) {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } };
}
function sign(key, claims, header = {}) {
  const signed = `${b64({ alg: "RS256", typ: "JWT", kid: key.kid, ...header })}.${b64(claims)}`;
  return `${signed}.${createSign("RSA-SHA256").update(signed).sign(key.privateKey).toString("base64url")}`;
}
const KEY = lmsKey("canvas-1");

/** A backend with the plugin on, Canvas registered and its key set answering. */
async function setup({ settings = {}, key = KEY } = {}) {
  const backend = new MemoryBackend();
  await backend.load([dir], { settings: { lti: { toolUrl: TOOL, ...settings } } });
  backend.now = NOW;
  backend.fetchFakes = { "canvas.example.edu": { status: 200, body: { keys: [key.jwk] } } };
  const saved = await backend.call("ltiPlatformSave", { body: PLATFORM });
  assert.equal(saved.status, 200);
  return { backend, platform: saved.body };
}
/** What the LMS does first: start a login and read the state and nonce off the redirect. */
async function login(backend, target = TARGET) {
  const r = await backend.call("ltiLogin", { body: { iss: PLATFORM.issuer, login_hint: "user-7", target_link_uri: target, lti_message_hint: "hint-9", client_id: PLATFORM.clientId } }, { credentials: "none" });
  assert.equal(r.status, 302);
  const u = new URL(r.headers.location);
  return { url: u, state: u.searchParams.get("state"), nonce: u.searchParams.get("nonce") };
}
const claims = (nonce, over = {}) => ({
  iss: PLATFORM.issuer, aud: PLATFORM.clientId, sub: "a1b2c3", name: "Ada Lovelace", exp: NOW / 1000 + 300, iat: NOW / 1000, nonce,
  [`${C}message_type`]: "LtiResourceLinkRequest", [`${C}version`]: "1.3.0", [`${C}deployment_id`]: "1:abc", [`${C}target_link_uri`]: TARGET,
  [`${C}resource_link`]: { id: "rl-1", title: "Lesson 1" }, [`${C}roles`]: [`${M}Instructor`], [`${C}context`]: { id: "course-9", label: "BIO101", title: "Biology" },
  ...over,
});
const launch = (backend, state, token) => backend.call("ltiLaunch", { body: { id_token: token, state } }, { credentials: "none" });
const claim = (backend, ticket) => backend.call("ltiLaunchClaim", { body: { ticket } }, { credentials: "none" });
const ticketOf = (r) => new URL(r.headers.location).hash.replace("#lti_launch=", "");

test("the login redirect carries what OIDC and LTI require", async () => {
  const { backend } = await setup();
  const { url, state, nonce } = await login(backend);
  assert.equal(url.origin + url.pathname, PLATFORM.authUrl);
  const q = Object.fromEntries(url.searchParams);
  assert.deepEqual({ scope: q.scope, response_type: q.response_type, response_mode: q.response_mode, prompt: q.prompt, client_id: q.client_id, redirect_uri: q.redirect_uri, login_hint: q.login_hint, lti_message_hint: q.lti_message_hint },
    { scope: "openid", response_type: "id_token", response_mode: "form_post", prompt: "none", client_id: PLATFORM.clientId, redirect_uri: `${TOOL}/system/api/v1/plugins/lti/launch`, login_hint: "user-7", lti_message_hint: "hint-9" });
  assert.match(state, /^hax_ls_[0-9a-f]{48}$/);
  assert.match(nonce, /^[0-9a-f]{32}$/);
  // only hashes of the state are stored
  assert.ok(!JSON.stringify(backend.readStore(backend.get("lti"), "states")).includes(state));
});

test("an instructor's launch arrives as an editor, once", async () => {
  const { backend, platform } = await setup();
  const { state, nonce } = await login(backend);
  const r = await launch(backend, state, sign(KEY, claims(nonce)));
  assert.equal(r.status, 303);
  assert.ok(r.headers.location.startsWith(`${TARGET}#lti_launch=hax_lt_`));
  const ticket = ticketOf(r);
  assert.ok(!JSON.stringify(backend.readStore(backend.get("lti"), "launches")).includes(ticket), "only the ticket's hash is stored");
  const who = await claim(backend, ticket);
  assert.equal(who.status, 200);
  assert.deepEqual(who.body.user, { id: `lti:${platform.id}:a1b2c3`, name: `lti:${platform.id}:a1b2c3`, displayName: "Ada Lovelace", roles: ["editor"], avatar: null });
  assert.equal(who.body.role, "editor");
  assert.deepEqual(who.body.context, { id: "course-9", label: "BIO101", title: "Biology" });
  assert.deepEqual(who.body.resourceLink, { id: "rl-1", title: "Lesson 1" });
  assert.equal(who.body.target, TARGET);
  assert.equal((await claim(backend, ticket)).status, 400, "a ticket works once");
});

test("a learner arrives read-only, and so does a teacher when the deployment says so", async () => {
  let { backend } = await setup();
  let l = await login(backend);
  let who = await claim(backend, ticketOf(await launch(backend, l.state, sign(KEY, claims(l.nonce, { [`${C}roles`]: [`${M}Learner`] })))));
  assert.equal(who.body.role, "viewer");
  assert.deepEqual(who.body.user.roles, ["viewer"]);
  ({ backend } = await setup({ settings: { instructorsEdit: false } }));
  l = await login(backend);
  who = await claim(backend, ticketOf(await launch(backend, l.state, sign(KEY, claims(l.nonce)))));
  assert.equal(who.body.role, "viewer");
});

test("an anonymous launch can read but never edit", async () => {
  const { backend } = await setup();
  let l = await login(backend);
  const who = await claim(backend, ticketOf(await launch(backend, l.state, sign(KEY, claims(l.nonce, { sub: undefined, name: undefined, [`${C}roles`]: [`${M}Learner`] })))));
  assert.equal(who.body.user, null);
  assert.equal(who.body.role, "viewer");
  l = await login(backend);
  const r = await launch(backend, l.state, sign(KEY, claims(l.nonce, { sub: undefined })));
  assert.equal(r.status, 400);
  assert.match(r.body.error_description, /must identify the person/);
});

test("a state works once, and expires", async () => {
  const { backend } = await setup();
  let l = await login(backend);
  const token = sign(KEY, claims(l.nonce));
  assert.equal((await launch(backend, l.state, token)).status, 303);
  assert.equal((await launch(backend, l.state, token)).status, 400, "replay");
  l = await login(backend);
  backend.now = NOW + 5 * 60000 + 1;
  assert.equal((await launch(backend, l.state, sign(KEY, claims(l.nonce, { exp: backend.now / 1000 + 300, iat: backend.now / 1000 })))).status, 400, "expired state");
});

test("a failed launch burns its state", async () => {
  const { backend } = await setup();
  const l = await login(backend);
  assert.equal((await launch(backend, l.state, "not-a-token")).status, 400);
  assert.equal((await launch(backend, l.state, sign(KEY, claims(l.nonce)))).status, 400);
});

test("tokens the LMS did not sign are refused", async () => {
  const { backend } = await setup();
  const other = lmsKey("canvas-1"); // same kid, different key
  const cases = {
    "signed by another key": (n) => sign(other, claims(n)),
    "payload changed after signing": (n) => { const [h, , s] = sign(KEY, claims(n)).split("."); return `${h}.${b64(claims(n, { [`${C}roles`]: [`${M}Administrator`] }))}.${s}`; },
    "alg none": (n) => `${b64({ alg: "none", kid: "canvas-1" })}.${b64(claims(n))}.`,
    "HS256 with the public key as the secret": (n) => sign(KEY, claims(n), { alg: "HS256" }),
    "unknown kid": (n) => sign(lmsKey("nobody"), claims(n)),
  };
  for (const [name, make] of Object.entries(cases)) {
    const l = await login(backend);
    const r = await launch(backend, l.state, make(l.nonce));
    assert.equal(r.status, 400, name);
    assert.equal(r.body.error, "invalid_token", name);
  }
});

test("every claim is checked", async () => {
  const { backend } = await setup();
  const wrong = {
    "another issuer": { iss: "https://evil.example" },
    "another audience": { aud: "someone-else" },
    "several audiences without azp": { aud: [PLATFORM.clientId, "other"] },
    "azp for someone else": { azp: "other" },
    "expired": { exp: NOW / 1000 - 120 },
    "issued in the future": { iat: NOW / 1000 + 600 },
    "another nonce": { nonce: "0".repeat(32) },
    "unregistered deployment": { [`${C}deployment_id`]: "9:zzz" },
    "deep linking message": { [`${C}message_type`]: "LtiDeepLinkingRequest" },
    "LTI 1.1": { [`${C}version`]: "1.1.0" },
    "another target than the login named": { [`${C}target_link_uri`]: `${TOOL}/sites/other` },
    "no resource link": { [`${C}resource_link`]: undefined },
  };
  for (const [name, over] of Object.entries(wrong)) {
    const l = await login(backend);
    const r = await launch(backend, l.state, sign(KEY, claims(l.nonce, over)));
    assert.equal(r.status, 400, name);
    assert.equal(r.body.error, "invalid_token", name);
  }
  // several audiences are fine when azp names this tool
  const l = await login(backend);
  assert.equal((await launch(backend, l.state, sign(KEY, claims(l.nonce, { aud: [PLATFORM.clientId, "other"], azp: PLATFORM.clientId })))).status, 303);
});

test("a launch can only open an address of this HAXcms", async () => {
  const { backend } = await setup();
  for (const target of ["https://evil.example/phish", "https://cms.example.edu.evil.example/", "http://cms.example.edu/sites/bio101"]) {
    const l = await login(backend, target);
    const r = await launch(backend, l.state, sign(KEY, claims(l.nonce, { [`${C}target_link_uri`]: target })));
    assert.equal(r.status, 400, target);
    assert.match(r.body.error_description, /not an address of this HAXcms/);
  }
  assert.equal(L.underTool("https://cms.example.edu/hax", "https://cms.example.edu/haxor/x"), false, "a path prefix is not enough");
  assert.equal(L.underTool("https://cms.example.edu/hax/", "https://cms.example.edu/hax/sites/a"), true);
});

test("key sets are cached, and fetched again when the LMS rotates its key", async () => {
  const { backend } = await setup();
  const fetches = () => backend.fetchCalls.length;
  let l = await login(backend);
  assert.equal((await launch(backend, l.state, sign(KEY, claims(l.nonce)))).status, 303);
  assert.equal(fetches(), 1);
  l = await login(backend);
  assert.equal((await launch(backend, l.state, sign(KEY, claims(l.nonce)))).status, 303);
  assert.equal(fetches(), 1, "cached");
  const rotated = lmsKey("canvas-2");
  backend.fetchFakes = { "canvas.example.edu": { status: 200, body: { keys: [rotated.jwk] } } };
  l = await login(backend);
  assert.equal((await launch(backend, l.state, sign(rotated, claims(l.nonce)))).status, 303);
  assert.equal(fetches(), 2, "unknown kid: fetched again");
  l = await login(backend);
  assert.equal((await launch(backend, l.state, sign(KEY, claims(l.nonce)))).status, 400, "the old key is gone");
});

test("the plugin can reach registered key set hosts and no others", async () => {
  const { backend, platform } = await setup();
  const p = backend.get("lti");
  assert.deepEqual(backend.egressHosts(p), ["canvas.example.edu"]);
  await assert.rejects(backend.fetchFor(p, "https://elsewhere.example/keys"), /not allowed/);
  const l = await login(backend);
  assert.equal((await backend.call("ltiPlatformDelete", { params: { id: platform.id } })).status, 200);
  assert.deepEqual(backend.egressHosts(p), []);
  assert.equal((await launch(backend, l.state, sign(KEY, claims(l.nonce)))).status, 400, "logins in progress die with the registration");
});

test("an unreachable key set refuses the launch without a 500", async () => {
  const { backend } = await setup();
  backend.fetchFakes = { "canvas.example.edu": { status: 503, body: "busy" } };
  const l = await login(backend);
  const r = await launch(backend, l.state, sign(KEY, claims(l.nonce)));
  assert.equal(r.status, 400);
  assert.match(r.body.error_description, /public keys could not be read/);
});

test("the tool's own key pair is made once and only its public half is served", async () => {
  const { backend } = await setup();
  const a = await backend.call("ltiJwks", {}, { credentials: "none" });
  const b = await backend.call("ltiJwks", {}, { credentials: "none" });
  assert.deepEqual(a.body, b.body);
  assert.deepEqual(Object.keys(a.body.keys[0]).sort(), ["alg", "e", "kid", "kty", "n", "use"]);
});

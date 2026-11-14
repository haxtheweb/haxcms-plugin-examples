// LTI 1.3 launch rules, with no I/O: token parsing, signature check, claim validation and role mapping.
// The entry (index.js) reads stores and fetches key sets, then asks this module what the launch means.
import { createPublicKey, verify as verifySignature } from "node:crypto";

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const MEMBERSHIP = "http://purl.imsglobal.org/vocab/lis/v2/membership#";
// course-level roles that author content; institution and system roles never make someone an editor here
export const EDITOR_ROLES = [`${MEMBERSHIP}Instructor`, `${MEMBERSHIP}ContentDeveloper`, `${MEMBERSHIP}Administrator`];
export const CLOCK_SKEW_MS = 60000;

const b64urlToBuffer = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
const b64urlJson = (s) => JSON.parse(b64urlToBuffer(s).toString("utf8"));

/** Split a compact JWT into its parts without trusting any of it. Returns null when it is not three base64url parts of JSON. */
export function parseJwt(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  try {
    const header = b64urlJson(parts[0]);
    const claims = b64urlJson(parts[1]);
    if (!header || typeof header !== "object" || !claims || typeof claims !== "object") return null;
    return { header, claims, signed: `${parts[0]}.${parts[1]}`, signature: b64urlToBuffer(parts[2]) };
  } catch {
    return null;
  }
}

/** The key of a JWKS that signed this token: same kid, an RSA key, and not marked for anything but signing. */
export function findKey(jwks, kid) {
  const keys = jwks && Array.isArray(jwks.keys) ? jwks.keys : [];
  return keys.find((k) => k && k.kty === "RSA" && k.kid === kid && (!k.use || k.use === "sig") && (!k.alg || k.alg === "RS256")) || null;
}

/** RS256 only: the algorithm comes from this code, never from the token's header. */
export function verifyRs256(jwt, jwk) {
  if (!jwt || jwt.header.alg !== "RS256" || !jwk) return false;
  try {
    const key = createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
    return verifySignature("RSA-SHA256", Buffer.from(jwt.signed), key, jwt.signature);
  } catch {
    return false;
  }
}

/** editor for course authors (when the deployment allows it), viewer for everyone else. */
export function roleFor(roles, { instructorsEdit = true } = {}) {
  const list = Array.isArray(roles) ? roles : [];
  return instructorsEdit !== false && list.some((r) => EDITOR_ROLES.includes(r)) ? "editor" : "viewer";
}

/** Whether an address is this tool's own: same origin as the tool URL and at or under its path. */
export function underTool(toolUrl, target) {
  try {
    const base = new URL(String(toolUrl).replace(/\/+$/, "") + "/");
    const t = new URL(String(target));
    return t.origin === base.origin && (t.pathname + "/").startsWith(base.pathname);
  } catch {
    return false;
  }
}

/**
 * Check the claims of a launch whose signature already verified. Returns { error } naming the first rule broken, or
 * { launch } with what the rest of HAXcms needs. Nothing here reads the header: it was used only to pick the key.
 */
export function validateLaunch(claims, { platform, state, toolUrl, now, instructorsEdit }) {
  const bad = (description) => ({ error: description });
  if (claims.iss !== platform.issuer) return bad("iss is not the issuer of this registration");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(platform.clientId)) return bad("aud does not include this tool's client id");
  if (aud.length > 1 && claims.azp !== platform.clientId) return bad("azp must be this tool's client id when aud lists several");
  if (claims.azp !== undefined && claims.azp !== platform.clientId) return bad("azp is not this tool's client id");
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now - CLOCK_SKEW_MS) return bad("the launch has expired");
  if (typeof claims.iat !== "number" || claims.iat * 1000 > now + CLOCK_SKEW_MS) return bad("iat is in the future");
  if (!claims.nonce || claims.nonce !== state.nonce) return bad("nonce does not match the login this launch answers");
  if (!platform.deploymentIds.includes(claims[`${CLAIM}deployment_id`])) return bad("deployment_id is not registered for this LMS");
  if (claims[`${CLAIM}message_type`] !== "LtiResourceLinkRequest") return bad("only LtiResourceLinkRequest launches are supported");
  if (claims[`${CLAIM}version`] !== "1.3.0") return bad("only LTI version 1.3.0 is supported");
  const target = claims[`${CLAIM}target_link_uri`];
  if (!target || target !== state.target) return bad("target_link_uri does not match the login this launch answers");
  if (!underTool(toolUrl, target)) return bad("target_link_uri is not an address of this HAXcms");
  const link = claims[`${CLAIM}resource_link`];
  if (!link || !link.id) return bad("resource_link.id is required");
  const roles = Array.isArray(claims[`${CLAIM}roles`]) ? claims[`${CLAIM}roles`] : [];
  const role = roleFor(roles, { instructorsEdit });
  // an anonymous launch (no sub) can read; it can never edit, because nothing says who would be editing
  if (!claims.sub && role === "editor") return bad("an editor launch must identify the person (sub)");
  const context = claims[`${CLAIM}context`] || null;
  const custom = claims[`${CLAIM}custom`] || {};
  return {
    launch: {
      userId: claims.sub ? `lti:${platform.id}:${claims.sub}` : null,
      name: claims.name || claims.given_name || null,
      role,
      ltiRoles: roles,
      platform: { id: platform.id, title: platform.title },
      deploymentId: claims[`${CLAIM}deployment_id`],
      context: context ? { id: context.id || null, label: context.label || null, title: context.title || null } : null,
      resourceLink: { id: link.id, title: link.title || null },
      target,
      site: typeof custom.site === "string" ? custom.site : null,
    },
  };
}

/** What a registration must hold before it is saved; https only, so keys and logins never travel in the clear. */
export function validatePlatform(b) {
  const https = (u) => typeof u === "string" && /^https:\/\/[^\s/?#]+/i.test(u);
  if (!b || typeof b.issuer !== "string" || !b.issuer.trim()) return "issuer is required";
  if (typeof b.clientId !== "string" || !b.clientId.trim()) return "clientId is required";
  if (!Array.isArray(b.deploymentIds) || !b.deploymentIds.length || !b.deploymentIds.every((d) => typeof d === "string" && d)) return "deploymentIds must list at least one deployment id";
  if (!https(b.authUrl)) return "authUrl must be an https URL";
  if (!https(b.jwksUrl)) return "jwksUrl must be an https URL";
  return null;
}

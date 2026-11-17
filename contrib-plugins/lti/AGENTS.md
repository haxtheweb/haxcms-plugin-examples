# AGENTS.md (lti)

## Purpose
HAXcms as an LTI 1.3 tool: OIDC login initiation, signed launch verification, this tool's key set, LMS registrations, and the role a launch arrives with. It verifies identity; starting the session is core's (spec/GAPS.md item 1w).

## Layout
- `config/openapi.yaml`: system-scope routes. Login, launch, claim and key set are public; registrations and configuration need both credentials.
- `config/datastores.yaml`: `platforms` (registrations), `states` (logins in progress), `keysets` (LMS public keys, cached), `keys` (this tool's key pair), `launches` (tickets waiting to be claimed).
- `src/nodejs/lti.js`: the rules, with no I/O: token parsing, RS256 check, claim validation, role mapping.
- `src/nodejs/index.js`: stores, key set fetches and responses.
- `tests/cases/lti.yaml`: cases that need no signed token. `tests/nodejs/lti.test.mjs`: the signed launch, with a key pair made in the test.

## Rules
- RS256 only. The algorithm is fixed in code; a token's header is used to pick the key and for nothing else.
- A state and a ticket work once. Remove them before any other check, so a failed attempt cannot be retried.
- Store only hashes of states and tickets.
- A launch may only open an address at or under the Tool URL, and it must be the address its login named.
- Never accept a role, a user id or a site from the request: they come from verified claims only.
- Only course-level roles make an editor. An anonymous launch (no `sub`) is never an editor.
- Fetch only registered key set URLs. `ltiPlatformSave` and `ltiPlatformDelete` keep the `keysetUrls` setting equal to them; nothing else writes it.
- Never return or log the private half of a key in `keys`, a state, a nonce or a ticket.
- System scope only: this plugin vouches for who someone is, so the auth rule in spec/03 applies.

## Build, test, validate
`node scripts/validate.mjs contrib-plugins/lti`; `node harness/run-cases.mjs contrib-plugins/lti`; `node --test contrib-plugins/lti/tests/nodejs/lti.test.mjs`.

## Diagnose
- "this LMS is not registered": the login's `iss` (and `client_id`, when sent) match no registration.
- "unknown or expired state": the launch came more than five minutes after the login, was replayed, or the browser lost its place; start again from the LMS.
- "the LMS's public keys could not be read": the key set URL failed; the log has the status. Check the registration's `jwksUrl`.
- "the signature does not match": wrong `jwksUrl` for this LMS, or the LMS rotated keys and its key set has not caught up.
- A teacher arrives read-only: **Teachers can edit** is off, or the LMS sent no course-level Instructor, Content Developer or Administrator role.

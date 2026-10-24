# AGENTS.md (open-media-apps)

## Purpose
Keyless appstore providers as a declarative pack.

## Rules
- Only providers that need no key belong here; a provider with a key is its own plugin with an x-hax-proxy (see core-plugins/vimeo).
- Fragments follow @haxtheweb/appstore-spec; keep `connection.url` pointing at the public API.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/open-media-apps`.

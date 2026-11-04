# AGENTS.md (appstore-sketchfab)

## Purpose
Keyless appstore provider (Sketchfab) as a declarative pack.

## Rules
- Only keyless providers are packs; a provider that needs a key is a plugin with an x-hax-proxy (see contrib-plugins/vimeo).
- The fragment follows @haxtheweb/appstore-spec; keep connection.url pointing at the public API.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/appstore-sketchfab`.

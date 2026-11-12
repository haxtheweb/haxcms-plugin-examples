# AGENTS.md (appstore-nasa)

## Purpose
Keyless appstore provider (NASA) as a declarative pack.

## Rules
- Only keyless providers the browser can call as they are become packs; a provider that needs a key is a plugin with an x-hax-proxy (see contrib-plugins/vimeo); one whose API cannot answer the browse as asked (no search, no images) is a plugin with an operation (see contrib-plugins/pokeapi).
- The fragment follows @haxtheweb/appstore-spec; keep connection.url pointing at the public API.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/appstore-nasa`.

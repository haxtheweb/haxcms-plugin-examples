# AGENTS.md (pokeapi)

## Purpose
Appstore provider for PokeAPI plus the `pokeapi-card` block it inserts. Keyless, but not a pack: PokeAPI cannot search and its list has no images, so the plugin answers the browse from a cached copy of the list.

## Layout
- `frontend/dist/pokeapi-data.js`: pure data shaping (search, cards). No I/O. Imported by the card and by `src/nodejs/index.js`; `src/php/Plugin.php` ports `searchIndex` and its helpers. Change both runtimes together.
- `frontend/dist/pokeapi-card.js`: the block. Plain custom element, no dependencies, shadow DOM, DDD tokens with fallbacks, `light-dark()` for color schemes.
- `config/`: route (`pokeapiSearch`), settings form and defaults, the `index` store.
- `registries/appstore/pokeapi.json`: gizmo type `pokemon`; `pokeapi-card.haxProperties.json` `handles` maps the gizmo `id` to the `pokemon` attribute.

## Rules
- Never send the key to pokeapi.co. `headersFor` leaves it off for the public host, `config.before.save` refuses it there, and `x-secret-egress` makes the platform refuse it anywhere but the mirror. Keep all three.
- Only `limit` and `offset` may go to PokeAPI; it blocks other query parameters and paths with `. , * % ; : ' ! @ + [`.
- Keep the card's front-end API (`pokemon`, `flipped`, `lang`, `api-base`) stable once content uses it.
- The card fetches in the reader's browser and must keep working with no plugin server (static publish).
- Use `ctx.now()`, never the runtime clock, so cache expiry is testable.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/pokeapi` (Node, PHP and parity); element tests with `npx web-test-runner "test/**/*.test.js" --node-resolve`.

## Diagnose
- Search answers 502: PokeAPI (or the mirror) is unreachable and no list is stored yet; see the log.
- Search ignores a new Pokémon: the stored list is younger than `cacheHours`.
- A card says it could not load: the name is misspelled, or the reader's network blocks pokeapi.co.

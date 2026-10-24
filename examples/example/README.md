# example (awesome)

The comprehensive example: implements **every** hook in `schema/hooks.json` (a log line or a comment about what you could do there), plus every extension point:

- a `.awesome` file type (`awesomeFile` extends `file`)
- an `awesome-explosion` block element, with `haxProperties`
- an `awesome-explosions` theme built on the theme base, and an `awesome-awesomer-theme` child theme (the tag keeps the `awesome-` prefix) that extends it
- an `awesome` skeleton that fills a page with explosions
- an injected singleton (`awesome-counter`) arriving through `output.alterPage`
- Merlin options: a module program (explode the page) and a static option
- a settings form with a secret field, a public operation, an entity annotation, and a veto (`entity.before.create` rejects files named `boring.awesome`)
- a message overlay (`registries/locales/en.yaml`)

CI (`npm test`) fails if a hook in `schema/hooks.json` is missing from `plugin.yaml`, `src/nodejs/index.js` or `src/php/Plugin.php`. A new hook must be added to the spec and demonstrated here in the same change.

Backend code is placeholder until the loader exists; the declarative parts are validated today with `node scripts/validate.mjs examples/example`.

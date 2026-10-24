# game-pack

The concept games from `@haxtheweb/micro-game-base` (concept quest, concept map, concept runner) as one pack. Enabling it for a site adds the three blocks to that site's editor; published sites hydrate the games either way, because `wc-registry.json` and the CDN already carry them.

It is a `pack`: registry entries only, no backend code, no tests required. Its entries point at the package (`@haxtheweb/micro-game-base/lib/...`) instead of files in the plugin, which is how a pack groups elements published elsewhere. `siteTypes: [course]` lets announcements suggest it to course sites.

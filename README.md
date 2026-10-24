# haxcms-plugin-examples

Specification, JSON Schema, validator, conformance cases and example plugins for the HAXcms plugin architecture.

The architecture decisions and their log live in https://github.com/haxtheweb/issues/issues/3176. This repository is where the contract takes concrete shape so it can be reviewed before it is integrated into haxcms-nodejs and haxcms-php.

| Path | What |
|---|---|
| `spec/` | the specification, a changelog with upgrade recipes, and the gap list |
| `schema/` | JSON Schemas (`plugin.yaml`, Merlin declarations, theme and element registry entries, stores, entities, prompts, test cases, hook contracts; appstore fragments use https://github.com/haxtheweb/appstore-spec), the hook contracts (`hook-contracts.json`, source of the spec/06 table), capabilities, categories and derived tags |
| `scripts/validate.mjs` | `hax-plugin-validate`: validates a plugin folder and its registries |
| `scripts/check-core-config.mjs` | checks a live HAXcms `coreConfig` folder against the schemas |
| `core-plugins/` | drafts of real core plugins, extracted from today's HAXcms or new, to prove the spec: announcements, cookie-consent, google-analytics, regions, author-profile, pwa, git, agent-skills, outline, files, log, mcp, importer-html, importer-wordpress, feeds, sitemap, search, page-cache (Node and PHP code, tests, parity); youtube, vimeo, giphy, unsplash, flickr (declarative `x-hax-proxy`, no code); game-pack and open-media-apps (packs) |
| `contrib-plugins/` | 25 fake community plugins that probe the topology: packs (neon-theme-pack, workshop-skeleton-pack, music-blocks, onboarding-tour), Node and PHP (comments, reading-time, seo-meta) and Node only (plausible-analytics, rsync-deploy, a11y-check, spam-guard, notifications, changelog, publish-scheduler, maintenance-mode, csp-headers, minify-html, webhooks, glossary, api-docs, media-library, xapi-statements, site-stats, dark-mode-toggle, link-checker) |
| `examples/` | the comprehensive teaching `example`, `data-store`, `minimal-pack` |
| `skills/` | draft agent skills for building, auditing, upgrading and porting plugins |
| `scripts/gen-example-hooks.py`, `scripts/hook-table.mjs` | regenerate the example's hook stubs and the spec/06 table from the hook contracts |
| `harness/` | the reference harness: an in-memory implementation of the backend platform contract (spec/13) that runs plugins' executable cases in Node and PHP (`hax-plugin-test`) |
| `conformance/` | language-neutral cases every backend must pass, with fixture plugins; `node conformance/run.mjs` runs the executable ones |
| `tests/` | fixtures and the checks `npm test` runs, including each example's own tests and the Node/PHP parity run |

Work lands here through pull requests for review; nothing is merged without maintainer approval.

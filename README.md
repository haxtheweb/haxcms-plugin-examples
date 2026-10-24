# haxcms-plugin-examples

Specification, JSON Schema, validator, conformance cases and example plugins for the HAXcms plugin architecture.

The architecture decisions and their log live in https://github.com/haxtheweb/issues/issues/3176. This repository is where the contract takes concrete shape so it can be reviewed before it is integrated into haxcms-nodejs and haxcms-php.

| Path | What |
|---|---|
| `spec/` | the specification, a changelog with upgrade recipes, and the gap list |
| `schema/` | JSON Schemas (`plugin.yaml`, Merlin declarations, theme and element registry entries, stores, entities, prompts, test cases, hook contracts; appstore fragments use https://github.com/haxtheweb/appstore-spec), the hook contracts (`hook-contracts.json`, source of the spec/06 table), capabilities, categories and derived tags |
| `scripts/validate.mjs` | `hax-plugin-validate`: validates a plugin folder and its registries |
| `scripts/check-core-config.mjs` | checks a live HAXcms `coreConfig` folder against the schemas |
| `core-plugins/` | 35 drafts of real core plugins, extracted from today's HAXcms or new, to prove the spec: required (outline, files, git, agent-skills, log), site features (announcements, cookie-consent, google-analytics, regions, author-profile, pwa, mcp, feeds, sitemap, search, page-cache, game-pack), file importers (import-docx, -pdf, -pptx, -xlsx, -markdown, -html) and site importers (importer-haxcms, -html, -wordpress, -drupal, -elmsln, -gitbook, -notion, -openstax, -plone, -pressbooks, -quarto, -vitepress). The list in spec/12 is generated from the folders. |
| `contrib-plugins/` | 35 community plugins that probe the topology, off by default: showcase integrations (appstore-nasa, -sketchfab, -dailymotion, -wikipedia, -cc-mixter, youtube, vimeo, giphy, unsplash, flickr), packs (neon-theme-pack, workshop-skeleton-pack, music-blocks, onboarding-tour) and features (comments, reading-time, seo-meta, plausible-analytics, rsync-deploy, a11y-check, spam-guard, notifications, changelog, publish-scheduler, maintenance-mode, csp-headers, minify-html, webhooks, glossary, api-docs, media-library, xapi-statements, site-stats, dark-mode-toggle, link-checker) |
| `examples/` | the comprehensive teaching `example`, `data-store`, `minimal-pack` |
| `skills/` | draft agent skills for building, auditing, upgrading and porting plugins |
| `scripts/gen-example-hooks.py`, `scripts/hook-table.mjs` | regenerate the example's hook stubs and the spec/06 table from the hook contracts |
| `harness/` | the reference harness: an in-memory implementation of the backend platform contract (spec/13) that runs plugins' executable cases in Node and PHP (`hax-plugin-test`) |
| `conformance/` | language-neutral cases every backend must pass, with fixture plugins; `node conformance/run.mjs` runs the executable ones |
| `tests/` | fixtures and the checks `npm test` runs, including each example's own tests and the Node/PHP parity run |

Work lands here through pull requests for review; nothing is merged without maintainer approval.

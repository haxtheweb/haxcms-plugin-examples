# Plugin candidates and priority

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

**Drafted so far: 77 plugins** to find the topology and its rough edges (any may be removed after review). Core (42, `core-plugins/`): agent-skills, announcements, author-profile, cookie-consent, feeds, files, game-pack, git, google-analytics, import-docx, import-frontmatter, import-html, import-markdown, import-pdf, import-pptx, import-source, import-xlsx, importer-cartridge, importer-drupal, importer-elmsln, importer-gitbook, importer-grav, importer-haxcms, importer-hugo, importer-jekyll, importer-html, importer-notion, importer-openstax, importer-plone, importer-pressbooks, importer-quarto, importer-vitepress, importer-wordpress, log, mcp, oauth, outline, page-cache, pwa, regions, search, sitemap. Community (35, `contrib-plugins/`): a11y-check, api-docs, appstore-cc-mixter, appstore-dailymotion, appstore-nasa, appstore-sketchfab, appstore-wikipedia, changelog, comments, csp-headers, dark-mode-toggle, flickr, giphy, glossary, link-checker, maintenance-mode, media-library, minify-html, music-blocks, neon-theme-pack, notifications, onboarding-tour, plausible-analytics, publish-scheduler, reading-time, rsync-deploy, seo-meta, site-stats, spam-guard, unsplash, vimeo, webhooks, workshop-skeleton-pack, xapi-statements, youtube. File importers (`import-*`) implement the `import.file` contract and are picked by file extension; site importers (`importer-*`) implement `import.platform` and the person picks one. Showcase integrations (NASA and the other keyless appstore apps, YouTube, Vimeo, Giphy, Unsplash, Flickr) are contrib and off by default; each is its own plugin. What each batch forced the spec to add is in GAPS.md (items 1k to 1r).

A working list for scoping the refactor, built from the hook examples in spec/06. Nothing here is committed: it shows which extension points real plugins would lean on, which current core features could move out, and in what order. Announcements (https://github.com/haxtheweb/issues/issues/3172) is always the first vehicle.

**Where it comes from:** "extract" means the behavior exists in HAXcms core today and would move into a plugin (its settings migrate through `plugin.after.install`); "new" means it does not exist yet.

**Tiers:** core required (always on, cannot be disabled), core optional (ships with HAXcms, enabled per system or site), first-party contrib (published by the project, installed when wanted), HAXiam (deployment-specific), fixture (examples and tests only).

## Core required

| Plugin | What it does | From | Key hooks and registries |
|---|---|---|---|
| `announcements` | What's New and HAX Tips for users and site owners (`core-plugins/announcements`) | new | package stores, system-scope routes, `plugin.before.enable`, `plugin.after.upgrade`, Merlin `api` programs, a dashboard contribution (no front-end code) |
| `agent-skills` | publishes `site` and `system` skills from enabled plugins into `.well-known/agent-skills` | extract (`rebuildAgentSkills`) | `rebuild.after`, `plugin.after.enable` / `.disable` |
| default theme pack | the default theme (today `clean-two`) and its siblings as a `pack` | extract | theme registry only |
| `outline` | the outline editor: page tree operations and the editor UI; depends on `git` | extract | see below |
| `git` | commits after saves, history and revert; defines `git.*` | extract | defines `git.before.commit` / `git.after.commit`; `page.after.save`, `manifest.after.save` |
| `files` | file manager, uploads, upload targets for the editor; defines the `file.*` aliases | extract | `file` entity, upload routes, appstore upload app, `file.*` |

Required core plugins load automatically and cannot be disabled; making them plugins is about structure. Each one has its own folder, manifest, contract, tests and AGENTS.md, so the code is modular, testable and maintainable in isolation, and the same rules that bind contributors bind core.

### How the outline editor works as a plugin

- **Data stays core.** Pages remain `page` entities and the tree remains `site.json` (`items` with `parent` and `order`). The `outline` plugin owns the operations on them, not the storage.
- **Routes.** Its contract defines the outline operations (add, move, indent, outdent, rename, delete, reorder, bulk apply), mounted at `/v1/plugins/outline/`, with `legacy` aliases for today's outline endpoints so existing callers and https://github.com/haxtheweb/haxcms-mcp keep working.
- **Hooks it causes.** It opens a bulk transaction for a multi-step edit. Each operation runs through the entity service, so `page.before.save` / `page.after.save`, `page.before.delete` / `page.after.delete` and `manifest.before.save` / `manifest.after.save` fire as usual, then `git` commits once at the end of the transaction. Other plugins extend the outline through those hooks (for example `regions` keeping region pages out of the menu) without touching the editor.
- **UI.** The editor element is registered in the element registry with the `outline-` prefix and opened from an admin panel and from Merlin options (`kind: module` programs for "add page", "move page").
- **Skills and prompts.** A `site` skill teaches agents the outline operations; a `developer` skill covers the editor code.
- **Tests.** Its cases cover every operation in both runtimes, which today is spread across the backends.

## Core optional

| Plugin | What it does | From | Key hooks and registries |
|---|---|---|---|
| `log` | the unified log and log page; optional (health chips work without it) | new | every failure path writes to it; `schedule.after.run`, `user.after.login` |
| `oauth` | OAuth 2.1 authorization server: consent, PKCE codes, rotating refresh tokens, audience-bound tokens, revocation, personal tokens; defines the `oauth.resource` contract | new | `rest.before.request`; calls `oauth.resource` implementers |
| `mcp` | the MCP switch (`enabled` = plugin on, `readOnly` setting), an `oauth.resource` for the haxcms-mcp URL, and discovery for https://github.com/haxtheweb/haxcms-mcp; requires `oauth`; HAXiam blocks it for now | extract (`mcp.enabled`, `mcp.readOnly`) | implements `oauth.resource`; `register.after.prompts` |
| `cookie-consent` | consent state and banner | new | `render.after.body`, `privacy` declarations of other plugins |
| `google-analytics` | consent-gated analytics loader | extract (`gaID`) | `plugin.after.install`, `config.before.save`, `plugin.before.requirements`, `render.before.head`; requires `cookie-consent` |
| `regions` | region content with its own storage type; themes keep rendering `site-region` | extract (`regions`) | `manifest.before.save`, `plugin.after.install`, own store |
| `author-profile` | author contact and social links | extract (`phone`, `location`, `socialLink`, …) | `plugin.after.install`, `render.before.head` |
| `pwa` | service worker and forced upgrade | extract (`sw`, `forceUpgrade`) | `rebuild.after`, `render.before.head` |
| appstore providers | one plugin per media provider (YouTube, NASA image search, …) with secrets brokered by its route | extract | appstore registry, routes, `settings:secret` |
| `page-cache` | serves cached pages and stores rendered output | new | `render.before` (respond), `render.after`, `page.after.save`, `manifest.after.save`, `plugin.after.disable` |
| `ssr` | server-side renders custom elements | new | `render.before.content` |
| `search` | site and system search indexes | new | `entity.after.*`, `page.after.save`, `site.after.archive`, `rebuild.after` |
| `views` | saved queries, feeds and snapshots | new | entities, contracts `views.source` / `views.display`, `register.before.routes`, `rebuild.after` |
| `comments` | threaded comments with moderation | new | entity in `siteData` with `personalData`, `entity.before.create` / `.read`, `entity.after.delete` cascade, `render.after.body` |
| importers | one plugin per platform (implements `import.platform`) | extract (the existing site importers) | `register.before.contracts`, `site.before.create` |
| exporters | PDF, EPUB, DOCX and other formats | extract (PDF export) / new | `site.after.export` |
| `seo-plus` | advanced SEO and AI/LLM tuning beyond the core baseline | new | `render.before.head`, `rebuild.after` |
| `scheduler-timer` | runs schedules from page requests and a timer where cron is unavailable | new | `rebuild.*`, its own timer; calls the schedule runner |
| `config-backup` | copies every config change elsewhere | new | `config.after.save` with `config: ["*"]` |
| `rsync-deploy` | pushes a site after each commit | new | `git.after.commit` (`detached`), `exec: [rsync]` |

## First-party contrib (ideas)

`a11y-check` (`page.before.save`, `render.after.content`), `spam` (`entity.before.create`), `notifications` (after hooks; needs the reserved mail transport), `changelog` (`git.before.commit`), `glossary` (`render.before.content`), `csp` (`render.after.head`), `minify` (`render.after`), `maintenance-mode` (`render.before.body`, `schedule.before.run`), `retention` (`site.before.delete` / `.duplicate`), `lms-sync` (`site.before.archive`), `xapi` (`page.after.save`, `user.after.login`), `onboarding` (`plugin.after.requirements`), `api-docs` (`register.after.routes`), `schema-report` (`register.after.entities`), `media-library` (`entity.before.delete`, `plugin.after.uninstall`).

## HAXiam

`sso` (`user.before.login`), `institution-skeleton` (`site.before.create`), `multi-tenant` (`config.after.read`), institution packs such as the PSU pack (themes, skeletons, elements, locale overlay, restricted assets; locked).

## Packs

Element packs enabled per site and chosen by skeletons (spec/07): instructional blocks, quizzing and assessment, comments UI, media, plus theme packs. Blogs and courses get different defaults, which keeps the author's block list short.

## Fixtures

`example` (every hook), `minimal-pack`, `data-store`, a provider-contract pair, a restricted-assets pack (spec/10).

## Priority

1. **Vehicle:** `announcements`, with the fixtures and `log` alongside so health, requirements and tests are exercised from the start. The required core plugins (`outline`, `git`, `files`, `agent-skills`) are carved out as the refactor reaches each area.
2. **Prove settings migration and output injection on small extractions:** `cookie-consent` + `google-analytics`, `author-profile`, `regions`, one appstore provider.
3. **Platform features that test the hard hooks:** `page-cache`, `ssr`, `search`, `views`, `comments`, `agent-skills`, `mcp`, `scheduler-timer`.
4. **Bulk extractions and contrib:** importers, exporters, remaining appstore providers, `pwa`, `seo-plus`, deploy targets, contrib ideas.

Every hook in spec/06 has at least one candidate here; a hook no candidate needs would be a reason to drop it.

## Design notes: OAuth and MCP

Moved here from spec/05: these describe two candidate plugins (`oauth`, `mcp`), not the contract every plugin follows.

### OAuth

OAuth 2.1 is an optional core plugin (`oauth`), opt-in like every non-required plugin, with no dependencies. HAXcms becomes the authorization server (ADR-0004 in haxcms-mcp, https://github.com/haxtheweb/haxcms-mcp/blob/main/docs/adr/0004-haxcms-is-the-oauth-authorization-server.md): authorization code with PKCE (S256 only), short access tokens, rotating refresh tokens (reuse revokes the approval), audience binding with the `resource` parameter (RFC 8707), revocation (RFC 7009), dynamic client registration (RFC 7591, off by default), and personal tokens for headless clients. Tokens and codes are stored as hashes only; clients are public.

- **Resources.** The plugin knows nothing about any one resource. It defines the provider contract `oauth.resource`: an implementer `describe`s its audience URL and the scopes it accepts (what the consent screen shows; write scopes flagged), and `check`s each call made with one of its tokens. The oauth plugin finds resources through `ctx.plugins.list()` (`implements`) and calls only the one a grant belongs to. A resource plugin `depends` on `oauth`.
- **Per request.** For a request carrying one of its tokens, the plugin's `rest.before.request` hook (priority 100) verifies the token, asks the resource's `check`, and passes the verified grant on in the `x-hax-oauth-grant` request header, which it always strips from incoming requests first. A bad token is refused with 401, a call the resource refuses with 403.
- **People stay in control.** Consent shows the app, the resource and the scopes; each person lists and revokes their own approvals, and revoking one stops every token from it.
- **Not "auth" in the sense of spec/03.** It delegates what an already signed-in person can do; it does not sign anyone in, so the highest-order-context rule for auth providers does not apply to it. HAXiam blocks `mcp` (and can block `oauth`) through deployment config.

### MCP

MCP support is an optional core plugin (`mcp`): installed at system level, opt-in, never required, and blockable by deployment config (HAXiam blocks it for now). It builds on https://github.com/haxtheweb/haxcms-mcp, a separate Python MCP server that is an HTTP client of a running HAXcms and targets the current default branch of each backend. It **requires `oauth`**: MCP issues no tokens of its own.

- **The instance switch.** The plugin replaces core's `config.mcp`: the plugin being enabled is `mcp.enabled`, and its `readOnly` setting (default `true`, moved from `config:mcp.readOnly` by `legacy.settings`) is `mcp.readOnly`. Stock HAXcms already ships with MCP off. Core keeps publishing `data.mcp: { enabled, readOnly }` on the open `GET /system/api/v1` route, computed from the plugin's state (`{ enabled: false, readOnly: true }` while it is off, blocked or absent); haxcms-mcp obeys that field, so this shape is a base contract.
- **An OAuth resource.** Its required `serverUrl` setting (the haxcms-mcp public URL) is the audience OAuth tokens are issued for. It offers `mcp:read`, and `mcp:write` only while `readOnly` is off. Its `check` allows reads with `mcp:read`; writes only with `mcp:write` while `readOnly` is off (the instance switch wins over any token); plugin operations only when marked `x-hax-mcp`; and keeps a token approved for one site on that site. Headless clients (stdio) use an OAuth personal token for that URL.
- **Separation.** haxcms-mcp stays a stand-alone server and serves its own protected-resource metadata, naming this HAXcms as the authorization server. The plugin provides the switch, the resource and discovery; it does not serve MCP itself.
- **Core tools.** The existing hand-written core tools stay in haxcms-mcp for now; marking core's own operations `x-hax-mcp: true` so core and plugin tools come from one place is a later migration.
- **Tools.** Only plugin operations with `x-hax-mcp: true` are offered. `mcpDiscovery` lists, for the calling token, the opted-in operations within its read-only state and the prompts from `register.before.prompts`, so the MCP server can add plugin tools without a release.
- **Logging.** Every MCP call is written to the unified log with the grant id.

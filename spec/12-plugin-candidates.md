# Plugin candidates and priority

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

**Drafted so far** to test the spec against real extractions and community-style plugins (topology tests; any may be removed after review). Core (`core-plugins/`, Node and PHP unless declarative): announcements, cookie-consent, google-analytics, regions, author-profile, pwa, youtube, vimeo, giphy, unsplash, flickr (declarative proxies), open-media-apps and game-pack (packs), git, agent-skills, outline, files, log, mcp, importer-html, importer-wordpress, feeds, sitemap, search, page-cache. Community (`contrib-plugins/`): neon-theme-pack, workshop-skeleton-pack, music-blocks, comments, plausible-analytics, rsync-deploy, a11y-check. 32 of a target 50. What each batch forced the spec to add is in GAPS.md (items 1k to 1o).

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
| `mcp` | discovery, scoped tokens and policy for https://github.com/haxtheweb/haxcms-mcp; HAXiam blocks it for now | extract (`mcp.enabled`, `mcp.readOnly`) | `register.before.routes`, `register.after.prompts`, `rest.before.request`, `plugin.before.enable` |
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

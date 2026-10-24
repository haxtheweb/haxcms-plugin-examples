# Plugin candidates and priority

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

A working list for scoping the refactor, built from the hook examples in spec/06. Nothing here is committed: it shows which extension points real plugins would lean on, which current core features could move out, and in what order. Announcements (https://github.com/haxtheweb/issues/issues/3172) is always the first vehicle.

**Where it comes from:** "extract" means the behavior exists in HAXcms core today and would move into a plugin (its settings migrate through `plugin.after.install`); "new" means it does not exist yet.

**Tiers:** core required (always on, cannot be disabled), core optional (ships with HAXcms, enabled per system or site), first-party contrib (published by the project, installed when wanted), HAXiam (deployment-specific), fixture (examples and tests only).

## Core required

| Plugin | What it does | From | Key hooks and registries |
|---|---|---|---|
| `announcements` | What's New and HAX Tips for users and site owners | new | system store, `user.after.login`, `site.after.create`, `render.after.body`, `plugin.after.upgrade`, Merlin `api` program, routes |
| `agent-skills` | publishes `site` and `system` skills from enabled plugins into `.well-known/agent-skills` | extract (`rebuildAgentSkills`) | `rebuild.after`, `plugin.after.enable` / `.disable` |
| default theme pack | the default theme (today `clean-two`) and its siblings as a `pack` | extract | theme registry only |

## Core optional

| Plugin | What it does | From | Key hooks and registries |
|---|---|---|---|
| `log` | the unified log, health chip data, log page | new | every failure path writes to it; `schedule.after.run`, `user.after.login` |
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

## Fixtures

`example` (every hook), `minimal-pack`, `data-store`, a provider-contract pair, a restricted-assets pack (spec/10).

## Priority

1. **Vehicle:** `announcements`, with the fixtures and `log` alongside so health, requirements and tests are exercised from the start.
2. **Prove settings migration and output injection on small extractions:** `cookie-consent` + `google-analytics`, `author-profile`, `regions`, one appstore provider.
3. **Platform features that test the hard hooks:** `page-cache`, `ssr`, `search`, `views`, `comments`, `agent-skills`, `mcp`, `scheduler-timer`.
4. **Bulk extractions and contrib:** importers, exporters, remaining appstore providers, `pwa`, `seo-plus`, deploy targets, contrib ideas.

Every hook in spec/06 has at least one candidate here; a hook no candidate needs would be a reason to drop it.

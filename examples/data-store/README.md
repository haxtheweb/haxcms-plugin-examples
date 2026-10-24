# data-store

Shows where plugin data lives and how it changes over time:

| Store | Scope | Where | Why |
|---|---|---|---|
| `votes` | site | `<site>/_config/data/data-store/votes.json` | travels with the site (export, git) |
| `notes` | siteData, `personalData` | `<HAXCMS_ROOT>/_config/siteData/<siteUuid>/data-store/notes.json` | per-user, never in the site folder; core exports and erases by `userId` |
| `feed-cache` | system | `<HAXCMS_ROOT>/_config/systemData/data-store/feed-cache.json` | one store for the deployment |
| `badge` | manifest | `site.json` at `metadata.plugins.data-store.badge` | small data that belongs inside the site file |

The upgrade step for 0.2.0 moves votes out of `site.json` (where 0.1.0 kept them) into the `votes` store through `ctx.entities`, and the list route keeps a read fallback so a site whose upgrade has not run still shows its votes. Recipe: `migrations/0002-move-votes.md`; code: `upgrades["0.2.0"]` in Node, `upgrade_0_2_0` in PHP.

Tests: `node harness/run-cases.mjs examples/data-store` (Node, PHP and parity).

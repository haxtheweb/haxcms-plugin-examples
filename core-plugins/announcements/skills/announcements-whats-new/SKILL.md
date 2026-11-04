---
name: announcements-whats-new
description: "Find out what is new in this HAXcms deployment and get HAX tips: What's New entries for the running version and a tip of the day. Use when a user asks what changed, what's new, or for a tip. Published on the system front end by the announcements plugin."
version: 0.1.0
license: Apache-2.0
metadata:
  author: haxtheweb
  plugin: announcements
  audience: system
  tags: [hax, haxcms, announcements, whats-new, tips]
---

# What's new in this HAXcms

The announcements plugin serves curated release highlights (kind `update`) and evergreen tips (kind `tip`).

## Ask

- **CLI:** `hax whats-new --json`, `hax tips --json`, `hax tip --json` (aliases of `hax announcements whats-new`, `tips`, `tip`). Contributed by the plugin (they exist once the CLI loads plugin commands); they read the installed version in-process with no credentials.
- **API:** `GET /system/api/v1/plugins/announcements/latest`, `/all`, `/tips`, `/tips/daily`, `/types`. Every route needs **both** the JWT (`Authorization: Bearer ...`) and the `X-HAXCMS-User-Token` header, because responses include the running version. Without both you get 401 and nothing else; do not try to infer the version another way.
- **MCP:** when the MCP plugin is enabled, `announcementsListLatest`, `announcementsListAll` and `announcementsGetDailyTip` are offered as tools.

## Read the response

- `latestVersion`: the newest version that has curated entries. Releases without entries do not change it.
- `items[]`: `uuid`, `slug`, `kind`, `type` (a type uuid), `version` (updates), `label`, `description`, optional `visual`, `links`.
- `types`: map of type uuid to `{ key, label, icon, color }`. Group by `types[item.type].label`.
- Pass `lang` for translated text; English is the fallback.

## Present it

Lead with the latest version's items grouped by type, one line each, then earlier versions only if asked. For a tip, give the label and description; do not repeat the same tip twice in a day (it is the same for everyone on a UTC date).

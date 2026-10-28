---
name: hax-plugin-port
description: "Turn existing functionality into a HAXcms plugin: extract a feature from HAXcms core into a core plugin, or port a WordPress or Drupal plugin's behavior to HAX. Use when asked to extract, port, migrate or rebuild something as a HAX plugin, or to map WordPress actions/filters or Drupal hooks to HAX hooks."
version: 0.1.0
license: Apache-2.0
metadata:
  author: haxtheweb
  tags: [hax, haxcms, plugin, port, extraction, wordpress, drupal]
---

# Porting to a HAXcms plugin

Spec: https://github.com/haxtheweb/haxcms-plugin-examples. Candidates and their priority: `spec/12-plugin-candidates.md`.

## Extracting a core feature

1. Find every place the feature lives in both backends (https://github.com/haxtheweb/haxcms-nodejs and https://github.com/haxtheweb/haxcms-php), in the front end (https://github.com/haxtheweb/webcomponents) and in settings (`coreConfig`). Test against the latest main, not a published version.
2. Map each part: settings → the plugin's settings panel, migrated from `site.json` in `plugin.after.install`; routes → its contract with `legacy` aliases for the old paths; behavior inside saves → hooks; front-end pieces → registries.
3. Decide the tier: required core (always on), core (opt-in) or contrib. Required core plugins still declare their dependencies.
4. Build it Node first, where the CLI can validate and test; then PHP with the same cases and a parity run.
5. Keep existing sites working: old settings migrate, old routes alias, existing content still renders.

## Porting from WordPress or Drupal

Port the behavior, not the code. Common mappings:

| WordPress | Drupal | HAX |
|---|---|---|
| `save_post` / `wp_insert_post_data` | `hook_entity_presave` / `hook_node_presave` | `page.before.save` (alias of entity before create/update on page) |
| `save_post` (after) | `hook_entity_insert` / `_update` | `page.after.save`, `entity.after.create` / `.update` |
| `before_delete_post` / `deleted_post` | `hook_entity_predelete` / `_delete` | `entity.before.delete` / `entity.after.delete` |
| `wp_head`, `wp_enqueue_scripts` | `hook_page_attachments` | `render.before.head` |
| `wp_footer` | `hook_page_bottom` | `render.after.body` |
| `the_content` filter | text format filters | `render.before.content` |
| `rest_api_init` | routing.yml + controllers | `config/openapi.yaml` + operations |
| `register_activation_hook` | `hook_install` | `plugin.after.install` |
| `upgrader_process_complete` | `hook_update_N` | upgrade steps + `plugin.after.upgrade` |
| options API, Settings API | config entities (CMI) | `config/settings.schema.json`, `config.*` hooks |
| WP-Cron | `hook_cron` | `schedules` + `schedule.*` hooks |
| `wp_login` | `hook_user_login` | `user.after.login` |
| shortcodes, blocks | blocks, field formatters | `registries/elements` (role `block`) |

Things that do not port directly: anything assuming a database query layer (use stores and entities), global state, and output buffering tricks. HAX sites must still work as static files, so server-only behavior marks the plugin `staticCapable: false`.

## Finish

Run `hax-plugin-audit`, then open a PR per repository, cross-linked, never merged by you.

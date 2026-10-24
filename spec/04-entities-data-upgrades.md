# Entities, data stores and upgrades

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Entities, data and upgrades

### 4.1 Entities
- A plugin entity has a `uuid` primary key like every entity.
- **Extension** creates a new entity: `extends: <existing entity>`. It inherits the parent's fields and may add fields, operations, validators and its own storage. The loader enforces that it never breaks the parent: no removed or retyped fields, the same primary key, no dropped operations, auth at least as strict. A violating extension is rejected and the plugin is disabled with the reason shown.
- **Annotation** enriches an entity in transit: namespaced fields (for example `ext.awesome.fireworks`) added on the way out, never stored, ignored if sent back on a write. Persisting anything requires an extending entity with its own storage.
- Plugin entities are listed in `GET /system/api/v1/entities` (with `extends` and the providing plugin) only to callers holding both credentials.
- Entity hooks subscribed to a parent entity also fire for entities that extend it, with the concrete type in context, parent before child.

### 4.2 Data stores
A store is declared in `config/datastores.yaml` and reuses the existing `datastore` storage type with a location template. The loader accepts only locations inside the plugin's own folder under these roots. Plugins never build paths; they call a storage helper (`storage.site(...)`, `storage.siteData(...)`, `storage.system(...)`).

| Scope | Location | Travels with the site | Examples |
|---|---|---|---|
| `site` | `<site>/_config/data/<plugin>/<store>.json` | yes | popular content by votes |
| `siteData` | `<HAXCMS_ROOT>/_config/siteData/<siteUuid>/<plugin>/<store>.json` | no; export can include it on request | comments, per-user records for that site |
| `system` | `<HAXCMS_ROOT>/_config/systemData/<plugin>/<store>.json` | no | an RSS feed aggregated from 10 sites |
| `manifest` | namespaced slot in `site.json` or the page (`metadata.plugins.<id>`) | yes | custom fields, OER metadata, plugin settings that belong to the site |
| `package` | `<plugin>/data/<store>.json` (read-only; YAML also accepted) | no; part of the plugin itself | registries and curated content shipped with the plugin (announcements), seed data |

Code reads stores through `ctx.storage.read(storeId)` (and writes with `ctx.storage.write` for every scope except `package`, which changes only when a new plugin version is installed). Other files under the plugin's `data/` folder, such as screenshots or locale overlays for package content, are read with `ctx.package.read(path)`, which refuses paths outside `data/`.

Notes: `siteData` is keyed by the site UUID, not the name (the site UUID is the root `id` of `site.json`, a UUID v4 that HAXcms already generates), so a rename cannot orphan data. User data lives inside `siteData` or `system` records and never in the site folder. A store marked `personalData: true` supports export and erase by user id, which serves retention policy. Clone creates a new site UUID and copies no `siteData`. Archive keeps data under the old UUID, marked archived. Delete cascades. A site `_config` folder is private (deny rule), excluded from static publish templates, and handled by clone and export.

### 4.3 Upgrades
Each plugin records its installed version per scope (`_config/plugins/plugins.yaml`). On a version change the loader runs the `migrations/` steps in order, before/after hooks fire, and a failure disables the plugin with its reason. Steps may change data models and file system layout. Example: a future views plugin moving definitions out of `site.json` into its store, with a read fallback so older sites keep working (tested by https://github.com/haxtheweb/issues/issues/3175).

# 0002: move votes

From 0.1.0 (votes in `site.json` at `metadata.plugins.data-store.votes`) to 0.2.0 (the `votes` site store).

Recipe: read the old key, write it to the `votes` store, remove the old key. The plugin keeps a read fallback to the old location so sites that have not run the upgrade still work (compare https://github.com/haxtheweb/issues/issues/3175).

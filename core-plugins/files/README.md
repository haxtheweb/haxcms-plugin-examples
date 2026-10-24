# files

Site files and uploads, extracted from core. Required.

**Today in core:** `/x/api/v1/files` routes (`listFiles`, `createFile`, `getFileByUuid`, `updateFileByUuid`, `deleteFileByUuid` in `files.js`) with upload checks (`uploadSecurity.js`), and the "Local files" appstore app built by `generateAppStore`.

**As a plugin:** list, upload and delete routes (old paths kept through `legacy.routes`); uploads limited to today's file types and a size setting, names made safe; bytes go to the site's `files/` folder through `ctx.files.put`, the record through `ctx.entities.save("file")`, so `file.before.save` / `file.after.save` and the delete aliases fire for other plugins (a media library can refuse deleting an embedded file); the Local files app is this plugin's appstore fragment.

Tests: `node harness/run-cases.mjs core-plugins/files`.

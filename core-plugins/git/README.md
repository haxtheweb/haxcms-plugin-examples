# git (version control)

Version control, extracted from core. Required.

**Today in core:** routes call `site.gitCommit(message)` after page, outline, file, settings and theme saves (`saveNode`, `createNode`, `saveManifest`, `saveSeoSettings`, `files.js`, `site.js`, ...), with an optional push to a branch (`metadata.site.git.autoPush` and `branch`), plus revision routes.

**As a plugin:** it subscribes to the page, site and file save and delete hooks; in a bulk transaction it marks the change and makes one commit in `transaction.before.end`; it defines `git.before.commit` (others may adjust the message or veto) and `git.after.commit` (for example an rsync plugin); commit messages are sanitized; it runs only `git` (`exec`); `GET .../plugins/git/history` lists recent commits. Keeping every version-control concern here is what would let something else provide history behind the same hooks.

**Core changes when extracted (not made here):** remove every `site.gitCommit` call from the routes (the hooks replace them), `GitPlus` and the git settings handling; the revision routes move here with `legacy.routes`.

Tests: `node harness/run-cases.mjs core-plugins/git` (uses real git in a temporary folder).

# Comments (community)

Signed-in readers comment on pages; editors moderate. Comments are personal data kept per site on the server (`siteData` store with `personalData: true, userKey: authorId`), so core exports and erases them with no plugin code.

- Read: `commentsList` uses optional auth. Signed-out visitors get approved comments only when **Visitors can read comments** is on.
- Write: `commentsCreate` (the page must exist), `commentsModerate` (admin, editor), `commentsDelete` (author or moderator)
- `page.after.delete` deletes the page's thread.
- `render.after.content` adds approved comments to published pages (escaped). Static copies show them as of publish time (`staticFallback`).
- `user.before.erase` notes which pages show the user's approved comments (a transaction mark); `user.after.erase` lists them in `commentsRepublish` so the published copies can be refreshed.

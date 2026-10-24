# AGENTS.md (comments)

## Purpose
Moderated page comments with personal-data handling and a static snapshot.

## Rules
- Escape everything a commenter wrote, in the API's consumers and in the snapshot.
- Never put pending or rejected comments in published pages.
- Erase: core removes store rows; the plugin only tracks published copies that need a republish.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/comments`.

## Diagnose
- Visitors get 401: anonymousRead is off for the site.
- Deleted user still named on a static site: republish the pages from commentsRepublish.

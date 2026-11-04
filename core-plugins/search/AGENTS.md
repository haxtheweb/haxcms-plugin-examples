# AGENTS.md (search)

## Purpose
Search index for the in-browser site search.

## Rules
- Only listed pages; never index unpublished text.
- Keep the field names the site-search element reads.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/search`.

## Diagnose
- Search finds nothing new: the site has not been rebuilt since the change.

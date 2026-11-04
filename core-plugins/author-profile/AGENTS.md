# AGENTS.md (author-profile)

## Rules
- Settings are the source; write the published profile only in `config.after.save`.
- Only http(s) links; never bake anything unvalidated into output.
- Re-read `site` before saving it after `ctx.config.save`.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/author-profile`.

## Diagnose
- A theme shows no contact details: the theme still reads `metadata.author.*`; it needs the published profile path.

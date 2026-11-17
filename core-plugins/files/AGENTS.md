# AGENTS.md (files)

## Purpose
Uploads and site files. Required. Defines the file.* aliases others use.

## Rules
- Only allowed extensions; names reduced to safe characters.
- Bytes through ctx.files.put, records through ctx.entities, never the reverse order on delete (record first, then bytes).

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/files`.

## Diagnose
- 400 "not allowed": the extension is not in the allowed list.
- 409 on delete: another plugin refused (for example, the file is still embedded).

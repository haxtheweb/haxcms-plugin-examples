# AGENTS.md (media-library)

## Purpose
Image metadata as an extension of the file entity.

## Rules
- Act only when ctx.entityType is file.
- Never remove a file field (extensions may only add).

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/media-library`.

## Diagnose
- Uploads get no record: the files plugin is not active, or the file is not an image by extension.

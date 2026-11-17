# AGENTS.md (importer-cartridge)

## Purpose
IMS Common Cartridge (.imscc) to JSON Outline Schema items via import.platform.

## Rules
- Return { title, items, files?, site?, stats } or { error }; never throw.
- Read the cartridge only through ctx.archive.read; no zip or XML library, so Node and PHP parse it the same way.
- Canvas-only files (course_settings/, assignment_settings.xml, topicMeta) are optional: a generic cartridge must import without them.
- Fixtures are synthetic. A real course export holds names, email addresses and meeting links; never commit one.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/importer-cartridge`.

## Diagnose
- No module pages: the cartridge's organization is empty (a Canvas course that never used Modules); content is grouped by kind instead.
- A quiz page says its questions were not converted: QTI mapping to question elements is not built yet.
- A link to a course file is broken: the file's extension is not in the media list at the top of the source.

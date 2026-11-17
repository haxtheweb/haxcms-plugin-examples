# AGENTS.md (agent-skills)

## Rules
- Only .md, .json and .txt files are published; developer skills never.
- index.json must be byte-identical between Node and PHP (two-space JSON); the parity run checks it.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/agent-skills`.

## Diagnose
- A plugin's skill is missing: the plugin is inactive, or its skill's audience is not `site`.

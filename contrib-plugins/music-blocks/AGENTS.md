# AGENTS.md (music-blocks)

## Purpose
Front-end-only element pack for music notation blocks.

## Rules
- Every block ships haxProperties with a demoSchema.
- Tags start with music- (tagPrefix).
- Use DDD tokens for spacing, borders and color.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/music-blocks`; element tests with `npx web-test-runner "test/**/*.test.js" --node-resolve`.

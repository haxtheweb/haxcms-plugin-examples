# AGENTS.md (regions)

## Purpose
Pages shown in theme regions. Core optional.

## Rules
- Settings are the source; the manifest store `map` is the published copy. Write the copy only in `config.after.save`.
- Re-read `site` after anything that may have changed it before saving it; a stale save is refused.
- Keep `legacy.tags` (`site-region`) until no theme uses the old tag.
- Node and PHP behave the same (parity run).

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs core-plugins/regions`.

## Diagnose
- Region empty on a published site: `metadata.plugins.regions.map` missing; save the plugin's settings once to publish it.
- Save refused "is not a page of this site": a region points at a deleted page.

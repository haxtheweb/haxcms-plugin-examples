# AGENTS.md (quick-poll)

## Purpose
The `quick-poll` block plus the server side it needs: votes counted on the server, one vote per person, results shown to learners only when the poll allows, and editors able to read and clear results. Experimental (`lifecycle: experimental`); the block shows as Beta in the editor.

## Layout
- `frontend/dist/quick-poll.js`: the block (Lit, DDD block frame, `@haxtheweb/*` imports resolved by the site's import map). Moved here from the webcomponents monorepo. `quick-poll.haxProperties.json` is its HAX settings; `locales/` its English strings.
- `src/nodejs/index.js`, `src/php/Plugin.php`: the same logic twice. Change both together; the cases compare them.
- `config/`: routes, settings form and defaults, the `ballots` and `meta` stores.
- `registries/elements/`: the block. `registries/dashboard/`: the Insights section (`quickPollList`) and the Insights button that clears the shown page's polls (`quickPollClear`).
- `tests/cases/`: executable cases (Node, PHP, parity). `test/`: element tests, including "server agreement", which pins the keys and option ids the server computes.

## Rules
- The browser is never trusted about a poll. Options, question, `show-results`, `closes` and `allow-change` are read from the page's saved content (`pollsIn`). A poll is found by the key in its activity id; an option must be one of that poll's own.
- Keys and option ids must match the element (`@haxtheweb/user-action/lib/xapi.js`): `activityKey` (author id, else `quick-poll-` + FNV-1a of `quick-poll\u0001quick-poll\u0001<question>`, plus `-1`, `-2` for repeats; a `resource` attribute is not used by this element) and `componentIds` (NFC, white space collapsed, FNV-1a, `-2` for duplicates). If the element's id scheme changes, change both runtimes and the "server agreement" test in the same change.
- Identity comes from `ctx.user` only. A visitor is `v:` + the first 32 hex of sha256(pageId, poll key, browser key); the browser key is never stored or returned. Never read an IP address or user agent.
- Results: editors always; `never` editors only; `closed` once `closes` has passed (a time with no zone counts as passed 12 hours after it passed in UTC, when it has passed everywhere); otherwise everyone. A caller who may not see counts gets `{ counts: {}, hidden: true }`.
- The block must keep working with no server: no endpoint means no request.
- Front-end code: no optional chaining or nullish coalescing, `globalThis` not `window`, colors only from `--ddd-*` tokens, explicit `.js` paths for `@haxtheweb` imports.
- Use `ctx.now()`, never the runtime clock. Regular expressions stay linear. Output must match between runtimes: integer percentages, the same key order, the same messages.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/quick-poll` (Node, PHP and parity); element tests with `npx web-test-runner "test/**/*.test.js" --node-resolve` from a checkout where `@haxtheweb/*`, `lit` and `@open-wc/testing` resolve (the webcomponents monorepo); `node scripts/plugin-docs.mjs contrib-plugins/quick-poll` after changing a docblock.

## Diagnose
- The poll shows no results and nothing is counted: it has no endpoint (static publish, the plugin is off, or the page was not rendered through the plugin).
- 404 "That poll is not on this page": the page was edited after it loaded (question reworded, poll removed), so its key changed; reloading fixes it. Votes under the old key stay listed in Insights as "(no longer on its page)" until cleared.
- 409 "Your vote is already in": the poll does not have `allow-change` and this person or browser already voted for another option.
- 403 "Sign in to vote": the site turned off voting without signing in.
- 429: the hourly cap (`maxPerHour`) or the platform's rate limit.
- A visitor can vote again after clearing their browser storage: visitor votes are one per browser, not per person. Turn off visitor voting where that matters.

## Upgrade notes
None yet. Stored rows are `{ pageId, poll, voter, choice, ts }` plus `userId` for signed-in voters; a change to that shape, or to the key scheme, needs an upgrade step in both runtimes.

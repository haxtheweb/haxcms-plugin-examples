# AGENTS.md (page-feedback)

## Purpose
"Was this page helpful?" at the end of a page: a rating, optional reasons and an optional comment go to the site team (Insights, a webhook, other plugins). Anonymous by default.

## Layout
- `frontend/dist/page-feedback.js`: the block. Plain custom element, no dependencies, shadow DOM, DDD tokens with fallbacks, `light-dark()`. Reads site settings from `data-config`; its own attributes win.
- `src/nodejs/index.js`, `src/php/Plugin.php`: the same logic twice. Change both together; the cases compare them.
- `config/`: routes, settings form and defaults, the `feedback` and `meta` stores, the page opt-out field, the two hooks the plugin defines.
- `registries/elements/`: the block. `registries/dashboard/`: the Insights section, rendered by core from `pageFeedbackList` and `pageFeedbackSummary`.
- `tests/cases/`: executable cases (Node, PHP, parity). `test/`: element tests.

## Rules
- Identity comes from `ctx.user` only, and is stored only when `anonymous` is off. Never read identity, an IP address or a user agent from the request, and never add them to the webhook or the hook subjects.
- `pageFeedbackSubmit` is public: validate every field on the server, keep the origin check and the hourly cap, and keep the response free of stored data.
- A comment is plain text. It is stored as typed (minus control characters), so everything that shows it must escape it. The block builds its DOM with `textContent` only.
- The webhook secret travels in its header to `webhookUrl` and nowhere else: keep the single egress entry, `x-secret-egress`, and the save-time checks together.
- `user-engagement` carries `xapi: false` and never the comment. Feedback is not a learner record.
- The block must keep working with no server: no endpoint means no request, the events and the thank-you.
- Keep the block's front-end API stable once content uses it: `question`, `yes-label`, `no-label`, `reasons`, `no-comments`, `comment-max-length`, `endpoint`, `page-id`, `named`, `repeat`, `data-config`.
- Front-end code: no optional chaining or nullish coalescing, `globalThis` not `window`, no native dialogs, colors only from `--ddd-*` tokens. Use `--ddd-border-size-*` for widths: `--ddd-border-xs` and its siblings already contain a color.
- Use `ctx.now()`, never the runtime clock. Keep regular expressions linear; trimming is done without one.
- Output must match between runtimes: whole-number percentages by integer arithmetic, the same key order, the same messages.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/page-feedback` (Node, PHP and parity); element tests with `npx web-test-runner "test/**/*.test.js" --node-resolve`; `node scripts/plugin-docs.mjs contrib-plugins/page-feedback` after changing a docblock.

## Diagnose
- The block thanks readers but nothing arrives: it has no endpoint (static publish, or the page was not rendered through the plugin), or Insights and the webhook are both off.
- Readers see "cannot take feedback right now": the page id in `data-config` is not a page of this site.
- 403 on submit: the browser's `Origin` host differs from the site's public address (`ctx.site.url`); check the site's domain setting.
- 429 on submit: the hourly cap (`maxPerHour`) or the platform's rate limit.
- Log "the feedback webhook could not be reached" or "answered <status>": the receiver is down, redirects to another host, or refused the message. Feedback kept in Insights is not lost.
- Old feedback is still there: `retentionDays` is 0, or the schedule runner is not running (new responses also prune).

## Upgrade notes
None yet. Stored rows are `{ id, pageId, pageTitle, helpful, reasons, comment, at, ts, handled }` plus `userId` and `userName` only in named mode; a change to that shape needs an upgrade step in both runtimes.

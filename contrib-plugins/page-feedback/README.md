# Page feedback (community)

A "Was this page helpful?" prompt at the end of a page. Readers answer Yes or No, may pick reasons after No, may add a comment, and send it to the people who maintain the site. Everything is optional, and by default nothing about the sender is kept.

## What readers get

The `page-feedback` block (`frontend/dist/page-feedback.js`, a plain custom element with no dependencies):

- two real buttons with text and an icon; No reveals the site's reasons as toggle buttons; either answer reveals an optional comment box and **Send to the site team**; then a thank-you that says no name is attached (when the site is anonymous)
- state changes are announced in a live region; errors are explained and the form stays usable
- one answer per page per browser session (remembered in `sessionStorage`, which is not a cookie and never leaves the browser); the `repeat` attribute lifts that
- with no server (a static publish, or the plugin turned off) it sends nothing, still thanks the reader, and still fires its events so the host page can handle the answer

Events, both bubbling and composed, fired once the answer is accepted:

| Event | Detail |
|---|---|
| `page-feedback-submit` | `{ pageId, url, helpful, reasons: [ids], comment }` |
| `user-engagement` | `{ activityDisplay: "interacted", xapi: false, objectName: "Page feedback", objectId: "page-feedback", objectDetail: "helpful" \| "not helpful" }` |

Feedback to the team is not a learner record: `xapi` is false, no statement is built, and the comment text is never in `user-engagement`.

## Where the prompt shows

- **A block authors place**: Page feedback is in the editor's block list. Its own `question`, `yes-label` and `no-label` win over the site's.
- **Every page**: turn on **Show at the end of every page**. A page opts out with **Hide the feedback prompt on this page** in its settings (`metadata.plugins.page-feedback.hide`). A page that already has a placed block does not get a second one.

`render.after.content` hands each block the site's settings and the address to post to in a `data-config` attribute. Static publishes get no address.

## Where feedback goes

Each destination is its own setting:

1. **Insights** (on by default): kept in the plugin's `feedback` store (`siteData`: with the site's data on the server, never in the site folder) and shown to editors as a **Feedback** section in the site's Insights screen: latest comments, then a row per page with the share of helpful answers, the number of responses and the top reason.
2. **Webhook**: a JSON summary is POSTed to one https address an admin enters, with an optional secret in a header of your choosing. The address is the plugin's only egress entry and the secret is bound to it (`x-secret-egress`), so a redirect cannot carry it elsewhere. A webhook that is down is logged and loses no stored feedback.
3. **Other plugins**: `page-feedback.after.submit` carries the same summary plus the roles in **Who is notified**, for a plugin that can reach people (mail, chat). This plugin sends no email itself: the platform has no mail transport yet.

**Which responses are sent on** (every response, only No answers, only ones with a comment) applies to the webhook and that hook. Insights always keeps every response.

Webhook body: `{ event: "page-feedback.submitted", site: { id, name, url }, page: { id, title, url }, helpful, reasons: [{ id, label }], comment, hasComment, at }`. `comment` is `null` when **Include the comment text in the webhook** is off. It never says who sent the feedback.

## Routes

| Operation | Route | Who |
|---|---|---|
| `pageFeedbackSubmit` | `POST feedback` | anyone (public, rate limited) |
| `pageFeedbackList` | `GET feedback` with `filter[pageId\|helpful\|handled\|hasComment\|from\|to]`, `page[limit\|offset]` | site editors |
| `pageFeedbackSummary` | `GET summary` | site editors |
| `pageFeedbackHandle` | `PUT feedback/{id}` `{ handled }` | site editors |
| `pageFeedbackDelete` | `DELETE feedback/{id}` | site editors |

The public route checks everything on the server: the rating is true or false, the page exists, reasons are ids from the site's list (and only count for No), the comment is plain text within the site's limit. It refuses a post whose `Origin` is another site, and refuses more than **Most responses per hour** for the whole site (a count, with nothing recorded about who sent what) on top of the platform's rate limit. `page-feedback.before.submit` lets another plugin refuse a response or change its comment.

## Privacy

- Collected: a rating, reason ids, an optional comment, the page and the time. Never an IP address, a user agent or a cookie.
- **Keep feedback anonymous** (default on): nothing about the sender is stored, signed in or not. Off: feedback from a signed-in person is stored with the id and name the platform knows them by, never one sent by the browser; core then exports and erases those rows by user (`personalData` store). Visitors stay anonymous either way.
- A comment is whatever the reader typed, so it can hold personal details; the block asks readers to leave them out.
- Sent out only to the webhook address, when one is set.
- **Delete feedback after (days)**: a daily job, and every new response, delete older feedback. 0 keeps it until an editor deletes it. Deleting a page deletes its feedback.

## Settings

Question, Yes and No labels, reasons (id and label), comment box on or off and its longest length, anonymous, show on every page, Insights, webhook (on, address, secret, secret header, include comment), which responses are sent on, who is notified, retention days, most responses per hour. Saving refuses a webhook address that is not https, has no host, carries a sign-in or is private; a secret with no address; malformed or repeated reason ids; and numbers out of range.

<!-- implements:start (generated by scripts/plugin-docs.mjs from plugin.yaml and the docblocks in the code; do not edit by hand) -->
## What it implements

| Kind | Name | Runs when | What this plugin does |
|---|---|---|---|
| hook | `config.before.save` | configuration is about to be written (dashboard, `hax plugin config set`, install migration) | Refuses settings that would break the prompt or send feedback somewhere unsafe: empty labels, malformed or repeated reason ids, out-of-range numbers, and a webhook address that is not https, has no host, carries a sign-in or points at a private address. |
| hook | `render.after.content` | the content is placed | Hands the site's question, labels, reasons and the address to post to every placed page-feedback block, and adds the block at the end of the page when the site shows it everywhere and the page did not opt out. |
| hook | `page.after.delete` | the page was deleted | Removes the feedback of a deleted page so nothing is left pointing at a page that no longer exists. |
| operation | `pageFeedbackSubmit` | `POST /x/api/v1/plugins/<id>/feedback` (public) | Takes one visitor's answer for a page: checks the rating, the reasons against the site's list and the comment as plain text, refuses cross-site posts and floods, then stores it for editors and passes a summary to the webhook and to page-feedback.after.submit. |
| operation | `pageFeedbackList` | `GET /x/api/v1/plugins/<id>/feedback` (bearerAuth) | Lists feedback for site editors, newest first, filtered by page, rating, handled state, whether a comment was left and a range of days, one page at a time. |
| operation | `pageFeedbackHandle` | `PUT /x/api/v1/plugins/<id>/feedback/{id}` (bearerAuth) | Marks one response handled (or not handled again) so the team can tell what still needs attention. |
| operation | `pageFeedbackDelete` | `DELETE /x/api/v1/plugins/<id>/feedback/{id}` (bearerAuth) | Deletes one response for good. |
| operation | `pageFeedbackSummary` | `GET /x/api/v1/plugins/<id>/summary` (bearerAuth) | Adds feedback up per page for site editors: the share of helpful answers, the number of responses and the most picked reason, with the pages that helped least first. |
| schedule | `prune` | `17 3 * * *` | Deletes feedback older than the retentionDays setting; does nothing while it is 0. |
| element | `page-feedback` | block |  |
| dashboard | `page-feedback-insights` |  | Feedback |

Each code row matches a docblock (`Implements hook ...`, `Implements operation ...`) directly above the implementation in `src/nodejs` and `src/php`.
<!-- implements:end -->

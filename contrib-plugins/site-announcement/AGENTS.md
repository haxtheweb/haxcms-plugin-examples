# AGENTS.md (site-announcement)

## Purpose
One visitor-facing line of news at the top of every page of a site, on any theme, until an end date.

## Rules
- Plain text only. The title, text and link text never carry markup; the link is http(s), mailto or a path on the site.
- Node and PHP apply the same cleaning rules and give byte-identical markup (the harness checks parity).
- The element never calls the server; everything it shows is in its attributes. Dismissal stays in the browser.
- Inject at `body.start` (render.before.body), not inside the theme: it has to work on every theme.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/site-announcement`.

## Diagnose
- No bar: title and text are both empty, the end date has passed, or this browser dismissed this exact announcement
  (localStorage key `haxcms-announcement-dismissed:<site id>`).
- Bar still shows after the end date on a published site: the element hides itself by the visitor's date; republish
  to drop the markup.
- Sticky header covers the bar: offset it by `--haxcms-site-announcement-height` (set on the root element).

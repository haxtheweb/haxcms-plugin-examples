# Content security policy (community, Node only)

Adds a `Content-Security-Policy` meta tag to every page. `script-src` allows the site itself, the sha256 hash of each inline script in the final document, and any extra hosts you list.

It subscribes to `render.after` at stage `seal`. Stages run in the contract's order (`transform`, `seal`, `store`), so minify-html (transform) changes the document first and page-cache (store) keeps the sealed result. No priority numbers are needed between plugins that do not know each other.

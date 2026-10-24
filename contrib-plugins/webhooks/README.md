# Webhooks (community, Node only)

POSTs a JSON message to each URL in **Send to** when a page is created, updated or deleted, or the site is saved. Messages are signed with `X-HAX-Signature: sha256=<HMAC>` using the secret, and sent from detached hooks.

The destinations are chosen by admins, so `egress` names a setting (`- setting: endpoints`) instead of fixed hosts. Only the hosts of those URLs are reachable. Saving refuses http and private addresses, and a deployment may forbid setting-based egress altogether.

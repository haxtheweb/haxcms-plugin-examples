# Spam guard (community, Node only)

Guards the comments plugin by subscribing to `comments.before.create`, a hook comments defines and fires. comments is a hard dependency: without it spam guard is disabled.

- More links than **Links allowed** (default 1): refused with 422 before anything is stored.
- A blocked word or phrase: the comment is held (`status: pending`) even when moderation is off.

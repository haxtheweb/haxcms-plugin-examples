# Changelog page (community, Node only)

Keeps a **Changes** page (id `changelog`) listing the 50 most recent commits, updated from `git.after.commit`. git is a hard dependency.

It is also the re-entry test. Saving the page from inside `git.after.commit` would normally make git commit again and fire `git.after.commit` again, forever. The platform never re-enters a subscriber that is already running a hook. git is still inside `page.after.save` when the Changes page is saved, so that save is not committed on its own: it goes into the next commit with everything else.

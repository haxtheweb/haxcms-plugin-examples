# rsync deploy (community, Node only)

Copies the site folder to your own server with rsync over SSH, by hand (`rsyncDeployNow`) or after every git commit (`deployOnCommit`, needs the git plugin, which is only suggested).

It runs one command, `rsync`, through `ctx.exec`: an argument list with no shell, refused unless the command is in the manifest's `exec` list. The SSH key is a secret setting (`x-secret`). `ctx.exec` writes it to a private temp file for the length of the run (`files: { id: ... }`, referenced as `{tmp}/id`), and it is never logged or returned.

- `git.after.commit` is `detached: true`, so a slow copy never holds up a save.
- Turn on **Dry run** to see what would change.

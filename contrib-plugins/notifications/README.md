# Notifications (community, Node only)

Posts to a Slack incoming webhook when a comment waits for review (`comments.after.create`) or a scheduled job fails (`schedule.after.run`). Both hooks are detached, so Slack never slows a save, and a Slack outage only writes a warning to the log.

comments is only suggested: without it, the comment hook never fires. The webhook URL is a secret setting, and only `https://hooks.slack.com/services/...` is accepted, matching `egress`.

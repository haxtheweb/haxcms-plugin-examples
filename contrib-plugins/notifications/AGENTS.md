# AGENTS.md (notifications)

## Purpose
Slack alerts for pending comments and failed jobs.

## Rules
- Only hooks.slack.com (egress).
- Never put the webhook URL in a log line or response.

## Build, test, validate
`hax plugin validate`; `node harness/run-cases.mjs contrib-plugins/notifications`.

## Diagnose
- Nothing arrives: check the log for 'Slack answered' or 'could not reach Slack'.

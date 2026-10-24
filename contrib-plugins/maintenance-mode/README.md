# Maintenance mode (community, Node only)

One switch for the whole deployment (`settingsScope: system`). While it is on:

- visitors and non-admins get a maintenance page (`render.before` answers with `ctx.respond`, marked `noindex`)
- plugin operations answer 503 for non-admins (`rest.before.request`)
- scheduled jobs are skipped when **Pause scheduled jobs** is on (`schedule.before.run`)

Admins keep seeing and doing everything.

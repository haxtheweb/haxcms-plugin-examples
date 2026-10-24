# Log (core, optional)

One unified log for every plugin. Implements the core contract `log.sink`: core hands every `ctx.log` entry (plugin id, level, message) to each enabled sink. This plugin keeps them in a system store, rotates them on the `rotate` schedule, and serves `logList` for the log page.

Without this plugin, entries still go to the server log; the health chips on the plugin dashboard come from core, not from here.

- Store: `entries` (system scope)
- Schedule: `rotate` (daily) keeps the newest `maxEntries`
- Operation: `logList` (filter by plugin and level; filtering is the plugin's job)

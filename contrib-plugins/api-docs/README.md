# API docs (community, Node only)

Serves the unified OpenAPI document of every active plugin at `GET /system/api/v1/plugins/api-docs/openapi` (signed-in users; `?scope=site|system`). Core assembles it (`ctx.plugins.contract()`), with each operation mounted under its plugin's prefix and tagged with the plugin id.

Server-side details never appear: an `x-hax-proxy` operation is listed as a normal operation, without its upstream URL or key template.

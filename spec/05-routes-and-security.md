# Routes and security

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Routes and security

- **Unified OpenAPI contract.** Each plugin's `config/openapi.yaml` is validated, and the platform builds one contract from the enabled plugins. Every path is forced under `/v1/plugins/<id>/` (`/system/api/v1/plugins/...` and `/x/api/v1/plugins/...`; plural in both). Plugins cannot place routes elsewhere or change a core path, a disabled plugin's paths 404, and plugins can build on each other (`authproviders/list` from one plugin, `githubauth/revokeAll` from a dependent). Each plugin's own spec is also served at `/v1/plugins/<id>/openapi.json` and `.yaml`.
- **Security is explicit and fail-closed.** Every operation declares `security`; policy is derived from the unified contract. Levels: authenticated with user token (system), authenticated for a site, `optional` (handler applies a setting-based filter, as views will for anonymous reads), and `public: true`. `public: true` is per operation, flagged by audit, rate limited by the system's built-in limiter, and a per-operation `rateLimit` may tighten it. Operation ids and schema names are prefixed with the plugin id; `assets/` and `openapi.*` are reserved sub-paths.
- **Version confidentiality** (https://github.com/haxtheweb/issues/issues/3174) applies unchanged: no route exposes the HAXcms version without both credentials, and unauthenticated entity listings contain only site-scope descriptors.
- **List conventions** follow the existing API: `page.limit`, `page.offset`, `sort`, `filter[...]`, `fields`.

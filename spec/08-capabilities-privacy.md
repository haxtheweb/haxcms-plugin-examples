# Capabilities, privacy and consent

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Security model, capabilities, privacy

### 9.1 Capabilities
Declared in `plugin.yaml` and shown when an admin enables a plugin, like OAuth scopes. Open vocabulary while the platform settles (manifest accepts any well-formed `area:action` string; the loader warns on an unknown one). Starting vocabulary: `items:read|write`, `files:read|write`, `site:create|read|write|delete`, `users:read`, `userData:read|write` (own stores), `network:egress` (hosts listed under `egress`), `settings:secret`, `output:inject`, `output:managedFiles`. Enforced on host API calls and entity access; audited. Plugins reach the platform through a controlled host API (create site, write files, guarded fetch, log, storage); the existing SSRF guard in PHP is the model for guarded outbound fetches.

### 9.2 Privacy and consent (worked example)
A plugin that tracks users declares `privacy.tracking: true`, its categories (`analytics`), cookies it sets, hosts that receive data, and `requiresConsent`. The `cookie-consent` plugin (optional core) defines the contract `consent.subject`. Trackers implement it. Flow:
- Enabling `google-analytics` auto-enables `cookie-consent` (after confirmation), because the first depends on the second.
- Consent UI (toast or modal element, injected via `render.body.end`) loads only when at least one enabled plugin has a declared tracking subject active for that site. With no trackers, nothing loads even if the plugin is enabled ("enabled, not in use").
- The analytics script is injected through `render.head` as a loader that waits for the client-side consent state before running.
- `google-analytics` has its own settings panel (7.1) for the tracking id. Legacy support reads or migrates today's `metadata.site.settings.gaID`.
- Honoring a visitor's choice (opt-out means the tracker does not inject itself) is each tracking plugin's responsibility; the consent contract details are deferred.
- Fully client-side, so static-capable and portable.

### Child processes (`exec:run`)
There is no general exec helper. Everything is provided through hooks and registries (themes, skeletons, components, routes). A plugin that must run a command (for example an rsync after a commit) declares the `exec:run` capability and lists the command names in `exec` in the manifest. Plugin code runs in the host process, so this is declaration for review rather than a sandbox: the audit statically scans backend code for process spawning and the validator fails a plugin that spawns without declaring it.

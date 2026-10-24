# Onboarding tour (community pack)

A four-step tour of the dashboard (`registries/dashboard/first-steps.yaml`, `action.kind: tour`), offered from the user menu with a "New here?" chip until it is finished or dismissed. Each step points at a stable dashboard anchor (`create-site`, `site-list`, `merlin`, `plugins`), which app-hax promises to keep. Plugins never target other parts of the dashboard.

There is no backend code. Progress lives in the user's scaffold memory under the `dismissKey`. The Spanish overlay (`registries/locales/es.yaml`) translates every string by key: `dashboard.<id>.<path>`.

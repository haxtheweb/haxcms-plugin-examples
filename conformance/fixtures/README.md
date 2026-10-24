# Conformance fixtures

Tiny plugins used by the executable spec conformance cases (`conformance/cases/*.yaml`, `run` blocks). They exist to exercise the platform, not to be useful: `fx-probe-*` log every hook call and take a behavior per hook from settings (veto, throw, hang, invalid return, set a field); the rest each prove one rule (routes and credentials, requirements, page cache, singleton, SSR, plugin-defined hooks, suggests, user records, config scope, transactions, theme change). Fixtures named in validator cases (`fx-contrib-required`, `fx-spawn`, `fx-detached-wait`, `fx-tracker`, `fx-no-security`, `fx-pack-code`, `fx-bad-manifest`, `fx-future`) are deliberately invalid.

Run: `node conformance/run.mjs` (also part of `npm test`).

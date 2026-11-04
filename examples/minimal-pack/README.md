# minimal-pack

The smallest valid plugin: a manifest and nothing else. `kind: pack` means declarative only (no backend code), so it is safe at any tier.

Add files under `registries/` (themes, skeletons, elements, locales, merlin) and run `hax plugin build` to make it do something. See `../example` for every extension point.

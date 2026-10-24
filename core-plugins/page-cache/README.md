# Page cache (core, optional)

Serves rendered pages from a per-site cache to visitors who are not signed in.

- `render.before` answers with a stored document (`ctx.respond`) when there is a fresh one. `render.after` stores it.
- Only `mode: dynamic` renders with no user, and only when no plugin set the render context's `cacheable` to `false`.
- Cleared on page saves and deletes, site saves, any plugin's settings save (`config: ["*"]`), and any plugin being enabled or disabled.
- Settings: `ttl` seconds (0 keeps pages until something changes). `pageCacheClear` empties it by hand.

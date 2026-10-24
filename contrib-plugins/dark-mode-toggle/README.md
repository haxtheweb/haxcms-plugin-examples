# Dark mode toggle (community, Node only)

Adds a floating light/dark switch (`<dark-mode-toggle>`, `role: injected`) to published pages. The default scheme and position are baked in as attributes at render, so the client never reads server settings. The visitor's choice stays in their browser.

It appears only on themes whose registry entry lists both `light` and `dark` in `colorSchemes`, read through `ctx.registries.theme()`. A dark-only theme such as neon-glow-theme gets no toggle.

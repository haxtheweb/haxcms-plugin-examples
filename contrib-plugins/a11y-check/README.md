# Accessibility check (community, Node only)

Quick markup rules (image alt text, link text, heading order, table headers) that run when a page is saved and in the editor's preview.

- `page.before.save`: warnings only, unless **Refuse saves with images that have no alt text** is on. In that case missing alt text is a 422 veto; `alt=""` still passes for decorative images.
- `render.after.content`: in `mode: preview` only, outlines the problems. Published pages never carry it.
- `a11yCheckReport` (MCP-visible) lists every page with problems, worst first. The `fix-a11y-issues` prompt asks an agent to propose fixes from it.

Not a full WCAG audit; it catches the common, mechanical problems.

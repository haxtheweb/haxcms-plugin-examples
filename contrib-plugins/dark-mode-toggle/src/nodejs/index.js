// Dark mode toggle (Node only). Adds the singleton only where the theme supports both schemes.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default {
  hooks: {
    "render.after.body": async (ctx) => {
      const theme = await ctx.registries.theme(ctx.subject.theme);
      const schemes = (theme && theme.colorSchemes) || ["light"];
      if (!(schemes.includes("light") && schemes.includes("dark"))) return;
      ctx.subject.body.end.push(
        `<script type="module" src="${esc(ctx.assets.url("frontend/dist/dark-mode-toggle.js"))}"></script>`,
        `<dark-mode-toggle default="${esc(ctx.settings.default)}" position="${esc(ctx.settings.position)}"></dark-mode-toggle>`,
      );
      return ctx.subject;
    },
  },
};

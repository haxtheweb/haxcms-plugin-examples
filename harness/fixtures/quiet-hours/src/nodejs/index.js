// Vetoes every explosion fired through the example plugin's own hook.
export default {
  hooks: {
    "example.before.explode": async (ctx) => ctx.veto("Quiet hours: no explosions right now"),
  },
};

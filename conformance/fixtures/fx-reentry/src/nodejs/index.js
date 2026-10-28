// saves a page from its own page.after.save: without the no-re-entry rule this never ends
export default { hooks: { "page.after.save": async (ctx) => {
  const n = ((await ctx.entities.get("page", "counter")) || { id: "counter", title: "Counter", content: "", metadata: { n: 0 } });
  n.metadata = { n: (n.metadata.n || 0) + 1 };
  await ctx.entities.save("page", n);
} } };

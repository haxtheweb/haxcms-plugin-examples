// Changelog (Node only). The page is an ordinary page the plugin owns by id; authors may move it but edits are replaced.
const ID = "changelog";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export default {
  hooks: {
    "git.after.commit": async (ctx) => {
      const page = (await ctx.entities.get("page", ID)) || { id: ID, title: "Changes", slug: "changes", parent: null, order: 9999, content: "", metadata: { log: [] } };
      const log = [{ hash: String(ctx.subject.hash).slice(0, 7), message: ctx.subject.message, author: ctx.subject.author }, ...((page.metadata && page.metadata.log) || [])].slice(0, 50);
      page.metadata = { ...(page.metadata || {}), log };
      page.content = `<ul class="changelog">${log.map((e) => `<li><code>${esc(e.hash)}</code> ${esc(e.message)} <span>${esc(e.author)}</span></li>`).join("")}</ul>`;
      // git is still inside page.after.save, so this save is not committed on its own (no re-entry, spec/06); the
      // Changes page goes into the next commit with everything else
      await ctx.entities.save("page", page);
    },
  },
};

// Outline (Node). Mirrored in src/php/Plugin.php.
import { check, slugify } from "./outline.js";

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);

export default {
  operations: {
    /**
     * Implements operation outlineGet.
     *
     * Lists every page as { id, title, parent, order, slug } in outline order, which is what the outline designer loads.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @returns {Promise<object>}  { items }.
     */
    async outlineGet(ctx) {
      return { items: (await ctx.entities.list("page")).sort(byOrder).map(({ id, title, parent = null, order = 0, slug = null }) => ({ id, title, parent, order, slug })) };
    },
    /**
     * Implements operation outlineUpdate.
     *
     * Applies a whole outline in one bulk transaction: removes pages left out, creates new ones and saves only the pages whose title, parent or order changed, so page and site hooks fire and git makes one commit. The outline is checked first (ids, parents, no loops); a veto from another plugin comes back as 409 with the outline as it stands.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.body.items: [{ id, title, parent, order }]; ids not yet on the site are new pages.
     * @returns {Promise<object>}  { items, idMap } (idMap maps request ids to new page ids), or { status, body: { error } }.
     */
    async outlineUpdate(ctx, req) {
      const wanted = (req.body.items || []).map((it, i) => ({ ...it, order: it.order ?? i, parent: it.parent || null }));
      const problem = check(wanted);
      if (problem) return { status: 400, body: { error: problem } };
      const existing = Object.fromEntries((await ctx.entities.list("page")).map((p) => [p.id, p]));
      const idMap = {};
      let n = Object.keys(existing).length;
      // new ids first, so parents can point at pages created in the same request
      for (const it of wanted) if (!existing[it.id]) idMap[it.id] = `item-${++n}`;
      const real = (id) => (id ? idMap[id] || id : null);
      const vetoed = [];
      await ctx.transaction.run(async () => {
        for (const id of Object.keys(existing)) if (!wanted.some((w) => w.id === id)) { const r = await ctx.entities.delete("page", id); if (r.veto) vetoed.push(r.veto.message); }
        for (const it of wanted) {
          const id = real(it.id);
          const before = existing[it.id];
          const record = { ...(before || { content: "" }), id, title: it.title, parent: real(it.parent), order: it.order, slug: (before && before.slug) || slugify(it.title) };
          if (!before || before.title !== record.title || (before.parent || null) !== record.parent || (before.order ?? 0) !== record.order) {
            const r = await ctx.entities.save("page", record);
            if (r.veto) vetoed.push(r.veto.message);
          }
        }
        const site = await ctx.entities.get("site");
        site.items = wanted.map((it) => ({ id: real(it.id), title: it.title, parent: real(it.parent), order: it.order }));
        await ctx.entities.save("site", site);
      }, { bulk: true, origin: "outline" });
      const items = (await ctx.entities.list("page")).sort(byOrder).map(({ id, title, parent = null, order = 0 }) => ({ id, title, parent, order }));
      return vetoed.length ? { status: 409, body: { error: vetoed.join("; "), items, idMap } } : { items, idMap };
    },
  },
};

// Glossary (Node only).
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const rx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const norm = (t) => String(t || "").trim().toLowerCase();

export default {
  operations: {
    /**
     * Implements operation glossaryList.
     *
     * Lists the glossary terms in alphabetical order.
     *
     * @param {object} ctx
     * @returns {array}  glossaryTerm records.
     */
    async glossaryList(ctx) {
      return (await ctx.entities.list("glossaryTerm")).sort((a, b) => norm(a.term).localeCompare(norm(b.term)));
    },
    /**
     * Implements operation glossaryCreate.
     *
     * Adds a term with its definition and aliases; the entity hooks refuse duplicates and terms without a definition.
     *
     * @param {object} ctx
     * @param {object} req  req.body { term, definition, aliases }.
     * @returns {object}  the stored term, or a 409/422 response.
     */
    async glossaryCreate(ctx, req) {
      const b = req.body || {};
      const r = await ctx.entities.save("glossaryTerm", { uuid: `term-${norm(b.term).replace(/[^a-z0-9]+/g, "-")}`, term: String(b.term || "").trim(), definition: String(b.definition || "").trim(), aliases: (b.aliases || []).map(String) });
      if (r.veto) return { status: r.veto.status || 409, body: { error: r.veto.message } };
      return r.record;
    },
  },
  hooks: {
    /**
     * Implements hook entity.before.create.
     *
     * Refuses a new glossary term without a definition, or whose name or aliases are already in the glossary. The
     * entity hooks guard the glossary for every writer (this plugin's route, an import, another plugin).
     *
     * @param {object} ctx  ctx.subject: the glossaryTerm record being created.
     * @returns {Promise<object>}  the term, or a veto.
     */
    "entity.before.create": async (ctx) => {
      const t = ctx.subject;
      if (!t.term || !t.definition) return ctx.veto("a term needs a definition", 422);
      const all = await ctx.entities.list("glossaryTerm");
      const names = new Set(all.flatMap((x) => [x.term, ...(x.aliases || [])].map(norm)));
      for (const n of [t.term, ...(t.aliases || [])].map(norm)) if (names.has(n)) return ctx.veto(`"${n}" is already in the glossary`, 409);
      return t;
    },
    /**
     * Implements hook entity.before.update.
     *
     * Refuses a glossary term update that leaves out the term or its definition, for every writer.
     *
     * @param {object} ctx  ctx.subject: the glossaryTerm record as updated; ctx.previous: the stored record.
     * @returns {Promise<object>}  the term, or a veto.
     */
    "entity.before.update": async (ctx) => (ctx.subject.term && ctx.subject.definition ? ctx.subject : ctx.veto("a term needs a definition", 422)),
    /**
     * Implements hook render.after.content.
     *
     * Wraps the first appearance of each term in the page text in <glossary-term> with its definition, never inside
     * tags, links, headings or code.
     *
     * @param {object} ctx  ctx.subject: the render state (page, content).
     * @returns {Promise<object|undefined>}  the render state with terms marked, or nothing when the glossary is empty.
     */
    "render.after.content": async (ctx) => {
      const terms = (await ctx.entities.list("glossaryTerm")).flatMap((t) => [t.term, ...(t.aliases || [])].map((name) => ({ name, def: t.definition }))).sort((a, b) => b.name.length - a.name.length);
      if (!terms.length) return;
      const seen = new Set();
      const parts = ctx.subject.content.split(/(<[^>]+>)/);
      let skip = 0;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.startsWith("<")) { if (/^<(a|h[1-6]|code|pre|glossary-term)\b/i.test(p)) skip++; else if (/^<\/(a|h[1-6]|code|pre|glossary-term)>/i.test(p)) skip = Math.max(0, skip - 1); continue; }
        if (skip) continue;
        let text = p;
        for (const t of terms) {
          if (seen.has(norm(t.def))) continue;
          const m = new RegExp(`\\b${rx(t.name)}\\b`, "i").exec(text);
          if (!m) continue;
          seen.add(norm(t.def));
          text = `${text.slice(0, m.index)}\u0001${esc(t.def)}\u0002${m[0]}\u0003${text.slice(m.index + m[0].length)}`;
        }
        parts[i] = text.replace(/\u0001([^\u0002]*)\u0002([^\u0003]*)\u0003/g, '<glossary-term definition="$1">$2</glossary-term>');
      }
      ctx.subject.content = parts.join("");
      return ctx.subject;
    },
  },
};

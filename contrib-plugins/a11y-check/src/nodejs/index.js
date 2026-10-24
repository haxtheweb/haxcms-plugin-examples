// Accessibility check (Node only). Simple, fast markup rules; not a replacement for a full audit.
const RULES = [
  { id: "img-alt", level: "error", test: (h) => [...h.matchAll(/<img\b(?![^>]*\balt=)[^>]*>/gi)].map((m) => m[0].slice(0, 80)), message: "image without alt text" },
  { id: "link-text", level: "warning", test: (h) => [...h.matchAll(/<a\b[^>]*>\s*(click here|here|read more|more|link)?\s*<\/a>/gi)].map((m) => m[0].slice(0, 80)), message: "link text does not say where it goes" },
  { id: "heading-order", level: "warning", test: (h) => {
      const out = []; let last = 1; // the page title is the h1
      for (const m of h.matchAll(/<h([1-6])\b/gi)) { const n = Number(m[1]); if (n > last + 1) out.push(`h${last} then h${n}`); last = n; }
      return out;
    }, message: "heading level skipped" },
  { id: "table-headers", level: "warning", test: (h) => [...h.matchAll(/<table\b[\s\S]*?<\/table>/gi)].filter((m) => !/<th\b/i.test(m[0])).map(() => "table"), message: "data table without header cells" },
];

export function check(html) {
  const out = [];
  for (const r of RULES) for (const where of r.test(String(html || ""))) out.push({ rule: r.id, level: r.level, message: r.message, where });
  return out;
}

export default {
  operations: {
    async a11yCheckReport(ctx) {
      const pages = await ctx.entities.list("page");
      return pages
        .map((p) => ({ page: p.id, title: p.title, problems: check(p.content) }))
        .filter((p) => p.problems.length)
        .sort((a, b) => b.problems.filter((x) => x.level === "error").length - a.problems.filter((x) => x.level === "error").length || b.problems.length - a.problems.length || a.page.localeCompare(b.page));
    },
  },
  hooks: {
    "page.before.save": async (ctx) => {
      const problems = check(ctx.subject.content);
      const missingAlt = problems.filter((p) => p.rule === "img-alt");
      if (missingAlt.length && ctx.settings.blockMissingAlt) return ctx.veto(`${missingAlt.length} image(s) need alt text (use alt="" for decorative images)`, 422);
      for (const p of problems) ctx.warn(`${p.message}: ${p.where}`, p.level === "error" ? "warning" : "notice");
      return ctx.subject;
    },
    // preview only: published pages never carry the overlay
    "render.after.content": async (ctx) => {
      if (ctx.subject.mode !== "preview" || !ctx.settings.previewOverlay) return;
      const problems = check(ctx.subject.content);
      if (!problems.length) return;
      ctx.subject.head.push(`<style>main img:not([alt]){outline:4px dashed var(--ddd-theme-default-error,#c00)}</style>`);
      ctx.subject.content = `<aside class="a11y-check" role="note">${problems.length} accessibility problem(s) on this page</aside>` + ctx.subject.content;
      return ctx.subject;
    },
  },
};

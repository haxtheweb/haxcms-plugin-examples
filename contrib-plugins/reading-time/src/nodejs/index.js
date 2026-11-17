// Reading time (Node). Mirrored in src/php/Plugin.php.
const NS = "reading-time";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const count = (html) => { const t = String(html || "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ").trim(); return t ? t.split(/\s+/).length : 0; };

export default {
  hooks: {
    /**
     * Implements hook page.before.save.
     *
     * Counts the words of the page and stores the word count and reading time in metadata.plugins.reading-time, so
     * themes and the render hook can show it without counting again. Uses the wordsPerMinute setting (200 by default).
     *
     * @param {object} ctx  ctx.subject: the page as submitted; ctx.previous: the stored page.
     * @returns {Promise<object>}  the page with the computed fields.
     */
    "page.before.save": async (ctx) => {
      const p = ctx.subject;
      const words = count(p.content);
      const minutes = words ? Math.max(1, Math.round(words / (Number(ctx.settings.wordsPerMinute) || 200))) : 0;
      const metadata = p.metadata || {};
      return { ...p, metadata: { ...metadata, plugins: { ...(metadata.plugins || {}), [NS]: { words, minutes } } } };
    },
    /**
     * Implements hook render.before.content.
     *
     * Puts a short reading-time line above the page content, using the minutes stored at save time and the label
     * setting.
     *
     * @param {object} ctx  ctx.subject: the render state (page, content).
     * @returns {object|undefined}  the render state with the line added, or nothing when the page has no reading time.
     */
    "render.before.content": async (ctx) => {
      const m = ctx.subject.page && ctx.subject.page.metadata && ctx.subject.page.metadata.plugins && ctx.subject.page.metadata.plugins[NS];
      if (!m || !m.minutes) return;
      ctx.subject.content = `<p class="reading-time">${esc(String(ctx.settings.label || "{n} min read").replace("{n}", m.minutes))}</p>${ctx.subject.content}`;
      return ctx.subject;
    },
  },
};

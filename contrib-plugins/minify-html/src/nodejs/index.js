// Minify HTML (Node only). Leaves <script>, <style>, <pre> and <textarea> contents untouched.
export function minify(html) {
  const keep = [];
  const held = String(html).replace(/<(script|style|pre|textarea)\b[\s\S]*?<\/\1>/gi, (m) => `\u0000${keep.push(m) - 1}\u0000`);
  return held
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, "")
    .replace(/(>|\u0000)\s+(?=<|\u0000)/g, "$1")
    .replace(/\s{2,}/g, " ")
    // an inline script often starts on its own line; the newline is part of its contents, and so of its CSP hash
    .replace(/\u0000(\d+)\u0000/g, (m, i) => keep[Number(i)].replace(/^(<script\b[^>]*>)\s+/i, "$1"));
}

export default {
  hooks: {
    /**
     * Implements hook render.after.
     *
     * Removes comments and extra whitespace from the finished HTML, leaving script, style, pre and textarea contents
     * untouched. Runs in the transform stage, before csp-headers hashes the scripts in the seal stage.
     *
     * @param {object} ctx  ctx.subject: the finished document (html).
     * @returns {Promise<object>}  the document with minified html.
     */
    "render.after": async (ctx) => { ctx.subject.html = minify(ctx.subject.html); return ctx.subject; },
  },
};

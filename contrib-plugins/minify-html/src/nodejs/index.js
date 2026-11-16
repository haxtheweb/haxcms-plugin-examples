// Minify HTML (Node only). Leaves <script>, <style>, <pre> and <textarea> contents untouched.
// drops <!-- comments -->, keeping conditional ones (<!--[if ...]>), by scanning rather than by regex replacement
function withoutComments(html) {
  let out = "";
  let i = 0;
  while (i < html.length) {
    const start = html.indexOf("<!--", i);
    if (start < 0) { out += html.slice(i); break; }
    const end = html.indexOf("-->", start + 4);
    const next = end < 0 ? html.length : end + 3;
    out += html.slice(i, start) + (html.startsWith("<!--[if", start) ? html.slice(start, next) : "");
    i = next;
  }
  return out;
}

export function minify(html) {
  const keep = [];
  const held = String(html).replace(/<(script|style|pre|textarea)\b[\s\S]*?<\/\1>/gi, (m) => `\u0000${keep.push(m) - 1}\u0000`);
  return withoutComments(held)
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

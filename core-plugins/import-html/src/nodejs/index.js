// HTML file import (Node). Mirrored in src/php/Plugin.php.
const strip = (h) => String(h)
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1>/gi, "")
  .replace(/<(script|style|link|meta|base)\b[^>]*>/gi, "")
  .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
  .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');

export function htmlFileToHtml(text) {
  const title = ((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text) || [null, ""])[1]).replace(/\s+/g, " ").trim();
  const body = (/<body[^>]*>([\s\S]*)<\/body>/i.exec(text) || [null, text])[1];
  const html = strip(body).replace(/>\s+</g, "><").trim();
  return { html, ...(title ? { title } : {}) };
}

export default {
  contracts: {
    "import.file": {
      /**
       * Implements contract import.file, operation convert (dispatch: accepts .html, .htm).
       *
       * Keeps the body, drops scripts, styles, embeds, comments, inline event handlers and javascript: links, and
       * returns the rest for core to split into pages (core sanitizes again when pages are saved).
       *
       * @param {object} ctx    Platform context (spec/13).
       * @param {object} input  { name, data (base64), method, type, parentId }.
       * @returns {Promise<object>}  { html, title? } or { error }.
       */
      async convert(ctx, input) {
        const text = Buffer.from(String(input.data || ""), "base64").toString("utf8");
        const r = htmlFileToHtml(text);
        return r.html ? r : { error: "the file has no content" };
      },
    },
  },
};

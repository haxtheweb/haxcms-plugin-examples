// Content security policy (Node only). Hashes the inline scripts of the final document.
import { createHash } from "node:crypto";

export default {
  hooks: {
    /**
     * Implements hook render.after.
     *
     * Hashes the inline scripts of the final document and adds a Content-Security-Policy meta tag that allows only
     * those scripts, the site itself and the extraHosts setting. Runs in the seal stage, after every other change to
     * the HTML, so the hashes match what is sent.
     *
     * @param {object} ctx  ctx.subject: the finished document (html).
     * @returns {Promise<object>}  the document with the policy in its head.
     */
    "render.after": async (ctx) => {
      const html = ctx.subject.html;
      const hashes = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => `'sha256-${createHash("sha256").update(m[1], "utf8").digest("base64")}'`);
      const hosts = String(ctx.settings.extraHosts || "").split("\n").map((h) => h.trim()).filter((h) => /^[a-z0-9.-]+$/i.test(h)).map((h) => `https://${h}`);
      const policy = [`default-src 'self'`, `script-src 'self' ${[...new Set(hashes)].join(" ")} ${hosts.join(" ")}`.replace(/\s+/g, " ").trim(), `object-src 'none'`, `base-uri 'self'`].join("; ");
      ctx.subject.html = html.replace(/<head>/i, `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`);
      return ctx.subject;
    },
  },
};

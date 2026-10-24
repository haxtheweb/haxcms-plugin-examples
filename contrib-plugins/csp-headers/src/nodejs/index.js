// Content security policy (Node only). Hashes the inline scripts of the final document.
import { createHash } from "node:crypto";

export default {
  hooks: {
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

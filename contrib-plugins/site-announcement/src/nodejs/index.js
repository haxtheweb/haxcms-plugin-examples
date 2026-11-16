// Site announcement (Node). Puts the site's announcement bar right after <body>, on any theme. Mirrored in
// src/php/Plugin.php; both apply the same rules, so the same settings give the same markup.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const VARIANTS = ["brand", "neutral", "success", "warning", "danger"];

/** plain text: no markup characters or control characters, single spaces, at most max code points */
export function plain(value, max) {
  const s = String(value ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/ +/g, " ").trim();
  return [...s].slice(0, max).join("").trim();
}

/** http(s), mailto, or a path on this site; anything else (javascript:, data:, //other-host) is dropped */
export function safeLink(value) {
  const s = String(value ?? "").replace(/[\u0000- \u007f]/g, "");
  if (!s) return "";
  if (/^(https?:\/\/|mailto:)/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//") || s.startsWith("\\")) return "";
  return s;
}

/** YYYY-MM-DD that is a real day, or "" */
export function day(value) {
  const s = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : "";
}

/** the announcement to show from settings, or null when there is nothing to show on the day `today` */
export function announcement(settings, today) {
  const s = settings || {};
  const a = {
    title: plain(s.title, 120),
    text: plain(s.text, 500),
    link: safeLink(s.link),
    linkText: plain(s.linkText, 80),
    variant: VARIANTS.includes(s.variant) ? s.variant : "brand",
    ends: day(s.ends),
  };
  if (!a.title && !a.text) return null;
  if (a.ends && a.ends < today) return null;
  return a;
}

export default {
  hooks: {
    /**
     * Implements hook render.before.body.
     *
     * Adds the site-announcement-bar element and its script right after the opening body tag, with the announcement
     * baked in as attributes, so it sits above whatever the theme draws. Adds nothing when the announcement is empty
     * or its end date has passed.
     *
     * @param {object} ctx  ctx.subject: the render context ({ site, body: { start, end }, ... }); ctx.settings: title,
     *                      text, link, linkText, variant, ends; ctx.now(): the clock.
     * @returns {Promise<object|undefined>}  the context with the bar pushed to body.start, or nothing to show.
     */
    "render.before.body": async (ctx) => {
      const a = announcement(ctx.settings, new Date(ctx.now()).toISOString().slice(0, 10));
      if (!a) return;
      const site = (ctx.subject.site && ctx.subject.site.id) || "";
      const attrs = [
        ["site", site], ["variant", a.variant], ["heading", a.title], ["text", a.text],
        ["link", a.link], ["link-text", a.link ? a.linkText : ""], ["ends", a.ends],
      ].filter(([, v]) => v !== "").map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
      ctx.subject.body.start.push(
        `<script type="module" src="${esc(ctx.assets.url("frontend/dist/site-announcement-bar.js"))}"></script>`,
        `<site-announcement-bar${attrs}></site-announcement-bar>`,
      );
      return ctx.subject;
    },
  },
};

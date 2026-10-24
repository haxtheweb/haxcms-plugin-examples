// Author profile (Node). Mirrored in src/php/Plugin.php.
export const FIELDS = ["phone", "location", "website2", "socialLink", "socialLink2"];
const LINKS = ["website2", "socialLink", "socialLink2"];
const clean = (values) => Object.fromEntries(FIELDS.filter((f) => values[f]).map((f) => [f, String(values[f]).trim()]));
const esc = (s) => String(s).replace(/</g, "\\u003c");

export default {
  hooks: {
    /**
     * Implements hook config.before.save.
     *
     * Trims the profile fields and refuses a website or social link that is not an http(s) address.
     *
     * @param {object} ctx  ctx.subject: { plugin, scope, siteId, values } as submitted; ctx.previous: the stored values.
     * @returns {Promise<object>}  the subject with trimmed values, or a veto.
     */
    "config.before.save": async (ctx) => {
      const values = { ...ctx.subject.values, ...clean(ctx.subject.values) };
      for (const f of LINKS) if (values[f] && !/^https?:\/\/[^\s"<>]+$/.test(values[f])) return ctx.veto(`${f} must be a web address starting with http:// or https://`);
      return { ...ctx.subject, values };
    },
    /**
     * Implements hook config.after.save.
     *
     * Writes the cleaned profile to the manifest store, so themes such as resume-theme can show it client-side.
     *
     * @param {object} ctx  ctx.subject: { plugin, scope, siteId, values } as written; ctx.previous: the values before the save.
     * @returns {Promise<void>}  nothing.
     */
    "config.after.save": async (ctx) => {
      await ctx.storage.write("profile", clean(ctx.subject.values));
    },
    /**
     * Implements hook render.before.head.
     *
     * Adds a schema.org Person block with the author's location and links, so search engines can describe the author.
     *
     * @param {object} ctx  ctx.subject: the render context ({ site, page, head, ... }); ctx.settings: the profile fields.
     * @returns {Promise<object|undefined>}  the context with the JSON-LD in head, or nothing when there is no location or link.
     */
    "render.before.head": async (ctx) => {
      const p = clean(ctx.settings);
      const sameAs = LINKS.map((f) => p[f]).filter(Boolean);
      if (!sameAs.length && !p.location) return;
      const person = { "@context": "https://schema.org", "@type": "Person", ...(p.location ? { address: p.location } : {}), ...(sameAs.length ? { sameAs } : {}) };
      ctx.subject.head.push(`<script type="application/ld+json">${esc(JSON.stringify(person))}</script>`);
      return ctx.subject;
    },
  },
};

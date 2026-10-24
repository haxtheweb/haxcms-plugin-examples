// Author profile (Node). Mirrored in src/php/Plugin.php.
export const FIELDS = ["phone", "location", "website2", "socialLink", "socialLink2"];
const LINKS = ["website2", "socialLink", "socialLink2"];
const clean = (values) => Object.fromEntries(FIELDS.filter((f) => values[f]).map((f) => [f, String(values[f]).trim()]));
const esc = (s) => String(s).replace(/</g, "\\u003c");

export default {
  hooks: {
    "config.before.save": async (ctx) => {
      const values = { ...ctx.subject.values, ...clean(ctx.subject.values) };
      for (const f of LINKS) if (values[f] && !/^https?:\/\/[^\s"<>]+$/.test(values[f])) return ctx.veto(`${f} must be a web address starting with http:// or https://`);
      return { ...ctx.subject, values };
    },
    "config.after.save": async (ctx) => {
      await ctx.storage.write("profile", clean(ctx.subject.values));
    },
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

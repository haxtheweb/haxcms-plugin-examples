// Plausible Analytics (Node only; runtimes: [nodejs]).
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

export default {
  hooks: {
    "plugin.before.requirements": async (ctx) =>
      ctx.settings.domain ? ctx.subject : [...ctx.subject, { key: "settings.domain", message: "Add the domain registered in Plausible" }],

    "config.before.save": async (ctx) => {
      const v = ctx.subject.values;
      for (const k of ["domain", "host"]) {
        const d = String(v[k] ?? "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
        if (d && !DOMAIN.test(d)) return ctx.veto(`"${d}" is not a domain name`, 422);
        if (k in v) v[k] = d;
      }
      return ctx.subject;
    },

    "render.before.head": async (ctx) => {
      const { domain, host = "plausible.io", waitForConsent } = ctx.settings;
      if (!domain) return;
      const tag = `const s=document.createElement("script");s.defer=true;s.dataset.domain="${domain}";s.src="https://${host}/js/script.js";document.head.appendChild(s);`;
      // generic consent API: HAXConsent exists only when some consent plugin is enabled; no plugin is named
      ctx.subject.head.push(waitForConsent
        ? `<script type="module">const go=()=>{${tag}};const c=globalThis.HAXConsent;if(c)c.onGrant("analytics",go);else go();</script>`
        : `<script type="module">${tag}</script>`);
      return ctx.subject;
    },
  },
};

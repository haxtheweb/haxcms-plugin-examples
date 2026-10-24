// Plausible Analytics (Node only; runtimes: [nodejs]).
const DOMAIN = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

export default {
  hooks: {

    /**
     * Implements hook config.before.save.
     *
     * Normalizes the domain and host settings (dropping any scheme and trailing slash) and refuses values that are not
     * domain names, so the script tag is never built from a URL or junk.
     *
     * @param {object} ctx  ctx.subject: the settings being saved (values); ctx.previous: the stored settings.
     * @returns {Promise<object>}  the settings, or a veto.
     */
    "config.before.save": async (ctx) => {
      const v = ctx.subject.values;
      for (const k of ["domain", "host"]) {
        const d = String(v[k] ?? "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
        if (d && !DOMAIN.test(d)) return ctx.veto(`"${d}" is not a domain name`, 422);
        if (k in v) v[k] = d;
      }
      return ctx.subject;
    },

    /**
     * Implements hook render.before.head.
     *
     * Adds the Plausible script for the configured domain to the page head. With waitForConsent on, the script waits
     * for analytics consent through the generic HAXConsent API, which exists only when some consent plugin is enabled;
     * no plugin is named.
     *
     * @param {object} ctx  ctx.subject: the render state (page, head).
     * @returns {object|undefined}  the render state with the script, or nothing when no domain is set.
     */
    "render.before.head": async (ctx) => {
      const { domain, host = "plausible.io", waitForConsent } = ctx.settings;
      if (!domain) return;
      const tag = `const s=document.createElement("script");s.defer=true;s.dataset.domain="${domain}";s.src="https://${host}/js/script.js";document.head.appendChild(s);`;
      ctx.subject.head.push(waitForConsent
        ? `<script type="module">const go=()=>{${tag}};const c=globalThis.HAXConsent;if(c)c.onGrant("analytics",go);else go();</script>`
        : `<script type="module">${tag}</script>`);
      return ctx.subject;
    },
  },
};

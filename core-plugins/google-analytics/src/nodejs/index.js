// Google Analytics (Node). Mirrored in src/php/Plugin.php.
const ID = /^(G-[A-Z0-9]{4,}|UA-\d{4,}-\d+)$/;

export default {
  hooks: {
    /**
     * Implements hook config.before.save.
     *
     * Refuses a measurement id that is not G-XXXXXXXXXX or UA-XXXXX-Y, and trims it before it is stored. It sees only
     * this plugin's own config (no `config` filter in plugin.yaml).
     *
     * @param {object} ctx  ctx.subject: { plugin, scope, siteId, values } as submitted; ctx.previous: the stored values.
     * @returns {Promise<object>}  the subject with the trimmed id, or a veto.
     */
    "config.before.save": async (ctx) => {
      const id = String(ctx.subject.values.measurementId || "").trim();
      if (id && !ID.test(id)) return ctx.veto(`"${id}" is not a Google Analytics measurement id (G-XXXXXXXXXX or UA-XXXXX-Y)`);
      return { ...ctx.subject, values: { ...ctx.subject.values, measurementId: id } };
    },

    /**
     * Implements hook render.before.head.
     *
     * Adds a loader that waits for analytics consent (cookie-consent's HAXConsent API), then loads gtag with the site's
     * measurement id baked in.
     *
     * @param {object} ctx  ctx.subject: the render context ({ site, page, head, ... }); ctx.settings.measurementId.
     * @returns {Promise<object|undefined>}  the context with the loader in head, or nothing when no valid id is set.
     */
    "render.before.head": async (ctx) => {
      const id = ctx.settings.measurementId;
      if (!id || !ID.test(id)) return;
      ctx.subject.head.push(
        `<script type="module">globalThis.dataLayer=globalThis.dataLayer||[];function gtag(){dataLayer.push(arguments);}` +
          `const go=()=>{gtag("js",new Date());gtag("config","${id}");const s=document.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id=${id}";document.head.appendChild(s);};` +
          `const c=globalThis.HAXConsent;if(c)c.onGrant("analytics",go);else addEventListener("load",()=>globalThis.HAXConsent&&globalThis.HAXConsent.onGrant("analytics",go));</script>`,
      );
      return ctx.subject;
    },
  },
};

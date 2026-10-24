// Google Analytics (Node). Mirrored in src/php/Plugin.php.
const ID = /^(G-[A-Z0-9]{4,}|UA-\d{4,}-\d+)$/;

export default {
  hooks: {
    // inactive until a measurement id is set; the plugin screen shows why
    "plugin.before.requirements": async (ctx) =>
      ctx.settings.measurementId ? ctx.subject : [...ctx.subject, { key: "settings.measurementId", message: "Add your Google Analytics measurement id" }],

    // only this plugin's own config (no `config` filter in plugin.yaml)
    "config.before.save": async (ctx) => {
      const id = String(ctx.subject.values.measurementId || "").trim();
      if (id && !ID.test(id)) return ctx.veto(`"${id}" is not a Google Analytics measurement id (G-XXXXXXXXXX or UA-XXXXX-Y)`);
      return { ...ctx.subject, values: { ...ctx.subject.values, measurementId: id } };
    },

    // first enable on a site: move the old core setting out of site.json (legacy.settings in plugin.yaml)
    "plugin.after.install": async (ctx) => {
      const site = await ctx.entities.get("site");
      const old = site && site.metadata && site.metadata.site && site.metadata.site.settings && site.metadata.site.settings.gaID;
      if (!old) return;
      if (!ctx.settings.measurementId) await ctx.config.save({ measurementId: String(old).trim() });
      delete site.metadata.site.settings.gaID;
      await ctx.entities.save("site", site);
      ctx.log.info("moved gaID out of site.json into google-analytics settings");
    },

    // the loader waits for consent (cookie-consent's HAXConsent API), then loads gtag with the id baked in
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

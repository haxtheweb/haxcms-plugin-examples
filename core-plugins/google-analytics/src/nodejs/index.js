// Google Analytics (Node). Mirrored in src/php/Plugin.php.
const ID = /^(G-[A-Z0-9]{4,}|UA-\d{4,}-\d+)$/;

export default {
  hooks: {

    // only this plugin's own config (no `config` filter in plugin.yaml)
    "config.before.save": async (ctx) => {
      const id = String(ctx.subject.values.measurementId || "").trim();
      if (id && !ID.test(id)) return ctx.veto(`"${id}" is not a Google Analytics measurement id (G-XXXXXXXXXX or UA-XXXXX-Y)`);
      return { ...ctx.subject, values: { ...ctx.subject.values, measurementId: id } };
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

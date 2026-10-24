// Cookie consent (Node). The banner goes into published pages only while an active plugin declares tracking
// that needs consent; it lists the categories those plugins declare. Mirrored in src/php/Plugin.php.
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export async function categoriesNeedingConsent(ctx) {
  const cats = new Set();
  for (const p of await ctx.plugins.list()) {
    if (p.privacy && p.privacy.tracking) for (const c of p.privacy.requiresConsent || []) cats.add(c);
  }
  return [...cats].sort();
}

export default {
  hooks: {
    "render.after.body": async (ctx) => {
      const cats = await categoriesNeedingConsent(ctx);
      if (!cats.length) return; // nothing tracks: load nothing (spec/01, load only what is used)
      const s = ctx.settings;
      ctx.subject.body.end.push(
        `<script type="module" src="${esc(ctx.assets.url("frontend/dist/cookie-consent-banner.js"))}"></script>`,
        `<cookie-consent-banner categories="${esc(cats.join(","))}" message="${esc(s.message)}"${s.policyUrl ? ` policy-url="${esc(s.policyUrl)}"` : ""}></cookie-consent-banner>`,
      );
      return ctx.subject;
    },
  },
};

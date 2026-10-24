// Offline support (Node). Mirrored in src/php/Plugin.php.
const truthy = (v) => v === true || v === "true" || v === 1 || v === "1";

// network first, cached copy when offline, offline.html as the last resort
export const WORKER = `const CACHE = "hax-offline-v1";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["offline.html"]))); self.skipWaiting(); });
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === "navigate" ? caches.match("offline.html") : Response.error()))));
});
`;
// replaces an old worker for visitors who still have one, then gets out of the way
export const REMOVER = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => self.registration.unregister())));
`;

async function writeWorker(ctx, on) {
  await ctx.files.writeManaged("service-worker.js", on ? WORKER : REMOVER);
  if (on) await ctx.files.writeManaged("offline.html", await ctx.package.read("data/offline.html"));
}

export default {
  hooks: {
    "plugin.after.install": async (ctx) => {
      const site = await ctx.entities.get("site");
      const s = (site && site.metadata && site.metadata.site && site.metadata.site.settings) || {};
      if (!("sw" in s) && !("forceUpgrade" in s)) return;
      await ctx.config.save({ serviceWorker: truthy(s.sw), forceUpgrade: truthy(s.forceUpgrade) });
      const fresh = await ctx.entities.get("site");
      delete fresh.metadata.site.settings.sw;
      delete fresh.metadata.site.settings.forceUpgrade;
      await ctx.entities.save("site", fresh);
      ctx.log.info("moved sw and forceUpgrade out of site.json");
    },
    "render.before.head": async (ctx) => {
      if (!truthy(ctx.settings.forceUpgrade)) return;
      ctx.subject.head.push(`<script nomodule>window.location.href="assets/upgrade-browser.html";</script>`);
      return ctx.subject;
    },
    "render.after.body": async (ctx) => {
      if (!truthy(ctx.settings.serviceWorker)) return;
      ctx.subject.body.end.push(`<script>if("serviceWorker"in navigator){addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js"));}</script>`);
      return ctx.subject;
    },
    "rebuild.after": async (ctx) => {
      await writeWorker(ctx, truthy(ctx.settings.serviceWorker));
    },
    "plugin.after.disable": async (ctx) => {
      await writeWorker(ctx, false);
    },
  },
};

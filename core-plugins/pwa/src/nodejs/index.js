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
    /**
     * Implements hook render.before.head.
     *
     * When forceUpgrade is on, adds a nomodule redirect that sends very old browsers to the upgrade page.
     *
     * @param {object} ctx  ctx.subject: the render context ({ site, page, head, body: { start, end }, ... }); ctx.settings.forceUpgrade.
     * @returns {Promise<object|undefined>}  the context with the redirect in head, or nothing when forceUpgrade is off.
     */
    "render.before.head": async (ctx) => {
      if (!truthy(ctx.settings.forceUpgrade)) return;
      ctx.subject.head.push(`<script nomodule>window.location.href="assets/upgrade-browser.html";</script>`);
      return ctx.subject;
    },
    /**
     * Implements hook render.after.body.
     *
     * When offline support is on, registers service-worker.js at the end of the page.
     *
     * @param {object} ctx  ctx.subject: the render context ({ site, page, head, body: { start, end }, ... }); ctx.settings.serviceWorker.
     * @returns {Promise<object|undefined>}  the context with the registration script in body.end, or nothing when offline support is off.
     */
    "render.after.body": async (ctx) => {
      if (!truthy(ctx.settings.serviceWorker)) return;
      ctx.subject.body.end.push(`<script>if("serviceWorker"in navigator){addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js"));}</script>`);
      return ctx.subject;
    },
    /**
     * Implements hook rebuild.after.
     *
     * Writes service-worker.js and offline.html when offline support is on, or a self-removing worker when it is off,
     * so visitors who installed the worker earlier lose it.
     *
     * @param {object} ctx  ctx.subject: { scope, siteId, reason, files } of the rebuild that finished; ctx.settings.serviceWorker.
     * @returns {Promise<void>}  nothing.
     */
    "rebuild.after": async (ctx) => {
      await writeWorker(ctx, truthy(ctx.settings.serviceWorker));
    },
    /**
     * Implements hook plugin.after.disable.
     *
     * Leaves a self-removing service worker behind, so visitors' browsers drop the cached site once the plugin is off.
     *
     * @param {object} ctx  ctx.subject: { id, version, scope, siteId } of this plugin.
     * @returns {Promise<void>}  nothing.
     */
    "plugin.after.disable": async (ctx) => {
      await writeWorker(ctx, false);
    },
  },
};

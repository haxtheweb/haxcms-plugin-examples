<?php
// Offline support (PHP). Mirrors src/nodejs/index.js.
class PwaPlugin {
  const WORKER = 'const CACHE = "hax-offline-v1";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["offline.html"]))); self.skipWaiting(); });
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then((hit) => hit || (e.request.mode === "navigate" ? caches.match("offline.html") : Response.error()))));
});
';
  const REMOVER = 'self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => self.registration.unregister())));
';

  private function truthy($v) { return $v === true || $v === 'true' || $v === 1 || $v === '1'; }

  private function writeWorker($ctx, $on) {
    $ctx->files->writeManaged('service-worker.js', $on ? self::WORKER : self::REMOVER);
    if ($on) { $ctx->files->writeManaged('offline.html', $ctx->package->read('data/offline.html')); }
  }


  /**
   * Implements hook render.before.head.
   *
   * When forceUpgrade is on, adds a nomodule redirect that sends very old browsers to the upgrade page.
   *
   * @param object $ctx  subject: the render context (site, page, head, body start/end, ...); settings: forceUpgrade.
   * @return array|null  the context with the redirect in head, or null when forceUpgrade is off.
   */
  public function renderBeforeHead($ctx) {
    if (!$this->truthy($ctx->settings['forceUpgrade'] ?? false)) { return null; }
    $ctx->subject['head'][] = '<script nomodule>window.location.href="assets/upgrade-browser.html";</script>';
    return $ctx->subject;
  }

  /**
   * Implements hook render.after.body.
   *
   * When offline support is on, registers service-worker.js at the end of the page.
   *
   * @param object $ctx  subject: the render context (site, page, head, body start/end, ...); settings: serviceWorker.
   * @return array|null  the context with the registration script in body end, or null when offline support is off.
   */
  public function renderAfterBody($ctx) {
    if (!$this->truthy($ctx->settings['serviceWorker'] ?? false)) { return null; }
    $ctx->subject['body']['end'][] = '<script>if("serviceWorker"in navigator){addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js"));}</script>';
    return $ctx->subject;
  }

  /**
   * Implements hook rebuild.after.
   *
   * Writes service-worker.js and offline.html when offline support is on, or a self-removing worker when it is off,
   * so visitors who installed the worker earlier lose it.
   *
   * @param object $ctx  subject: [scope, siteId, reason, files] of the rebuild that finished; settings: serviceWorker.
   * @return null
   */
  public function rebuildAfter($ctx) { $this->writeWorker($ctx, $this->truthy($ctx->settings['serviceWorker'] ?? false)); return null; }

  /**
   * Implements hook plugin.after.disable.
   *
   * Leaves a self-removing service worker behind, so visitors' browsers drop the cached site once the plugin is off.
   *
   * @param object $ctx  subject: [id, version, scope, siteId] of this plugin.
   * @return null
   */
  public function pluginAfterDisable($ctx) { $this->writeWorker($ctx, false); return null; }
}

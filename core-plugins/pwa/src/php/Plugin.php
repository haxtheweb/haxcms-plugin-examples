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


  // hook: render.before.head
  public function renderBeforeHead($ctx) {
    if (!$this->truthy($ctx->settings['forceUpgrade'] ?? false)) { return null; }
    $ctx->subject['head'][] = '<script nomodule>window.location.href="assets/upgrade-browser.html";</script>';
    return $ctx->subject;
  }

  // hook: render.after.body
  public function renderAfterBody($ctx) {
    if (!$this->truthy($ctx->settings['serviceWorker'] ?? false)) { return null; }
    $ctx->subject['body']['end'][] = '<script>if("serviceWorker"in navigator){addEventListener("load",()=>navigator.serviceWorker.register("service-worker.js"));}</script>';
    return $ctx->subject;
  }

  // hook: rebuild.after
  public function rebuildAfter($ctx) { $this->writeWorker($ctx, $this->truthy($ctx->settings['serviceWorker'] ?? false)); return null; }

  // hook: plugin.after.disable
  public function pluginAfterDisable($ctx) { $this->writeWorker($ctx, false); return null; }
}

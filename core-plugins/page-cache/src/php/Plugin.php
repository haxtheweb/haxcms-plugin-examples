<?php
// Page cache (PHP). Mirrors src/nodejs/index.js.
class PageCachePlugin {
  private function usable($ctx) { return ($ctx->subject['mode'] ?? '') === 'dynamic' && !$ctx->user && !empty($ctx->subject['page']['id']); }
  private function clear($ctx, $why) {
    $had = count($ctx->storage->read('pages') ?: []);
    $ctx->storage->write('pages', new stdClass());
    if ($had) { $ctx->log->info("cleared $had cached pages ($why)"); }
    return $had;
  }
  public function pageCacheClear($ctx) { return ['cleared' => $this->clear($ctx, 'by request')]; }
  public function renderBefore($ctx) {
    if (!$this->usable($ctx)) { return null; }
    $hit = ($ctx->storage->read('pages') ?: [])[$ctx->subject['page']['id']] ?? null;
    $ttl = (int) ($ctx->settings['ttl'] ?? 0);
    if ($hit && (!$ttl || $ctx->now() - $hit['at'] < $ttl * 1000)) { return $ctx->respond($hit['html']); }
    return null;
  }
  public function renderAfter($ctx) {
    if (!$this->usable($ctx) || ($ctx->subject['cacheable'] ?? true) === false) { return null; }
    $pages = $ctx->storage->read('pages') ?: [];
    $pages[$ctx->subject['page']['id']] = ['html' => $ctx->subject['html'], 'at' => $ctx->now()];
    $ctx->storage->write('pages', $pages);
    return null;
  }
  public function pageAfterSave($ctx) { $this->clear($ctx, 'page saved'); }
  public function pageAfterDelete($ctx) { $this->clear($ctx, 'page deleted'); }
  public function manifestAfterSave($ctx) { $this->clear($ctx, 'site saved'); }
  public function configAfterSave($ctx) { $this->clear($ctx, $ctx->subject['plugin'] . ' settings saved'); }
  public function pluginAfterEnable($ctx) { $this->clear($ctx, $ctx->subject['id'] . ' enabled'); }
  public function pluginAfterDisable($ctx) { $this->clear($ctx, $ctx->subject['id'] . ' disabled'); }
}

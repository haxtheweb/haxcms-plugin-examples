<?php
// Page cache: serve from the store in render.before, store in render.after, drop on page save (mirrors src/nodejs/index.js)
class FxCachePlugin {
  public function renderBefore($ctx) { $c = $ctx->storage->read('pages') ?: []; $hit = $c[$ctx->subject['page']['id']] ?? null; if ($hit) { return $ctx->respond($hit); } return null; }
  public function renderAfter($ctx) { $c = $ctx->storage->read('pages') ?: []; $c[$ctx->subject['page']['id']] = $ctx->subject['html']; $ctx->storage->write('pages', $c); return null; }
  public function pageAfterSave($ctx) { $c = $ctx->storage->read('pages') ?: []; unset($c[$ctx->subject['id']]); $ctx->storage->write('pages', $c); return null; }
}

<?php
// System engine probe (mirrors src/nodejs/index.js)
class FxSystemPlugin {
  public function fxSystemCount($ctx) { $n = ($ctx->storage->read('counts') ?: 0) + 1; $ctx->storage->write('counts', $n); return ['count' => $n, 'site' => $ctx->site]; }
  public function fxSystemPerSite($ctx) { $ctx->storage->write('perSite', 1); return ['ok' => true]; }
}

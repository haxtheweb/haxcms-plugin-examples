<?php
// Logs every config save it is scoped to (mirrors src/nodejs/index.js)
class FxConfigWatchPlugin {
  public function configAfterSave($ctx) { $ctx->log->info('fx-config-watch saw ' . $ctx->subject['plugin']); return null; }
}

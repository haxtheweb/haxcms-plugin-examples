<?php
// Logs entity creates it inherits (mirrors src/nodejs/index.js)
class FxInheritPlugin {
  public function entityBeforeCreate($ctx) { $ctx->log->info('fx-inherit:entity.before.create'); return null; }
}

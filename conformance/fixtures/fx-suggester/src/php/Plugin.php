<?php
// Subscribes to another plugin's hook (mirrors src/nodejs/index.js)
class FxSuggesterPlugin {
  public function fxDefinerAfterPing($ctx) { $ctx->log->info('fx-suggester:fx-definer.after.ping'); return null; }
}

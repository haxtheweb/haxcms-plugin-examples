<?php
// Logs theme changes (mirrors src/nodejs/index.js)
class FxThemePlugin {
  public function themeBeforeChange($ctx) { $ctx->log->info('fx-theme ' . ($ctx->previous['metadata']['theme'] ?? 'undefined') . ' -> ' . $ctx->subject['metadata']['theme']); return null; }
}

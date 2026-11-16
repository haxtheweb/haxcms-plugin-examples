<?php
// Adds one badge per page (mirrors src/nodejs/index.js)
class FxSingletonPlugin {
  public function renderAfterBody($ctx) { $s = $ctx->subject; $s['body']['end'][] = '<fx-badge greeting="' . preg_replace('/[<>"&]/', '', (string) ($ctx->settings['greeting'] ?? '')) . '"></fx-badge>'; return $s; }
}

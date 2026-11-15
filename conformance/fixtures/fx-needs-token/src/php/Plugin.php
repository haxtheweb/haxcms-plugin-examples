<?php
// Inactive until a token is set (mirrors src/nodejs/index.js)
class FxNeedsTokenPlugin {
  public function fxNeedsTokenPing($ctx) { return ['pong' => true]; }
  public function pluginBeforeRequirements($ctx) { if (!empty($ctx->settings['token'])) { return $ctx->subject; } $s = $ctx->subject; $s[] = ['key' => 'settings.token', 'message' => 'Set a token']; return $s; }
}

<?php
// The middle of a stack of plugins (mirrors src/nodejs/index.js): listens to the hook of the plugin it depends on,
// fires one of its own inside it, and implements the contract the plugin above calls.
class FxStackMidPlugin {
  public function fxDefinerAfterPing($ctx) {
    $ctx->log->info('fx-stack-mid:fx-definer.after.ping');
    $ctx->hooks->fire('fx-stack-mid.after.relay', ['from' => 'fx-definer', 'at' => $ctx->subject['at']]);
    return null;
  }
  public function fxStackMidStorePut($ctx, $input) {
    $ctx->log->info('fx-stack-mid stored ' . $input['name'] . ' as ' . $ctx->plugin['id']);
    return ['stored' => $input['name'], 'by' => $ctx->plugin['id']];
  }
}

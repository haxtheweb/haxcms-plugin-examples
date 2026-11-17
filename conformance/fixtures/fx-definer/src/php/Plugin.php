<?php
// Fires the hook it defines (mirrors src/nodejs/index.js)
class FxDefinerPlugin {
  public function fxDefinerPing($ctx) { $r = $ctx->hooks->fire('fx-definer.after.ping', ['at' => 1]); return ['fired' => true, 'subject' => $r['subject']]; }
}

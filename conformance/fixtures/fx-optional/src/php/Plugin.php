<?php
// Optional auth (mirrors src/nodejs/index.js)
class FxOptionalPlugin {
  // a record that happens to have status and body fields is a body, not a response envelope
  public function fxOptionalThing($ctx) { return ['status' => $ctx->user ? 'member' : 'visitor', 'body' => 'text']; }
}

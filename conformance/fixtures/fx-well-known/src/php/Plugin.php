<?php
// Serves a reserved /.well-known/ name from its settings (mirrors src/nodejs/index.js)
class FxWellKnownPlugin {
  public function fxWellKnownMetadata($ctx) { return ['issuer' => $ctx->settings['issuer']]; }
}

<?php
// Route security probe (mirrors src/nodejs/index.js)
class FxRoutesPlugin {
  public function fxRoutesSecret($ctx) { return ['version' => $ctx->haxcms->version]; }
  public function fxRoutesJwt($ctx) { return ['ok' => true]; }
  public function fxRoutesPublic($ctx) { return ['ok' => true]; }
  public function fxRoutesWhere($ctx) { return ['target' => $ctx->haxcms->target, 'runtime' => $ctx->haxcms->runtime]; }
}

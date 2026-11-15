<?php
// Transform stage (mirrors src/nodejs/index.js)
class FxStageTransformPlugin {
  public function renderAfter($ctx) { $s = $ctx->subject; $s['html'] = preg_replace('/<main>/', '<main data-t>', $s['html'], 1); return $s; }
}

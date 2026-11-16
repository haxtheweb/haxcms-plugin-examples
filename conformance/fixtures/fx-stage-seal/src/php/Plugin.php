<?php
// Seal stage (mirrors src/nodejs/index.js)
class FxStageSealPlugin {
  // records whether it saw the transformed document
  public function renderAfter($ctx) { $s = $ctx->subject; $s['html'] .= '<!--sealed:' . (strpos($s['html'], '<main data-t>') !== false ? 'after-transform' : 'before-transform') . '-->'; return $s; }
}

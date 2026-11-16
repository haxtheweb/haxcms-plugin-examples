<?php
// Vetoes every commit (mirrors src/nodejs/index.js)
class FxNoCommitsPlugin {
  public function gitBeforeCommit($ctx) { return $ctx->veto('frozen for review'); }
}

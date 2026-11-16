<?php
// Vetoes any page or file whose title or name contains "forbidden" (mirrors src/nodejs/index.js).
class FxVetoerPlugin {
  private function no($ctx) {
    $t = (string) ($ctx->subject['title'] ?? ($ctx->subject['name'] ?? ''));
    return stripos($t, 'forbidden') !== false ? $ctx->veto('fx-vetoer: forbidden') : $ctx->subject;
  }
  public function pageBeforeSave($ctx) { return $this->no($ctx); }
  public function pageBeforeDelete($ctx) { return $this->no($ctx); }
  public function fileBeforeSave($ctx) { return $this->no($ctx); }
  public function fileBeforeDelete($ctx) { return $this->no($ctx); }
}

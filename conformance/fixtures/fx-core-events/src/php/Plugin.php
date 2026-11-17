<?php
// Conformance fixture (mirrors src/nodejs/index.js): logs "<id>:<hook>" for the events core fires outside page and
// manifest saves; a before hook vetoes when the subject's name, title or message contains "forbidden".
class FxCoreEventsPlugin {
  private function seen($ctx, $name) {
    $ctx->log->info($ctx->plugin['id'] . ':' . $name);
    $s = is_array($ctx->subject) ? $ctx->subject : [];
    $text = '';
    foreach (['name', 'title', 'message'] as $k) { if (isset($s[$k]) && is_string($s[$k])) { $text .= ' ' . $s[$k]; } }
    if (strpos($name, '.before.') !== false && stripos($text, 'forbidden') !== false) { return $ctx->veto('fx-core-events: forbidden'); }
    return null;
  }
  public function fileBeforeSave($ctx) { return $this->seen($ctx, 'file.before.save'); }
  public function fileAfterSave($ctx) { return $this->seen($ctx, 'file.after.save'); }
  public function fileBeforeDelete($ctx) { return $this->seen($ctx, 'file.before.delete'); }
  public function fileAfterDelete($ctx) { return $this->seen($ctx, 'file.after.delete'); }
  public function siteBeforeCreate($ctx) { return $this->seen($ctx, 'site.before.create'); }
  public function siteAfterCreate($ctx) { return $this->seen($ctx, 'site.after.create'); }
  public function siteBeforeDuplicate($ctx) { return $this->seen($ctx, 'site.before.duplicate'); }
  public function siteAfterDuplicate($ctx) { return $this->seen($ctx, 'site.after.duplicate'); }
  public function siteBeforeArchive($ctx) { return $this->seen($ctx, 'site.before.archive'); }
  public function siteAfterArchive($ctx) { return $this->seen($ctx, 'site.after.archive'); }
  public function siteBeforeExport($ctx) { return $this->seen($ctx, 'site.before.export'); }
  public function siteAfterExport($ctx) { return $this->seen($ctx, 'site.after.export'); }
  public function userBeforeLogin($ctx) { return $this->seen($ctx, 'user.before.login'); }
  public function userAfterLogin($ctx) { return $this->seen($ctx, 'user.after.login'); }
  public function userBeforeLogout($ctx) { return $this->seen($ctx, 'user.before.logout'); }
  public function userAfterLogout($ctx) { return $this->seen($ctx, 'user.after.logout'); }
  public function gitBeforeCommit($ctx) { return $this->seen($ctx, 'git.before.commit'); }
  public function gitAfterCommit($ctx) { return $this->seen($ctx, 'git.after.commit'); }
}

<?php
// Conformance probe (mirrors src/nodejs/index.js): logs "<id>:<hook>" for every call; settings[hook] picks a behavior:
// veto | throw | hang | invalid | after-veto | set:<field>=<value>
class FxProbeAPlugin {
  private function behave($ctx, $name) {
    $ctx->log->info($ctx->plugin['id'] . ':' . $name);
    $mode = $ctx->settings[$name] ?? null;
    if (!$mode) { return null; }
    if ($mode === 'veto' || $mode === 'after-veto') { return $ctx->veto($ctx->plugin['id'] . ' says no'); }
    if ($mode === 'throw') { throw new Exception($ctx->plugin['id'] . ' broke'); }
    // PHP cannot be pre-empted: "hang" runs past the case's hookTimeout (200 ms) and returns; the engine then
    // discards the result and logs the time-out, as the Node engine does for a promise that never settles
    if ($mode === 'hang') { usleep(400000); return ['hung' => true]; }
    if ($mode === 'invalid') { return ['nothing' => true]; }
    if (strpos($mode, 'set:') === 0) { [$k, $v] = explode('=', substr($mode, 4), 2); $s = $ctx->subject; $s[$k] = $v; return $s; }
    return null;
  }
  public function entityBeforeCreate($ctx) { return $this->behave($ctx, 'entity.before.create'); }
  public function entityAfterCreate($ctx) { return $this->behave($ctx, 'entity.after.create'); }
  public function entityBeforeUpdate($ctx) { return $this->behave($ctx, 'entity.before.update'); }
  public function pageBeforeSave($ctx) { return $this->behave($ctx, 'page.before.save'); }
  public function pageAfterSave($ctx) { return $this->behave($ctx, 'page.after.save'); }
  public function themeBeforeChange($ctx) { return $this->behave($ctx, 'theme.before.change'); }
  public function userAfterLogin($ctx) { return $this->behave($ctx, 'user.after.login'); }
  public function transactionBeforeStart($ctx) { return $this->behave($ctx, 'transaction.before.start'); }
  public function transactionBeforeEnd($ctx) { return $this->behave($ctx, 'transaction.before.end'); }
  public function transactionAfterEnd($ctx) { return $this->behave($ctx, 'transaction.after.end'); }
}

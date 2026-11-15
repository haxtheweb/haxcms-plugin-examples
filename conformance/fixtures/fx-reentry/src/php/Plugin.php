<?php
// Re-entry probe (mirrors src/nodejs/index.js)
class FxReentryPlugin {
  // saves a page from its own page.after.save: without the no-re-entry rule this never ends
  public function pageAfterSave($ctx) {
    $n = $ctx->entities->get('page', 'counter') ?: ['id' => 'counter', 'title' => 'Counter', 'content' => '', 'metadata' => ['n' => 0]];
    $n['metadata'] = ['n' => ($n['metadata']['n'] ?? 0) + 1];
    $ctx->entities->save('page', $n);
    return null;
  }
}

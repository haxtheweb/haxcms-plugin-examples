<?php
// Lists only the server target: the desktop app and the browser keep it inactive (mirrors src/nodejs/index.js)
class FxServerOnlyPlugin {
  /**
   * Implements hook rebuild.after.
   *
   * Does nothing; the fixture exists for its manifest.
   *
   * @param object $ctx
   * @return void
   */
  public function rebuildAfter($ctx) { }
}

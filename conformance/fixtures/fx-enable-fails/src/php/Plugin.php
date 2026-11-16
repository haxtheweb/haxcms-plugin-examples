<?php
// Install always fails (mirrors src/nodejs/index.js)
class FxEnableFailsPlugin {
  public function pluginBeforeInstall($ctx) { throw new Exception('cannot reach the database'); }
}

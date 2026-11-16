<?php
// written for PHP only: a Node backend refuses it (load-119)
class FxOnlyPhpPlugin {
  public function pageAfterSave($ctx) { return null; }
}

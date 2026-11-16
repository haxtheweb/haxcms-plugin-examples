<?php
// Fails PHPStan (level 5): calls a function that does not exist.
class BrokenPluginPlugin {
  public function pageBeforeSave($ctx, $page) {
    return broken_plugin_no_such_function($page);
  }
}

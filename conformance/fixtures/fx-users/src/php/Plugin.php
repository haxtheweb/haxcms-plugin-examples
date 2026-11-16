<?php
// Logs the user fields it can see (mirrors src/nodejs/index.js)
class FxUsersPlugin {
  public function userAfterLogin($ctx) { $k = array_keys($ctx->user); sort($k, SORT_STRING); $ctx->log->info('fx-users saw ' . implode(',', $k)); return null; }
}

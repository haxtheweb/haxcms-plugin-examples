<?php
// Receives every log entry (the log.sink core contract) and says what it received (mirrors src/nodejs/index.js).
class FxLogSinkPlugin {
  public function logSinkWrite($ctx, $entry) {
    $ctx->log->info('fx-log-sink got [' . $entry['level'] . '] ' . $entry['plugin'] . ': ' . $entry['message']);
    return null;
  }
}

<?php
// Scheduled jobs (mirrors src/nodejs/index.js)
class FxScheduledPlugin {
  // schedule handlers are methods named in plugin.yaml schedules
  public function tick($ctx) { $n = ($ctx->storage->read('ticks') ?: 0) + 1; $ctx->storage->write('ticks', $n); return ['ticks' => $n]; }
  public function broken($ctx) { throw new Exception('job exploded'); }
}

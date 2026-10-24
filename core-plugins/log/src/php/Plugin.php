<?php
// Log (PHP). Mirrors src/nodejs/index.js.
class LogPlugin {
  const RANK = ['info' => 0, 'warn' => 1, 'error' => 2];
  private function keep($ctx) { return max(1, (int) ($ctx->settings['maxEntries'] ?? 500) ?: 500); }

  // contract log.sink, operation write
  public function logSinkWrite($ctx, $entry) {
    if ((self::RANK[$entry['level']] ?? 0) < (self::RANK[$ctx->settings['level'] ?? 'info'] ?? 0)) { return null; }
    $entries = $ctx->storage->read('entries') ?: [];
    $entries[] = ['time' => $entry['time'] ?? null, 'level' => $entry['level'], 'plugin' => $entry['plugin'] ?? 'core', 'scope' => $entry['scope'] ?? 'system', 'message' => substr((string) $entry['message'], 0, 2000)];
    $ctx->storage->write('entries', array_slice($entries, -$this->keep($ctx)));
    return null;
  }

  public function logList($ctx, $req) {
    $q = $req['query'];
    $items = array_values(array_filter($ctx->storage->read('entries') ?: [], function ($e) use ($q) { return (empty($q['plugin']) || $e['plugin'] === $q['plugin']) && (empty($q['level']) || $e['level'] === $q['level']); }));
    $items = array_slice(array_reverse($items), 0, min(500, (int) ($q['limit'] ?? 100) ?: 100));
    return ['items' => $items, 'total' => count($items)];
  }

  public function rotate($ctx) {
    $ctx->storage->write('entries', array_slice($ctx->storage->read('entries') ?: [], -$this->keep($ctx)));
    return null;
  }
}

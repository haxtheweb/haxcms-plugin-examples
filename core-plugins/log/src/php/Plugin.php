<?php
// Log (PHP). Mirrors src/nodejs/index.js.
class LogPlugin {
  const RANK = ['info' => 0, 'warn' => 1, 'error' => 2];
  private function keep($ctx) { return max(1, (int) ($ctx->settings['maxEntries'] ?? 500) ?: 500); }

  /**
   * Implements contract log.sink, operation write.
   *
   * Appends each entry core hands over to the stored history, capped at maxEntries; entries below the configured level are dropped.
   *
   * @param object $ctx    Platform context (spec/13); settings.level and settings.maxEntries.
   * @param array  $entry  [time, level, plugin, scope, message].
   * @return null
   */
  public function logSinkWrite($ctx, $entry) {
    if ((self::RANK[$entry['level']] ?? 0) < (self::RANK[$ctx->settings['level'] ?? 'info'] ?? 0)) { return null; }
    $entries = $ctx->storage->read('entries') ?: [];
    $entries[] = ['time' => $entry['time'] ?? null, 'level' => $entry['level'], 'plugin' => $entry['plugin'] ?? 'core', 'scope' => $entry['scope'] ?? 'system', 'message' => substr((string) $entry['message'], 0, 2000)];
    $ctx->storage->write('entries', array_slice($entries, -$this->keep($ctx)));
    return null;
  }

  /**
   * Implements operation logList.
   *
   * Returns the newest entries first, filtered by plugin and level, for the log page.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  query: [plugin, level, limit (default 100, at most 500)].
   * @return array  [items, total].
   */
  public function logList($ctx, $req) {
    $q = $req['query'];
    $items = array_values(array_filter($ctx->storage->read('entries') ?: [], function ($e) use ($q) { return (empty($q['plugin']) || $e['plugin'] === $q['plugin']) && (empty($q['level']) || $e['level'] === $q['level']); }));
    $items = array_slice(array_reverse($items), 0, min(500, (int) ($q['limit'] ?? 100) ?: 100));
    return ['items' => $items, 'total' => count($items)];
  }

  /**
   * Implements schedule rotate.
   *
   * Keeps only the newest maxEntries each month; writes already cap the size, and this also drops a month's backlog.
   *
   * @param object $ctx  Platform context (spec/13).
   * @return null
   */
  public function rotate($ctx) {
    $ctx->storage->write('entries', array_slice($ctx->storage->read('entries') ?: [], -$this->keep($ctx)));
    return null;
  }
}

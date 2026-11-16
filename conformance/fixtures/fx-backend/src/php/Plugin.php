<?php
// Backend integration fixture (mirrors src/nodejs/index.js)
class FxBackendPlugin {
  private static function words($html) {
    $parts = explode('<', (string) $html);
    $text = array_shift($parts);
    foreach ($parts as $part) { $end = strpos($part, '>'); $text .= ' ' . ($end === false ? '' : substr($part, $end + 1)); }
    $text = trim($text);
    return $text === '' ? 0 : count(preg_split('/\s+/', $text));
  }
  public function pageBeforeSave($ctx) {
    $p = $ctx->subject;
    $p['metadata'] = $p['metadata'] ?? [];
    $p['metadata']['plugins'] = $p['metadata']['plugins'] ?? [];
    $p['metadata']['plugins']['fx-backend'] = ['words' => self::words($p['content'] ?? '')];
    return $p;
  }
  public function rebuildAfter($ctx) {
    $titles = array_map(function ($pg) { return $pg['title']; }, $ctx->entities->list('page', ['listed' => true]));
    $ctx->files->writeManaged('fx-backend.txt', implode("\n", $titles) . "\n");
    return null;
  }
  public function fxBackendNotes($ctx, $req) {
    return array_values(array_filter($ctx->storage->read('notes') ?: [], function ($n) use ($req) { return $n['pageId'] === $req['params']['pageId']; }));
  }
  public function fxBackendNote($ctx, $req) {
    if (!$ctx->entities->get('page', $req['params']['pageId'])) { return ['status' => 404, 'body' => ['error' => 'no such page']]; }
    $list = $ctx->storage->read('notes') ?: [];
    $note = ['id' => 'n' . (count($list) + 1), 'pageId' => $req['params']['pageId'], 'authorId' => $ctx->user['id'], 'body' => (string) ($req['body']['body'] ?? '')];
    $list[] = $note;
    $ctx->storage->write('notes', $list);
    return $note;
  }
  public function insightsCheckCheck($ctx, $input) {
    $pages = $ctx->entities->list('page', ['listed' => true]);
    return ['results' => ['word.count' => ['status' => 'ok', 'checkedAt' => $ctx->now(), 'findings' => [], 'summary' => ['pages' => count($pages)]]]];
  }
}

<?php
// Outline (PHP). Mirrors src/nodejs/index.js and outline.js.
class OutlinePlugin {
  private function check($items) {
    $ids = [];
    foreach ($items as $it) {
      if (empty($it['id']) || empty($it['title'])) { return 'every item needs an id and a title'; }
      if (isset($ids[$it['id']])) { return "duplicate id {$it['id']}"; }
      $ids[$it['id']] = true;
    }
    $parent = [];
    foreach ($items as $it) { $parent[$it['id']] = $it['parent'] ?? null; }
    foreach ($items as $it) {
      if (!empty($it['parent']) && !isset($ids[$it['parent']])) { return "{$it['id']}: parent {$it['parent']} is not in the outline"; }
      $p = $it['parent'] ?? null; $steps = 0;
      while ($p) { if ($p === $it['id'] || ++$steps > count($items)) { return "{$it['id']}: parent chain loops"; } $p = $parent[$p] ?? null; }
    }
    return null;
  }
  private function slugify($t) { $s = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower((string) $t)), '-'); return $s !== '' ? $s : 'page'; }
  private function sorted($pages) { usort($pages, function ($a, $b) { return ($a['order'] ?? 0) <=> ($b['order'] ?? 0); }); return $pages; }

  public function outlineGet($ctx, $req) {
    return ['items' => array_map(function ($p) { return ['id' => $p['id'], 'title' => $p['title'], 'parent' => $p['parent'] ?? null, 'order' => $p['order'] ?? 0, 'slug' => $p['slug'] ?? null]; }, $this->sorted($ctx->entities->list('page')))];
  }

  public function outlineUpdate($ctx, $req) {
    $wanted = [];
    foreach (($req['body']['items'] ?? []) as $i => $it) { $it['order'] = $it['order'] ?? $i; $it['parent'] = $it['parent'] ?? null; $wanted[] = $it; }
    if ($problem = $this->check($wanted)) { return ['status' => 400, 'body' => ['error' => $problem]]; }
    $existing = [];
    foreach ($ctx->entities->list('page') as $p) { $existing[$p['id']] = $p; }
    $idMap = []; $n = count($existing);
    foreach ($wanted as $it) { if (!isset($existing[$it['id']])) { $idMap[$it['id']] = 'item-' . (++$n); } }
    $real = function ($id) use ($idMap) { return $id ? ($idMap[$id] ?? $id) : null; };
    $wantedIds = array_column($wanted, 'id');
    $ctx->runTransaction(function () use ($ctx, $existing, $wanted, $wantedIds, $real) {
      foreach (array_keys($existing) as $id) { if (!in_array($id, $wantedIds, true)) { $ctx->entities->delete('page', $id); } }
      foreach ($wanted as $it) {
        $before = $existing[$it['id']] ?? null;
        $record = array_merge($before ?: ['content' => ''], ['id' => $real($it['id']), 'title' => $it['title'], 'parent' => $real($it['parent']), 'order' => $it['order'], 'slug' => ($before['slug'] ?? null) ?: $this->slugify($it['title'])]);
        if (!$before || $before['title'] !== $record['title'] || ($before['parent'] ?? null) !== $record['parent'] || ($before['order'] ?? 0) !== $record['order']) { $ctx->entities->save('page', $record); }
      }
      $site = $ctx->entities->get('site');
      $site['items'] = array_map(function ($it) use ($real) { return ['id' => $real($it['id']), 'title' => $it['title'], 'parent' => $real($it['parent']), 'order' => $it['order']]; }, $wanted);
      $ctx->entities->save('site', $site);
    }, ['bulk' => true, 'origin' => 'outline']);
    $items = array_map(function ($p) { return ['id' => $p['id'], 'title' => $p['title'], 'parent' => $p['parent'] ?? null, 'order' => $p['order'] ?? 0]; }, $this->sorted($ctx->entities->list('page')));
    return ['items' => $items, 'idMap' => (object) $idMap];
  }
}

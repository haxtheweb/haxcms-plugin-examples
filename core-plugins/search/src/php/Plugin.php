<?php
// Site search index (PHP). Mirrors src/nodejs/index.js byte for byte.
class SearchPlugin {
  private function ms($v, $fallback) { if ($v === null || $v === '' || !is_numeric($v)) { return $fallback; } $n = $v + 0; return $n < 1e12 ? $n * 1000 : $n; }
  private function clean($html) { return trim(preg_replace('/[^\p{L}\p{N}]+/u', ' ', str_replace("'", '', mb_strtolower(strtr(preg_replace('/<[^>]*>/', ' ', (string) $html), ['&amp;' => '&', '&lt;' => '<', '&gt;' => '>', '&quot;' => '"', '&apos;' => "'", '&#39;' => "'", '&nbsp;' => ' ']))))); }
  private function ref($id) { return substr(preg_replace('/^item/', '', str_replace('-', '', (string) $id)), 0, 29); }

  public function rebuildAfter($ctx) {
    $pages = $ctx->entities->list('page', ['listed' => true]);
    usort($pages, function ($a, $b) { return ((int) ($a['order'] ?? 0) <=> (int) ($b['order'] ?? 0)) ?: strcmp((string) $a['id'], (string) $b['id']); });
    $index = [];
    foreach ($pages as $p) {
      $index[] = ['id' => $this->ref($p['id']), 'title' => $p['title'] ?? '', 'created' => intdiv((int) $this->ms($p['metadata']['created'] ?? null, $ctx->now()), 1000), 'location' => $p['slug'] ?? '', 'description' => $p['description'] ?? '', 'text' => $this->clean($p['content'] ?? '')];
    }
    $json = json_encode($index, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $ctx->files->writeManaged('lunrSearchIndex.json', preg_replace_callback('/^ +/m', function ($m) { return str_repeat(' ', intdiv(strlen($m[0]), 2)); }, $json) . "\n");
  }
}

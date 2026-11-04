<?php
// WordPress importer (PHP). Mirrors src/nodejs/index.js.
class ImporterWordpressPlugin {
  private function tag($xml, $name) {
    if (!preg_match('/<' . preg_quote($name, '/') . '>([\s\S]*?)<\/' . preg_quote($name, '/') . '>/', $xml, $m)) { return ''; }
    return trim(preg_replace('/^<!\[CDATA\[([\s\S]*)\]\]>$/', '$1', $m[1]));
  }
  private function strip($html) { return preg_replace('/\son\w+="[^"]*"/i', '', preg_replace('/<(script|style)[\s\S]*?<\/\1>/i', '', (string) $html)); }
  private function autop($s) {
    if (preg_match('/<(p|div|h[1-6]|ul|ol|figure|table|blockquote)\b/i', $s)) { return $s; }
    $parts = array_values(array_filter(array_map('trim', preg_split('/\n\s*\n/', $s)), 'strlen'));
    return implode('', array_map(function ($x) { return "<p>$x</p>"; }, $parts));
  }
  private function convert($xml) {
    $channel = $this->tag($xml, 'channel');
    preg_match_all('/<item>([\s\S]*?)<\/item>/', $xml, $mm);
    $posts = [];
    foreach ($mm[1] as $x) {
      $posts[] = ['id' => $this->tag($x, 'wp:post_id'), 'type' => $this->tag($x, 'wp:post_type'), 'status' => $this->tag($x, 'wp:status'), 'title' => $this->tag($x, 'title'), 'slug' => $this->tag($x, 'wp:post_name'), 'parent' => $this->tag($x, 'wp:post_parent'), 'order' => (int) $this->tag($x, 'wp:menu_order'), 'content' => $this->tag($x, 'content:encoded'), 'url' => $this->tag($x, 'wp:attachment_url')];
    }
    $keep = array_values(array_filter($posts, function ($p) { return ($p['type'] === 'page' || $p['type'] === 'post') && $p['status'] !== 'trash'; }));
    $ids = array_column($keep, 'id');
    usort($keep, function ($a, $b) {
      $t = $a['type'] === $b['type'] ? 0 : ($a['type'] === 'page' ? -1 : 1);
      return $t ?: (($a['order'] <=> $b['order']) ?: ((int) $a['id'] <=> (int) $b['id']));
    });
    $items = [];
    foreach ($keep as $i => $p) {
      $item = ['id' => 'item-' . $p['id'], 'title' => $p['title'] !== '' ? $p['title'] : 'Untitled', 'slug' => $p['slug'] !== '' ? $p['slug'] : 'item-' . $p['id'],
        'parent' => ($p['parent'] !== '' && $p['parent'] !== '0' && in_array($p['parent'], $ids, true)) ? 'item-' . $p['parent'] : null, 'order' => $i,
        'content' => $this->autop($this->strip($p['content']))];
      if ($p['status'] !== 'publish') { $item['metadata'] = ['published' => false]; }
      $items[] = $item;
    }
    $files = [];
    foreach ($posts as $p) {
      if ($p['type'] === 'attachment' && preg_match('/^https?:\/\//', $p['url'])) { $parts = explode('/', $p['url']); $files[] = ['path' => 'files/' . explode('?', end($parts))[0], 'url' => $p['url']]; }
    }
    $out = ['title' => $this->tag($channel, 'title') ?: 'Imported site', 'items' => $items];
    if ($files) { $out['files'] = $files; }
    return $out;
  }
  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Turns a WordPress export (WXR) into pages: pages first, then posts, with parents kept, drafts unpublished and trashed items skipped. Attachments are listed in files for core to fetch, never downloaded here.
   *
   * @param object $ctx    Platform context (spec/13); unused.
   * @param array  $input  [xml] (or [html] holding the same WXR text).
   * @return array  [title, items, files?] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    $xml = is_string($input['xml'] ?? null) ? $input['xml'] : (is_string($input['html'] ?? null) ? $input['html'] : null);
    if (!$xml || !preg_match('/<rss[\s>][\s\S]*xmlns:wp=/', $xml)) { return ['error' => 'a WordPress export (WXR) file is required']; }
    return $this->convert($xml);
  }
}

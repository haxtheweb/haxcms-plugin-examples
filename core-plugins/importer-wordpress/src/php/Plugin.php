<?php
// WordPress importer (PHP). Mirrors src/nodejs/index.js.
class ImporterWordpressPlugin {
  private function tag($xml, $name) {
    if (!preg_match('/<' . preg_quote($name, '/') . '>([\s\S]*?)<\/' . preg_quote($name, '/') . '>/', $xml, $m)) { return ''; }
    return trim(preg_replace('/^<!\[CDATA\[([\s\S]*)\]\]>$/', '$1', $m[1]));
  }
  // ---- HTML clean-up by scanning, not by regex replacement (twin of the helpers in src/nodejs/index.js) ----
  // the ">" closing the tag that opens at $lt (quoted attribute values may hold ">"); -1 when it never closes, -2
  // when another "<" comes first (then the first one is text)
  private static function tagEnd($s, $lt) {
    $q = '';
    $n = strlen($s);
    for ($i = $lt + 1; $i < $n; $i++) {
      $c = $s[$i];
      if ($q !== '') { if ($c === $q) { $q = ''; } } elseif ($c === '"' || $c === "'") { $q = $c; } elseif ($c === '>') { return $i; } elseif ($c === '<') { return -2; }
    }
    return -1;
  }
  // a tag's source (between < and >) without on* event handler attributes
  private static function withoutHandlers($raw) {
    if (!preg_match('/^(\/?)([A-Za-z][A-Za-z0-9-]*)/', $raw, $m)) { return $raw; }
    $out = $m[0];
    $n = strlen($raw);
    $i = strlen($m[0]);
    $space = function ($c) { return $c === ' ' || $c === "\t" || $c === "\n" || $c === "\r" || $c === "\f" || $c === "\v"; };
    while ($i < $n) {
      $j = $i;
      while ($j < $n && ($space($raw[$j]) || $raw[$j] === '/')) { $j++; }
      if ($j >= $n) { $out .= substr($raw, $i); break; }
      $k = $j;
      while ($k < $n && !$space($raw[$k]) && $raw[$k] !== '/' && $raw[$k] !== '=') { $k++; }
      $name = substr($raw, $j, $k - $j);
      $e = $k;
      $w = $k;
      while ($w < $n && $space($raw[$w])) { $w++; }
      if ($w < $n && $raw[$w] === '=') {
        $w++;
        while ($w < $n && $space($raw[$w])) { $w++; }
        $q = $w < $n ? $raw[$w] : '';
        if ($q === '"' || $q === "'") { $close = strpos($raw, $q, $w + 1); $e = $close === false ? $n : $close + 1; }
        else { $e = $w; while ($e < $n && !$space($raw[$e])) { $e++; } }
      }
      if (strtolower(substr($name, 0, 2)) !== 'on') { $out .= substr($raw, $i, $e - $i); }
      $i = $e > $i ? $e : $i + 1;
    }
    return $out;
  }
  // drops each element in $blocks with its content, each tag in $tags (opening or closing), every on* attribute,
  // and comments when $comments is true; an unterminated tag, or a block never closed, drops the rest
  private static function cleanHtml($html, array $blocks, array $tags, $comments) {
    $s = (string) ($html ?? '');
    $lower = strtolower($s);
    $n = strlen($s);
    $out = '';
    $i = 0;
    while ($i < $n) {
      $lt = strpos($s, '<', $i);
      if ($lt === false) { $out .= substr($s, $i); break; }
      $out .= substr($s, $i, $lt - $i);
      if (substr($s, $lt, 4) === '<!--') {
        $end = strpos($s, '-->', $lt + 4);
        $next = $end === false ? $n : $end + 3;
        if (!$comments) { $out .= substr($s, $lt, $next - $lt); }
        $i = $next;
        continue;
      }
      if (!preg_match('/^(\/?)([A-Za-z][A-Za-z0-9-]*)/', substr($s, $lt + 1, 64), $m)) { $out .= '&lt;'; $i = $lt + 1; continue; }
      $gt = self::tagEnd($s, $lt);
      if ($gt === -2) { $out .= '&lt;'; $i = $lt + 1; continue; }
      if ($gt < 0) { break; }
      $name = strtolower($m[2]);
      if ($m[1] === '' && in_array($name, $blocks, true)) {
        $close = strpos($lower, '</' . $name, $gt + 1);
        if ($close === false) { break; }
        $closeGt = strpos($s, '>', $close);
        $i = $closeGt === false ? $n : $closeGt + 1;
        continue;
      }
      if (in_array($name, $blocks, true) || in_array($name, $tags, true)) { $i = $gt + 1; continue; }
      $raw = substr($s, $lt + 1, $gt - $lt - 1);
      $out .= '<' . ($m[1] !== '' ? $raw : self::withoutHandlers($raw)) . '>';
      $i = $gt + 1;
    }
    return $out;
  }

  private function strip($html) { return self::cleanHtml($html, ['script', 'style'], [], false); }
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

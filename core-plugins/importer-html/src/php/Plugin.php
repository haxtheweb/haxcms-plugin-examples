<?php
// HTML importer (PHP). Mirrors src/nodejs/index.js.
class ImporterHtmlPlugin {
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
  // the text of some markup: every tag and comment dropped, $glue where each one was ("<" before anything but a
  // letter, "/", "!" or "?" is text). Repeated until nothing changes, so what is left never holds a tag.
  private static function withoutTagsOnce($s, $glue) {
    $n = strlen($s);
    $out = '';
    $i = 0;
    while ($i < $n) {
      $lt = strpos($s, '<', $i);
      if ($lt === false) { $out .= substr($s, $i); break; }
      $out .= substr($s, $i, $lt - $i);
      if (substr($s, $lt, 4) === '<!--') {
        $end = strpos($s, '-->', $lt + 4);
        $out .= $glue;
        $i = $end === false ? $n : $end + 3;
        continue;
      }
      $gt = $lt + 1 < $n && preg_match('/[A-Za-z\/!?]/', $s[$lt + 1]) ? self::tagEnd($s, $lt) : -2;
      if ($gt === -2) { $out .= '<'; $i = $lt + 1; continue; }
      if ($gt < 0) { break; }
      $out .= $glue;
      $i = $gt + 1;
    }
    return $out;
  }
  private static function withoutTags($html, $glue = '') {
    $s = (string) ($html ?? '');
    while (true) {
      $next = self::withoutTagsOnce($s, $glue);
      if ($next === $s) { return $s; }
      $s = $next;
    }
  }

  private function strip($html) { return self::cleanHtml($html, ['script', 'style'], [], false); }
  private function text($html) { return trim(preg_replace('/\s+/', ' ', self::withoutTags($html))); }
  private function slug($t) { $s = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($this->text($t))), '-'); return $s !== '' ? $s : 'page'; }

  private function convert($html) {
    $clean = $this->strip($html);
    $body = preg_match('/<body[^>]*>([\s\S]*)<\/body>/i', $clean, $m) ? $m[1] : $clean;
    if (preg_match('/<h1[^>]*>([\s\S]*?)<\/h1>/i', $body, $m) || preg_match('/<title[^>]*>([\s\S]*?)<\/title>/i', $clean, $m)) { $title = $this->text($m[1]); } else { $title = 'Imported site'; }
    $rest = preg_replace('/<h1[^>]*>[\s\S]*?<\/h1>/i', '', $body, 1);
    $parts = array_values(array_filter(array_map('trim', preg_split('/(?=<h2[^>]*>)/i', $rest)), 'strlen'));
    $items = [];
    foreach ($parts as $part) {
      if (preg_match('/^<h2[^>]*>([\s\S]*?)<\/h2>/i', $part, $h)) { $pageTitle = $this->text($h[1]); $content = trim(substr($part, strlen($h[0]))); }
      else { $pageTitle = 'Introduction'; $content = trim($part); }
      $s = $this->slug($pageTitle); $n = 2;
      while (in_array($s, array_column($items, 'slug'), true)) { $s = $this->slug($pageTitle) . '-' . ($n++); }
      $items[] = ['id' => 'item-' . (count($items) + 1), 'title' => $pageTitle, 'slug' => $s, 'parent' => null, 'order' => count($items), 'content' => $content];
    }
    return ['title' => $title, 'items' => $items];
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Splits an HTML document into pages at each h2, with the h1 (or title) as the site title and text before the first h2 as Introduction. Scripts, styles and event handlers are dropped; core sanitizes again on save.
   *
   * @param object $ctx    Platform context (spec/13); unused.
   * @param array  $input  [html].
   * @return array  [title, items] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    if (!is_array($input) || !is_string($input['html'] ?? null)) { return ['error' => 'html is required']; }
    return $this->convert($input['html']);
  }
}

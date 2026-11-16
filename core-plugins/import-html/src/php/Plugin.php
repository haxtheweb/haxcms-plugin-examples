<?php
// HTML file import (PHP). Mirrors src/nodejs/index.js.
class ImportHtmlPlugin {
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

  private function strip($h) {
    $h = self::cleanHtml($h, ['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template'], ['link', 'meta', 'base'], true);
    return preg_replace('/(href|src)\s*=\s*(["\'])\s*javascript:[^"\']*\2/i', '$1="#"', $h);
  }

  /**
   * Implements contract import.file, operation convert (dispatch: accepts .html, .htm).
   *
   * Keeps the body, drops scripts, styles, embeds, comments, inline event handlers and javascript: links, and returns
   * the rest for core to split into pages (core sanitizes again when pages are saved).
   *
   * @param object $ctx    Platform context (spec/13).
   * @param array  $input  [name, data (base64), method, type, parentId].
   * @return array  [html, title?] or [error].
   */
  public function importFileConvert($ctx, $input) {
    $text = (string) base64_decode((string) ($input['data'] ?? ''), true);
    $title = preg_match('/<title[^>]*>([\s\S]*?)<\/title>/i', $text, $t) ? trim(preg_replace('/\s+/', ' ', $t[1])) : '';
    $body = preg_match('/<body[^>]*>([\s\S]*)<\/body>/i', $text, $b) ? $b[1] : $text;
    $html = trim(preg_replace('/>\s+</', '><', $this->strip($body)));
    if ($html === '') { return ['error' => 'the file has no content']; }
    $r = ['html' => $html];
    if ($title !== '') { $r['title'] = $title; }
    return $r;
  }
}

<?php
// PDF import (PHP). Mirrors src/nodejs/index.js (same scope: single-byte fonts, content-stream order).
class ImportPdfPlugin {
  private function esc($s) { return str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $s); }
  private function utf8($s) { return mb_convert_encoding($s, 'UTF-8', 'ISO-8859-1'); }

  /** Decode a PDF literal string body: escapes and octal codes. */
  private function literal($s) {
    return preg_replace_callback('/\\\\([nrtbf()\\\\]|[0-7]{1,3}|\r?\n)/', function ($m) {
      $map = ['n' => "\n", 'r' => "\r", 't' => "\t", 'b' => "\x08", 'f' => "\f", '(' => '(', ')' => ')', '\\' => '\\'];
      if (isset($map[$m[1]])) { return $map[$m[1]]; }
      return preg_match('/^[0-7]/', $m[1]) ? chr(octdec($m[1])) : '';
    }, $s);
  }

  private function str($tok) {
    if ($tok === '') { return ''; }
    if ($tok[0] === '(') { return $this->literal(substr($tok, 1, -1)); }
    if ($tok[0] === '<') { $h = preg_replace('/\s/', '', substr($tok, 1, -1)); return implode('', array_map(function ($x) { return chr(hexdec($x)); }, str_split($h, 2))); }
    return '';
  }

  /** Text runs [text, size, y] from one content stream. */
  private function runs($stream) {
    $out = []; $size = 12; $scale = 1; $y = 0; $leading = 0; $stack = [];
    preg_match_all('/\((?:\\\\.|[^\\\\)])*\)|<[0-9A-Fa-f\s]*>|\[[^\]]*\]|\/[^\s\/\[\]()<>]+|-?\d*\.?\d+|[A-Za-z\'"*]+/', $stream, $mm);
    foreach ($mm[0] as $t) {
      if (preg_match('/^-?\d*\.?\d+$/', $t) || in_array($t[0], ['/', '(', '<', '['], true)) { $stack[] = $t; continue; }
      $num = function ($i) use ($stack) { return (float) ($stack[count($stack) - $i] ?? 0); };
      $top = $stack ? $stack[count($stack) - 1] : '';
      if ($t === 'Tf') { $size = $num(1); }
      elseif ($t === 'Tm') { $scale = abs($num(3)) ?: 1; $y = $num(1); }
      elseif ($t === 'Td' || $t === 'TD') { $y += $num(1); if ($t === 'TD') { $leading = -$num(1); } }
      elseif ($t === 'TL') { $leading = $num(1); }
      elseif ($t === 'T*') { $y -= $leading; }
      elseif ($t === 'Tj' || $t === "'" || $t === '"') { if ($t !== 'Tj') { $y -= $leading; } $out[] = ['text' => $this->str($top), 'size' => $size * $scale, 'y' => $y]; }
      elseif ($t === 'TJ') {
        preg_match_all('/\((?:\\\\.|[^\\\\)])*\)|<[0-9A-Fa-f\s]*>|-?\d*\.?\d+/', $top ?: '[]', $parts);
        $text = '';
        foreach ($parts[0] as $x) { $text .= preg_match('/^-?\d/', $x) ? ((float) $x < -200 ? ' ' : '') : $this->str($x); }
        $out[] = ['text' => $text, 'size' => $size * $scale, 'y' => $y];
      }
      elseif ($t === 'BT') { $y = 0; }
      $stack = [];
    }
    return $out;
  }

  private function pdfToHtml($bin) {
    if (strpos($bin, '%PDF-') !== 0) { return ['error' => 'not a PDF file']; }
    $lines = [];
    preg_match_all('/<<((?:(?!>>)[\s\S])*)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/', $bin, $mm, PREG_SET_ORDER);
    foreach ($mm as $m) {
      $data = $m[2];
      if (preg_match('/\/Filter\s*\/FlateDecode/', $m[1])) { $data = @gzuncompress($data); if ($data === false) { continue; } }
      elseif (preg_match('/\/Filter/', $m[1])) { continue; }
      if (!preg_match('/\bBT\b/', $data)) { continue; }
      foreach ($this->runs($data) as $r) {
        $n = count($lines);
        if ($n && $lines[$n - 1]['y'] == $r['y'] && $lines[$n - 1]['size'] == $r['size']) { $lines[$n - 1]['text'] .= $r['text']; } else { $lines[] = $r; }
      }
    }
    if (!$lines) { return ['error' => 'no readable text in this PDF (scanned pages and embedded-encoding fonts are not supported yet)']; }
    $weight = [];
    foreach ($lines as $l) { $k = (string) $l['size']; $weight[$k] = ($weight[$k] ?? 0) + strlen($l['text']); }
    $keys = array_keys($weight);
    usort($keys, function ($a, $b) use ($weight) { return ($weight[$b] <=> $weight[$a]) ?: ((float) $a <=> (float) $b); });
    $body = (float) $keys[0];
    $bigger = array_values(array_unique(array_filter(array_map(function ($l) { return $l['size']; }, $lines), function ($s) use ($body) { return $s > $body * 1.15; })));
    rsort($bigger);
    $bigger = array_slice($bigger, 0, 3);
    $html = []; $para = null; $prev = null;
    foreach ($lines as $l) {
      $text = $this->esc(trim(preg_replace('/\s+/', ' ', $this->utf8($l['text']))));
      if ($text === '') { continue; }
      $level = array_search($l['size'], $bigger);
      if ($level !== false) { if ($para !== null) { $html[] = "<p>$para</p>"; $para = null; } $html[] = '<h' . ($level + 1) . ">$text</h" . ($level + 1) . '>'; $prev = $l; continue; }
      if ($para !== null && $prev && $prev['size'] == $l['size'] && $prev['y'] - $l['y'] <= $l['size'] * 1.8) { $para .= " $text"; }
      else { if ($para !== null) { $html[] = "<p>$para</p>"; } $para = $text; }
      $prev = $l;
    }
    if ($para !== null) { $html[] = "<p>$para</p>"; }
    $r = ['html' => implode('', $html)];
    if (preg_match('/\/Title\s*\(((?:\\\\.|[^\\\\)])*)\)/', $bin, $t) && $t[1] !== '') { $r['title'] = $this->utf8($this->literal($t[1])); }
    return $r;
  }

  /**
   * Implements contract import.file, operation convert (dispatch: accepts .pdf).
   *
   * Reads the text runs of every content stream (inflating FlateDecode streams), joins them into lines, takes the most
   * common type size as body text and up to three larger sizes as h1 to h3, and returns HTML for core to split into
   * pages.
   *
   * @param object $ctx    Platform context (spec/13).
   * @param array  $input  [name, data (base64), method, type, parentId].
   * @return array  [html, title?] or [error].
   */
  public function importFileConvert($ctx, $input) {
    return $this->pdfToHtml((string) base64_decode((string) ($input['data'] ?? ''), true));
  }
}

<?php
// Import front matter (PHP). Mirrors src/nodejs/index.js; both return identical results.
// Page front matter (YAML between ---, TOML between +++, or a JSON object) and site configuration files, read as data
// for the site importers. Every scalar comes back as a string, so an importer sees the same shape whichever format a
// site was written in and whichever runtime it runs on.
class ImportFrontmatterPlugin {
  const KEY = '/^("[^"]*"|\'[^\']*\'|[^\s"\'#][^:#]*?)\s*:(?:\s+(.*))?$/';

  private static function isObject($v) { return is_array($v) && $v !== [] && !array_is_list($v); }
  private static function first($s) { return substr((string) $s, 0, 1); }

  // ---- a YAML subset: block maps, block lists, scalars, [a, b] lists, | and > text. Enough for page front matter and site configuration. ----

  private static function isItem($t) { return $t === '-' || strpos($t, '- ') === 0; }
  private static function stripComment($v) { return preg_match('/^["\']/', $v) ? $v : trim(preg_replace('/\s+#.*$/', '', $v)); }
  private static function scalar($v) {
    $v = trim($v);
    if (self::first($v) === '"') { return preg_match('/^"((?:\\\\.|[^"\\\\])*)"/', $v, $m) ? preg_replace('/\\\\(.)/', '$1', $m[1]) : substr($v, 1); }
    if (self::first($v) === "'") { return preg_match("/^'((?:''|[^'])*)'/", $v, $m) ? str_replace("''", "'", $m[1]) : substr($v, 1); }
    $v = self::stripComment($v);
    if (self::first($v) === '[' && substr($v, -1) === ']') {
      $inner = trim(substr($v, 1, -1));
      return $inner === '' ? [] : array_map([self::class, 'scalar'], explode(',', $inner));
    }
    return $v;
  }
  private static function yamlBlock(&$st, $indent) {
    $l = $st['lines'][$st['i']] ?? null;
    if (!$l || $l['indent'] < $indent) { return null; }
    return self::isItem($l['text']) ? self::yamlList($st, $l['indent']) : self::yamlMap($st, $l['indent']);
  }
  private static function yamlList(&$st, $indent) {
    $out = [];
    while ($st['i'] < count($st['lines'])) {
      $l = $st['lines'][$st['i']];
      if ($l['indent'] !== $indent || !self::isItem($l['text'])) { break; }
      $rest = ltrim(substr($l['text'], 1), ' ');
      $offset = strlen($l['text']) - strlen($rest);
      if ($rest === '') { $st['i']++; $n = $st['lines'][$st['i']] ?? null; $out[] = ($n && $n['indent'] > $indent) ? self::yamlBlock($st, $n['indent']) : null; continue; }
      if (self::isItem($rest) || preg_match(self::KEY, $rest)) { $st['lines'][$st['i']] = ['indent' => $indent + $offset, 'text' => $rest]; $out[] = self::yamlBlock($st, $indent + $offset); continue; }
      $st['i']++;
      $out[] = self::scalar($rest);
    }
    return $out;
  }
  private static function yamlMap(&$st, $indent) {
    $out = [];
    while ($st['i'] < count($st['lines'])) {
      $l = $st['lines'][$st['i']];
      if ($l['indent'] < $indent || ($l['indent'] === $indent && self::isItem($l['text']))) { break; }
      $st['i']++;
      if ($l['indent'] > $indent) { continue; }
      if (!preg_match(self::KEY, $l['text'], $m)) { continue; }
      $key = self::scalar($m[1]);
      $v = isset($m[2]) ? self::stripComment($m[2]) : '';
      if ($v === '') {
        $n = $st['lines'][$st['i']] ?? null;
        $out[$key] = ($n && ($n['indent'] > $indent || ($n['indent'] === $indent && self::isItem($n['text'])))) ? self::yamlBlock($st, $n['indent']) : null;
      } elseif (preg_match('/^[|>][-+0-9]*$/', $v)) {
        $parts = [];
        while ($st['i'] < count($st['lines']) && $st['lines'][$st['i']]['indent'] > $indent) { $parts[] = $st['lines'][$st['i']++]['text']; }
        $out[$key] = implode($v[0] === '|' ? "\n" : ' ', $parts);
      } else { $out[$key] = self::scalar($v); }
    }
    return $out;
  }
  public static function parseYaml($text) {
    $lines = [];
    foreach (explode("\n", preg_replace('/\r\n?/', "\n", (string) $text)) as $raw) {
      if (preg_match('/^\s*(#.*)?$/', $raw) || preg_match('/^(---|\.\.\.)\s*$/', $raw)) { continue; }
      $indent = strlen($raw) - strlen(ltrim($raw, ' '));
      $lines[] = ['indent' => $indent, 'text' => rtrim(substr($raw, $indent))];
    }
    if (!$lines) { return []; }
    $st = ['lines' => $lines, 'i' => 0];
    $v = self::yamlBlock($st, $lines[0]['indent']);
    return self::isObject($v) ? $v : [];
  }

  // ---- a TOML subset: tables, arrays of tables, dotted and quoted keys, strings (basic, literal, multi-line), arrays,
  // inline tables; numbers, booleans and dates are kept as the text they were written with. ----

  private static function at($s, $p) { return $p < strlen($s) ? $s[$p] : ''; }
  private static function isBare($c) { return $c !== '' && (ctype_alnum($c) || $c === '_' || $c === '-'); }
  private static function isList($v) { return is_array($v) && $v !== [] && array_is_list($v); }

  /** Past blanks, newlines and # comments. */
  private static function tomlSkip($s, $p, $newlines) {
    $n = strlen($s);
    while ($p < $n) {
      $c = $s[$p];
      if ($c === ' ' || $c === "\t" || ($newlines && ($c === "\n" || $c === "\r"))) { $p++; }
      elseif ($c === '#') { while ($p < $n && $s[$p] !== "\n") { $p++; } }
      else { break; }
    }
    return $p;
  }
  private static function tomlLineEnd($s, $p) { $n = strlen($s); while ($p < $n && $s[$p] !== "\n") { $p++; } return $p; }

  /** UTF-8 for a code point. */
  private static function utf8($code) {
    if ($code < 0x80) { return chr($code); }
    if ($code < 0x800) { return chr(0xC0 | ($code >> 6)) . chr(0x80 | ($code & 0x3F)); }
    if ($code < 0x10000) { return chr(0xE0 | ($code >> 12)) . chr(0x80 | (($code >> 6) & 0x3F)) . chr(0x80 | ($code & 0x3F)); }
    return chr(0xF0 | ($code >> 18)) . chr(0x80 | (($code >> 12) & 0x3F)) . chr(0x80 | (($code >> 6) & 0x3F)) . chr(0x80 | ($code & 0x3F));
  }

  /** A basic ("...") string's escapes. */
  private static function tomlUnescape($raw) {
    $out = '';
    $n = strlen($raw);
    for ($i = 0; $i < $n; $i++) {
      $c = $raw[$i];
      if ($c !== '\\' || $i + 1 >= $n) { $out .= $c; continue; }
      $e = $raw[++$i];
      $len = $e === 'u' ? 4 : 8;
      if ($e === 'n') { $out .= "\n"; }
      elseif ($e === 't') { $out .= "\t"; }
      elseif ($e === 'r') { $out .= "\r"; }
      elseif (($e === 'u' || $e === 'U') && preg_match('/^[0-9A-Fa-f]+$/D', substr($raw, $i + 1, $len))) {
        $hex = substr($raw, $i + 1, $len);
        $code = (int) hexdec($hex);
        $out .= ($code <= 0x10FFFF && !($code >= 0xD800 && $code <= 0xDFFF)) ? self::utf8($code) : '';
        $i += $len;
      } elseif ($e === "\n") { while ($i + 1 < $n && ctype_space($raw[$i + 1])) { $i++; } }   // a line-ending backslash joins lines
      else { $out .= $e; }
    }
    return $out;
  }

  /** One value starting at $p: [value, p] with p just past it, or null when nothing readable is there. */
  private static function tomlValue($s, $p) {
    $p = self::tomlSkip($s, $p, false);
    $n = strlen($s);
    if ($p >= $n) { return null; }
    $c = $s[$p];
    $three = substr($s, $p, 3);
    if ($three === '"""' || $three === "'''") {
      $end = strpos($s, $three, $p + 3);
      if ($end === false) { return null; }
      $raw = substr($s, $p + 3, $end - $p - 3);
      if (strncmp($raw, "\n", 1) === 0) { $raw = substr($raw, 1); }
      return [$c === '"' ? self::tomlUnescape($raw) : $raw, $end + 3];
    }
    if ($c === '"') {
      $e = $p + 1;
      while ($e < $n && $s[$e] !== '"' && $s[$e] !== "\n") { $e += $s[$e] === '\\' ? 2 : 1; }
      if ($e >= $n || $s[$e] !== '"') { return null; }
      return [self::tomlUnescape(substr($s, $p + 1, $e - $p - 1)), $e + 1];
    }
    if ($c === "'") {
      $e = strpos($s, "'", $p + 1);
      if ($e === false || strpos(substr($s, $p + 1, $e - $p - 1), "\n") !== false) { return null; }
      return [substr($s, $p + 1, $e - $p - 1), $e + 1];
    }
    if ($c === '[') {
      $out = [];
      $p++;
      for (;;) {
        $p = self::tomlSkip($s, $p, true);
        if ($p >= $n) { return null; }
        if ($s[$p] === ']') { return [$out, $p + 1]; }
        $v = self::tomlValue($s, $p);
        if ($v === null) { return null; }
        $out[] = $v[0];
        $p = self::tomlSkip($s, $v[1], true);
        if (self::at($s, $p) === ',') { $p++; }
        elseif (self::at($s, $p) !== ']') { return null; }
      }
    }
    if ($c === '{') {
      $out = [];
      $p++;
      for (;;) {
        $p = self::tomlSkip($s, $p, true);
        if ($p >= $n) { return null; }
        if ($s[$p] === '}') { return [$out, $p + 1]; }
        $k = self::tomlKey($s, $p);
        if ($k === null) { return null; }
        $p = self::tomlSkip($s, $k[1], false);
        if (self::at($s, $p) !== '=') { return null; }
        $v = self::tomlValue($s, $p + 1);
        if ($v === null) { return null; }
        self::tomlSet($out, $k[0], $v[0]);
        $p = self::tomlSkip($s, $v[1], true);
        if (self::at($s, $p) === ',') { $p++; }
        elseif (self::at($s, $p) !== '}') { return null; }
      }
    }
    // a number, boolean or date: kept as written
    $e = $p;
    while ($e < $n && strpos(",]}#\n\r", $s[$e]) === false) { $e++; }
    $raw = trim(substr($s, $p, $e - $p));
    return $raw === '' ? null : [$raw, $e];
  }

  /** A key, possibly dotted (a.b."c d"): [parts, p], or null. */
  private static function tomlKey($s, $p) {
    $parts = [];
    $n = strlen($s);
    for (;;) {
      $p = self::tomlSkip($s, $p, false);
      $c = self::at($s, $p);
      if ($c === '"' || $c === "'") {
        $v = self::tomlValue($s, $p);
        if ($v === null || !is_string($v[0])) { return null; }
        $parts[] = $v[0];
        $p = $v[1];
      } else {
        $e = $p;
        while ($e < $n && self::isBare($s[$e])) { $e++; }
        if ($e === $p) { return null; }
        $parts[] = substr($s, $p, $e - $p);
        $p = $e;
      }
      $p = self::tomlSkip($s, $p, false);
      if (self::at($s, $p) !== '.') { return [$parts, $p]; }
      $p++;
    }
  }

  /** The table a path leads to, made on the way; the last table of an array of tables stands for it. Null when the path is refused. */
  private static function &tomlWalk(array &$root, array $parts) {
    $none = null;
    $cur = &$root;
    foreach ($parts as $k) {
      if ($k === '__proto__') { return $none; }
      if (!array_key_exists($k, $cur) || !is_array($cur[$k])) { $cur[$k] = []; }
      $cur = &$cur[$k];
      if (self::isList($cur)) {
        $last = count($cur) - 1;
        if (!is_array($cur[$last]) || self::isList($cur[$last])) { $cur[] = []; $last++; }
        $cur = &$cur[$last];
      }
    }
    return $cur;
  }
  private static function tomlSet(array &$table, array $parts, $value) {
    $last = array_pop($parts);
    $at = &self::tomlWalk($table, $parts);
    if ($at !== null && $last !== '__proto__') { $at[$last] = $value; }
  }

  public static function parseToml($text) {
    $s = preg_replace('/\r\n?/', "\n", (string) $text);
    $root = [];
    $table = [];   // the path of the table that keys are being set in
    $p = 0;
    $n = strlen($s);
    while ($p < $n) {
      $p = self::tomlSkip($s, $p, true);
      if ($p >= $n) { break; }
      if ($s[$p] === '[') {
        $list = self::at($s, $p + 1) === '[';
        $k = self::tomlKey($s, $p + ($list ? 2 : 1));
        $close = $k === null ? -1 : self::tomlSkip($s, $k[1], false);
        if ($k === null || substr($s, $close, $list ? 2 : 1) !== ($list ? ']]' : ']')) { $p = self::tomlLineEnd($s, $p); continue; }
        if (!in_array('__proto__', $k[0], true)) {
          if ($list) {
            $name = $k[0][count($k[0]) - 1];
            $parent = &self::tomlWalk($root, array_slice($k[0], 0, -1));
            if (!array_key_exists($name, $parent) || !is_array($parent[$name]) || !($parent[$name] === [] || self::isList($parent[$name]))) { $parent[$name] = []; }
            $parent[$name][] = [];
            unset($parent);
          } else {
            self::tomlWalk($root, $k[0]);
          }
          $table = $k[0];
        }
        $p = self::tomlLineEnd($s, $close);
        continue;
      }
      $k = self::tomlKey($s, $p);
      $eq = $k === null ? -1 : self::tomlSkip($s, $k[1], false);
      $v = ($k !== null && self::at($s, $eq) === '=') ? self::tomlValue($s, $eq + 1) : null;
      if ($v === null) { $p = self::tomlLineEnd($s, $p); continue; }
      self::tomlSet($root, array_merge($table, $k[0]), $v[0]);
      $p = self::tomlLineEnd($s, $v[1]);
    }
    return $root;
  }

  // ---- JSON, with every scalar as a string like the other two ----

  private static function stringify($v) {
    if (is_array($v)) { $out = []; foreach ($v as $x) { $out[] = self::stringify($x); } return $out; }
    if (is_object($v)) { $out = []; foreach (get_object_vars($v) as $k => $x) { if ($k !== '__proto__') { $out[(string) $k] = self::stringify($x); } } return $out; }
    if ($v === null) { return null; }
    if (is_bool($v)) { return $v ? 'true' : 'false'; }
    if (is_float($v)) { return ($v == floor($v) && abs($v) < 1e15) ? (string) (int) $v : (string) json_encode($v); }
    return (string) $v;
  }
  public static function parseJson($text) {
    $v = json_decode((string) $text);
    return is_object($v) ? self::stringify($v) : null;
  }

  /** Where the JSON object that opens the text ends (just past its closing brace), or -1. */
  private static function jsonEnd($s) {
    $depth = 0; $inString = false; $n = strlen($s);
    for ($i = 0; $i < $n; $i++) {
      $c = $s[$i];
      if ($inString) { if ($c === '\\') { $i++; } elseif ($c === '"') { $inString = false; } continue; }
      if ($c === '"') { $inString = true; }
      elseif ($c === '{') { $depth++; }
      elseif ($c === '}') { $depth--; if ($depth === 0) { return $i + 1; } }
    }
    return -1;
  }

  // ---- pages ----

  /** A page as [format, data, body]: front matter between --- (YAML) or +++ (TOML) lines, or a leading JSON object. */
  public static function split($text) {
    $s = preg_replace('/\r\n?/', "\n", is_string($text) ? $text : '');
    if (strncmp($s, "\xEF\xBB\xBF", 3) === 0) { $s = substr($s, 3); }   // without a byte order mark
    foreach ([['---', 'yaml'], ['+++', 'toml']] as $pair) {
      $mark = $pair[0]; $format = $pair[1];
      if (strncmp($s, $mark, 3) !== 0) { continue; }
      $open = strpos($s, "\n");
      if ($open === false || trim(substr($s, 3, $open - 3)) !== '') { continue; }
      // the closing line is the next line that is only the marker
      $at = $open;
      while ($at !== false) {
        $lineEnd = strpos($s, "\n", $at + 1);
        $line = $lineEnd === false ? substr($s, $at + 1) : substr($s, $at + 1, $lineEnd - $at - 1);
        if (trim($line) === $mark && strncmp($line, $mark, 3) === 0) {
          $inner = substr($s, $open + 1, $at - $open);
          return ['format' => $format, 'data' => $format === 'yaml' ? self::parseYaml($inner) : self::parseToml($inner), 'body' => $lineEnd === false ? '' : substr($s, $lineEnd + 1)];
        }
        $at = $lineEnd;
      }
    }
    if (strncmp($s, '{', 1) === 0) {
      $end = self::jsonEnd($s);
      $data = $end === -1 ? null : self::parseJson(substr($s, 0, $end));
      if ($data !== null) { return ['format' => 'json', 'data' => $data, 'body' => preg_replace('/^[ \t]*\n/', '', substr($s, $end))]; }
    }
    return ['format' => 'none', 'data' => [], 'body' => $s];
  }

  /**
   * Implements contract import-frontmatter.data, operation split.
   *
   * Splits a page into its front matter, as data, and the body after it. The front matter is YAML between ---
   * lines, TOML between +++ lines, or a JSON object at the top; a page with none comes back whole as the body.
   *
   * @param object $ctx    Platform context (spec/13); nothing is fetched, read or stored.
   * @param array  $input  [text] for one page, or [texts => [..]] for many in one call.
   * @return array  [format, data, body], or [results => [[format, data, body], ..]] for texts.
   */
  public function importFrontmatterDataSplit($ctx, $input) {
    $input = $input ?: [];
    if (isset($input['texts']) && is_array($input['texts'])) {
      $results = [];
      foreach ($input['texts'] as $t) { $results[] = self::split(is_string($t) ? $t : ''); }
      return ['results' => $results];
    }
    return self::split(is_string($input['text'] ?? null) ? $input['text'] : '');
  }

  /**
   * Implements contract import-frontmatter.data, operation parse.
   *
   * Reads a whole configuration text (a site's hugo.toml, _config.yml, config.json) as data.
   *
   * @param object $ctx    Platform context (spec/13); nothing is fetched, read or stored.
   * @param array  $input  [format: yaml | toml | json, text].
   * @return array  [data] or [error].
   */
  public function importFrontmatterDataParse($ctx, $input) {
    $input = $input ?: [];
    $text = is_string($input['text'] ?? null) ? $input['text'] : '';
    $format = $input['format'] ?? null;
    if ($format === 'yaml') { return ['data' => self::parseYaml($text)]; }
    if ($format === 'toml') { return ['data' => self::parseToml($text)]; }
    if ($format === 'json') { $data = self::parseJson($text); return $data === null ? ['error' => 'the text is not a JSON object'] : ['data' => $data]; }
    return ['error' => 'format must be yaml, toml or json'];
  }
}

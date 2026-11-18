<?php
// Astro importer (PHP). Mirrors src/nodejs/index.js; both return identical results.
// Reads an Astro site as data. A Starlight site: its docs collection, in the order of the sidebar in astro.config.*
// (read as data and never executed) or of its folders. Any other Astro site: its markdown pages, its content
// collections, and the static markup of its .astro pages. Nothing of Astro runs: no components, no expressions, no
// integrations. The repository or zip is listed and read through import-source.tree, front matter through
// import-frontmatter.data, markdown through import.file.
class ImporterAstroPlugin {
  const MAX_PAGES = 500;
  const IMPORTABLE = '/\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|xml|svg)$/iD';
  const IMAGE = '/\.(jpg|jpeg|png|gif|webp|svg)$/iD';
  const CONFIG_FILE = '~^((?:[^/]+/)*)astro\.config\.(mjs|js|ts|mts|cjs)$~D';
  const DOC_EXT = '/\.(md|mdx|markdown)$/D';
  const PAGE_EXT = '/\.(md|mdx|markdown|astro|html)$/D';
  // Starlight's asides, onto the stop-note statuses HAX offers
  const NOTES = ['note' => ['info', 'Note'], 'tip' => ['success', 'Tip'], 'caution' => ['warning', 'Caution'], 'danger' => ['stop', 'Danger']];
  // what is read as text out of a zip: pages, configuration
  const SOURCE_TEXT = '(\.(md|mdx|markdown|astro|html)|astro\.config\.(mjs|js|ts|mts|cjs))$';

  // ---- small helpers (each has a twin in index.js) ----

  public static function cleanTitle($value) {
    $t = strtolower(str_replace(' ', '-', trim((string) $value)));
    $t = preg_replace('/--+/', '-', preg_replace('/[^\w\-\/]+/', '-', $t));
    return $t === '' ? 'blank' : $t;
  }
  private static function titleSlug($title) {
    $c = self::cleanTitle($title);
    $t = preg_replace('/^-+|-+$/', '', $c);
    return $t === '' ? $c : $t;
  }
  private static function ucfirst($s) { return preg_match('/^[a-z]/', $s) ? strtoupper($s[0]) . substr($s, 1) : $s; }
  private static function escAttr($v) { return str_replace(['&', '<', '>', '"'], ['&amp;', '&lt;', '&gt;', '&quot;'], (string) $v); }
  private static function isObject($v) { return is_array($v) && $v !== [] && !array_is_list($v); }
  private static function stringOf($v) { return is_string($v) ? trim($v) : ''; }
  private static function isExternal($ref) { return (bool) preg_match('/^([a-z][a-z0-9+.-]*:|\/\/)/i', (string) $ref); }
  // byte order, never PHP's numeric comparison of digit-only names
  private static function byText($a, $b) { $c = strcmp((string) $a, (string) $b); return $c < 0 ? -1 : ($c > 0 ? 1 : 0); }
  private static function encComponent($s) { return strtr(rawurlencode($s), ['%21' => '!', '%2A' => '*', '%27' => "'", '%28' => '(', '%29' => ')']); }
  private static function encPath($p) { return implode('/', array_map([self::class, 'encComponent'], explode('/', $p))); }

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

  private static function strip($html) {
    return self::cleanHtml($html, ['script'], [], false);
  }

  private static function normalizePath($path) {
    $parts = [];
    foreach (explode('/', $path) as $piece) {
      if ($piece === '' || $piece === '.') { continue; }
      if ($piece === '..') { array_pop($parts); } else { $parts[] = $piece; }
    }
    return implode('/', $parts);
  }


  // ---- the config, read as data and never executed (port of core's literal reader) ----

  private static function insideStringOrComment($src, $offset) {
    $i = 0; $quote = ''; $comment = ''; $len = strlen($src);
    while ($i < $offset && $i < $len) {
      $c = $src[$i]; $n = $src[$i + 1] ?? '';
      if ($comment === 'line') { if ($c === "\n") { $comment = ''; } }
      elseif ($comment === 'block') { if ($c === '*' && $n === '/') { $comment = ''; $i++; } }
      elseif ($quote !== '') { if ($c === '\\') { $i++; } elseif ($c === $quote) { $quote = ''; } }
      elseif ($c === '/' && $n === '/') { $comment = 'line'; $i++; }
      elseif ($c === '/' && $n === '*') { $comment = 'block'; $i++; }
      elseif ($c === '"' || $c === "'" || $c === '`') { $quote = $c; }
      $i++;
    }
    return $quote !== '' || $comment !== '';
  }

  private static function keyPosition($src, $key) {
    preg_match_all('/(^|[^A-Za-z0-9_$.\'"`])' . preg_quote($key, '/') . '\s*:/', $src, $all, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
    foreach ($all as $m) {
      $at = $m[0][1] + strlen($m[1][0]);
      if (!self::insideStringOrComment($src, $at)) { return strpos($src, ':', $at) + 1; }
    }
    return -1;
  }

  private static function literalValue($src, $key) {
    $start = self::keyPosition($src, $key);
    if ($start === -1) { return null; }
    $len = strlen($src); $i = $start;
    while ($i < $len && self::isSpace($src[$i])) { $i++; }
    $open = $src[$i] ?? '';
    if ($open !== '[' && $open !== '{') { return null; }
    $close = $open === '[' ? ']' : '}';
    $depth = 0; $quote = '';
    for ($k = $i; $k < $len; $k++) {
      $c = $src[$k];
      if ($quote !== '') { if ($c === '\\') { $k++; } elseif ($c === $quote) { $quote = ''; } }
      elseif ($c === '"' || $c === "'" || $c === '`') { $quote = $c; }
      elseif ($c === $open) { $depth++; }
      elseif ($c === $close) { $depth--; if ($depth === 0) { return substr($src, $i, $k - $i + 1); } }
    }
    return null;
  }

  private static function stringValue($src, $key) {
    $start = self::keyPosition($src, $key);
    if ($start === -1) { return null; }
    if (!preg_match('/^\s*([\'"`])((?:\\\\.|(?!\1)[^\\\\])*)\1/', substr($src, $start), $m)) { return null; }
    return preg_replace('/\\\\([\'"`\\\\])/', '$1', $m[2]);
  }

  /** A JavaScript data literal; objects come back as stdClass so they stay distinct from arrays. Anything else throws. */
  public static function parseJsLiteral($text) {
    $st = ['t' => (string) $text, 'i' => 0];
    $v = self::jsValue($st);
    self::jsSkip($st);
    if ($st['i'] !== strlen($st['t'])) { throw new Exception('unexpected content after the literal'); }
    return $v;
  }
  private static function jsSkip(&$st) {
    $len = strlen($st['t']);
    while ($st['i'] < $len) {
      $c = $st['t'][$st['i']]; $n = $st['t'][$st['i'] + 1] ?? '';
      if (self::isSpace($c)) { $st['i']++; }
      elseif ($c === '/' && $n === '/') { while ($st['i'] < $len && $st['t'][$st['i']] !== "\n") { $st['i']++; } }
      elseif ($c === '/' && $n === '*') { $st['i'] += 2; while ($st['i'] < $len && !($st['t'][$st['i']] === '*' && ($st['t'][$st['i'] + 1] ?? '') === '/')) { $st['i']++; } $st['i'] += 2; }
      else { return; }
    }
  }
  private static function jsString(&$st) {
    $len = strlen($st['t']);
    $q = $st['t'][$st['i']++];
    $v = '';
    while ($st['i'] < $len) {
      $c = $st['t'][$st['i']];
      if ($c === '\\') { $e = $st['t'][$st['i'] + 1] ?? ''; $v .= $e === 'n' ? "\n" : ($e === 't' ? "\t" : $e); $st['i'] += 2; continue; }
      if ($c === $q) { $st['i']++; return $v; }
      if ($q === '`' && $c === '$' && ($st['t'][$st['i'] + 1] ?? '') === '{') { throw new Exception('template expressions are not plain data'); }
      $v .= $c;
      $st['i']++;
    }
    throw new Exception('unterminated string');
  }
  private static function jsValue(&$st) {
    self::jsSkip($st);
    $c = $st['t'][$st['i']] ?? '';
    if ($c === '[') {
      $out = [];
      $st['i']++;
      for (;;) {
        self::jsSkip($st);
        if (($st['t'][$st['i']] ?? '') === ']') { $st['i']++; return $out; }
        $out[] = self::jsValue($st);
        self::jsSkip($st);
        $d = $st['t'][$st['i']] ?? '';
        if ($d === ',') { $st['i']++; } elseif ($d !== ']') { throw new Exception("expected , or ] at {$st['i']}"); }
      }
    }
    if ($c === '{') {
      $out = new stdClass();
      $st['i']++;
      for (;;) {
        self::jsSkip($st);
        $d = $st['t'][$st['i']] ?? '';
        if ($d === '}') { $st['i']++; return $out; }
        if ($d === '"' || $d === "'" || $d === '`') { $key = self::jsString($st); }
        else {
          if (!preg_match('/^[A-Za-z_$][A-Za-z0-9_$]*/', substr($st['t'], $st['i']), $id)) { throw new Exception("expected a key at {$st['i']}"); }
          $key = $id[0];
          $st['i'] += strlen($key);
        }
        self::jsSkip($st);
        if (($st['t'][$st['i']] ?? '') !== ':') { throw new Exception("expected : after $key"); }
        $st['i']++;
        $out->$key = self::jsValue($st);
        self::jsSkip($st);
        $d = $st['t'][$st['i']] ?? '';
        if ($d === ',') { $st['i']++; } elseif ($d !== '}') { throw new Exception("expected , or } at {$st['i']}"); }
      }
    }
    if ($c === '"' || $c === "'" || $c === '`') { return self::jsString($st); }
    $rest = substr($st['t'], $st['i']);
    if (preg_match('/^(true|false|null)\b/', $rest, $kw)) { $st['i'] += strlen($kw[1]); return $kw[1] === 'true' ? true : ($kw[1] === 'false' ? false : null); }
    if (preg_match('/^-?\d+(\.\d+)?([eE][+-]?\d+)?/', $rest, $num)) { $st['i'] += strlen($num[0]); return preg_match('/^-?\d+$/D', $num[0]) ? (int) $num[0] : (float) $num[0]; }
    throw new Exception("unsupported value at {$st['i']}");
  }


  // ---- Astro helpers ----

  private static function isSpace($c) { return $c === ' ' || $c === "\t" || $c === "\n" || $c === "\r" || $c === "\v" || $c === "\f"; }
  private static function isTrue($v) { return strtolower(trim(is_scalar($v) ? (string) $v : '')) === 'true'; }
  private static function mapOf($v) { return self::isObject($v) ? $v : []; }
  private static function withoutQuery($ref) { return explode('?', explode('#', $ref)[0])[0]; }
  private static function dirOf($path) { $cut = strrpos($path, '/'); return $cut === false ? '' : substr($path, 0, $cut); }
  private static function baseOf($path) { $cut = strrpos($path, '/'); return $cut === false ? $path : substr($path, $cut + 1); }
  private static function stem($name) { return preg_replace(self::PAGE_EXT, '', $name); }
  private static function escHtml($v) { return str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], (string) $v); }
  private static function titleFromName($name) {
    $t = trim(preg_replace('/[-_]+/', ' ', $name));
    return $t === '' ? $name : self::ucfirst($t);
  }
  /** A number written in front matter (order: 2, 2.5, -1), or null. */
  private static function numberOf($v) {
    $s = trim(is_scalar($v) ? (string) $v : '');
    return preg_match('/^-?\d{1,9}(\.\d{1,9})?$/D', $s) ? (float) $s : null;
  }
  /** Astro's slug for a path: lower case, spaces and anything unsafe as dashes, index dropped. */
  public static function slugOf($path) {
    $segs = [];
    foreach (explode('/', $path) as $s) { $t = preg_replace('/[^a-z0-9._~-]+/', '-', strtolower($s)); if ($t !== '') { $segs[] = $t; } }
    if ($segs && $segs[count($segs) - 1] === 'index') { array_pop($segs); }
    return implode('/', $segs);
  }
  /** How links name a page: no slashes at the ends, lower case, no extension, no index file. */
  public static function normKey($path) {
    $k = preg_replace('/\.(md|mdx|markdown|astro|html)$/D', '', strtolower(trim($path, '/')));
    if ($k === 'index') { return ''; }
    if (substr($k, -6) === '/index') { $k = substr($k, 0, -6); }
    return trim($k, '/');
  }

  /**
   * Seconds since 1970 for a front matter date: 2026-03-09, 2026-03-09T14:30:00Z, 2026-03-09 14:30:00+02:00.
   * A date with no offset is read as UTC. null when the text does not start with a date.
   */
  public static function parseDate($text) {
    if (!preg_match('/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?[ ]?(Z|[+-]\d{2}:?\d{2})?)?/', trim(is_scalar($text) ? (string) $text : ''), $m, PREG_UNMATCHED_AS_NULL)) { return null; }
    $mo = (int) $m[2];
    $d = (int) $m[3];
    $h = ($m[4] ?? null) === null ? 0 : (int) $m[4];
    $mi = ($m[5] ?? null) === null ? 0 : (int) $m[5];
    $sec = ($m[6] ?? null) === null ? 0 : (int) $m[6];
    if ($mo < 1 || $mo > 12 || $d < 1 || $d > 31 || $h > 23 || $mi > 59 || $sec > 59) { return null; }
    $t = gmmktime($h, $mi, $sec, $mo, $d, (int) $m[1]);
    $zone = $m[7] ?? null;
    if ($zone !== null && $zone !== 'Z') {
      $digits = str_replace(':', '', substr($zone, 1));
      $t -= ($zone[0] === '-' ? -1 : 1) * ((int) substr($digits, 0, 2) * 3600 + (int) substr($digits, 2, 2) * 60);
    }
    return $t;
  }

  // ---- reading the site: a GitHub repository or an uploaded zip of one, both through import-source ----

  /** The site's files through import-source: [name, repo, branch, list, paths (set), readMany, rawUrl]. */
  private function openSource($ctx, $input) {
    $upload = (!empty($input['files']) && is_array($input['files'])) ? ['files' => $input['files']] : null;
    $listed = $ctx->contracts->call('import-source.tree', 'list', $upload ?: ['url' => $input['url']]);
    if (!is_array($listed) || isset($listed['error']) || !isset($listed['paths']) || !is_array($listed['paths'])) {
      return ['error' => (is_array($listed) && isset($listed['error'])) ? $listed['error'] : "the site's files could not be listed"];
    }
    $list = array_map('strval', array_values($listed['paths']));
    $paths = [];
    foreach ($list as $p) { $paths[$p] = true; }
    $from = $upload ? $upload + ['prefix' => $listed['prefix'] ?? ''] : ['repo' => $listed['repo'] ?? null, 'branch' => $listed['branch'] ?? null];
    $readMany = function ($wanted, $binary) use ($ctx, $from, $upload) {
      $out = [];
      if (!$wanted) { return $out; }
      $ask = $from + ['paths' => array_values($wanted)];
      if ($upload && $binary) { $ask['binary'] = true; }
      if ($upload && !$binary) { $ask['match'] = self::SOURCE_TEXT; }
      $got = $ctx->contracts->call('import-source.tree', 'read', $ask);
      foreach ((is_array($got) && isset($got['files']) && is_array($got['files'])) ? $got['files'] : [] as $f) { $out[(string) $f['path']] = $f['data'] ?? null; }
      return $out;
    };
    $rawBase = $listed['rawBase'] ?? null;
    $rawUrl = $rawBase ? function ($p) use ($rawBase) { return $rawBase . '/' . self::encPath($p); } : null;
    return ['name' => (string) ($listed['name'] ?? 'site'), 'repo' => $listed['repo'] ?? null, 'branch' => $listed['branch'] ?? null, 'list' => $list, 'paths' => $paths, 'readMany' => $readMany, 'rawUrl' => $rawUrl];
  }

  /** The Astro site in the files: the shallowest folder holding astro.config.*. [dir, config] or null. */
  public static function findSite($list) {
    $best = null;
    foreach ($list as $p) {
      if (!preg_match(self::CONFIG_FILE, $p, $m)) { continue; }
      $depth = $m[1] === '' ? 0 : count(explode('/', $m[1])) - 1;
      $order = $best === null ? -1 : ($depth !== $best['depth'] ? $depth - $best['depth'] : self::byText($p, $best['config']));
      if ($order < 0) { $best = ['dir' => $m[1], 'config' => $p, 'depth' => $depth]; }
    }
    return $best === null ? null : ['dir' => $best['dir'], 'config' => $best['config']];
  }

  /** What the importer needs from astro.config.*: Starlight's title, sidebar and locales, and the site's base. */
  private static function readConfig($text) {
    $out = [
      'starlight' => (bool) preg_match('/@astrojs\/starlight|\bstarlight\s*\(/', $text), 'title' => self::stringValue($text, 'title'),
      'base' => trim((string) self::stringValue($text, 'base'), '/'), 'site' => strtolower(rtrim((string) self::stringValue($text, 'site'), '/')),
      'sidebar' => null, 'sidebarUnread' => false, 'locales' => null, 'defaultLocale' => self::stringValue($text, 'defaultLocale'),
    ];
    $sidebar = self::literalValue($text, 'sidebar');
    if ($sidebar !== null) {
      try { $v = self::parseJsLiteral($sidebar); if (is_array($v)) { $out['sidebar'] = $v; } else { $out['sidebarUnread'] = true; } } catch (Exception $e) { $out['sidebarUnread'] = true; }
    } elseif (self::keyPosition($text, 'sidebar') !== -1) { $out['sidebarUnread'] = true; }
    $locales = self::literalValue($text, 'locales');
    if ($locales !== null) {
      try { $v = self::parseJsLiteral($locales); if (is_object($v)) { $out['locales'] = array_map('strval', array_keys(get_object_vars($v))); } } catch (Exception $e) { $out['locales'] = null; }
    }
    return $out;
  }

  // ---- page bodies ----

  private static function bump(&$st, $key) { $st['unmapped'][$key] = ($st['unmapped'][$key] ?? 0) + 1; }

  /** Where a tag that starts at $lt ends (just past its >), skipping quoted values and {expressions}; -1 when it does not. */
  private static function jsxTagEnd($s, $lt) {
    $depth = 0; $quote = '';
    $n = strlen($s);
    for ($i = $lt + 1; $i < $n; $i++) {
      $c = $s[$i];
      if ($quote !== '') { if ($c === $quote) { $quote = ''; } continue; }
      if ($depth > 0) {
        if ($c === '{') { $depth++; } elseif ($c === '}') { $depth--; } elseif ($c === '"' || $c === "'" || $c === "\x60") { $quote = $c; }
        continue;
      }
      if ($c === '"' || $c === "'") { $quote = $c; }
      elseif ($c === '{') { $depth++; }
      elseif ($c === '>') { return $i + 1; }
    }
    return -1;
  }
  /** Where a {expression} that starts at $open ends (just past its }), or -1. */
  private static function braceEnd($s, $open) {
    $depth = 0; $quote = '';
    $n = strlen($s);
    for ($i = $open; $i < $n; $i++) {
      $c = $s[$i];
      if ($quote !== '') { if ($c === '\\') { $i++; } elseif ($c === $quote) { $quote = ''; } continue; }
      if ($c === '"' || $c === "'" || $c === "\x60") { $quote = $c; }
      elseif ($c === '{') { $depth++; }
      elseif ($c === '}') { $depth--; if ($depth === 0) { return $i + 1; } }
    }
    return -1;
  }
  /** A component tag's plain attributes (name="value"); {expressions} become [expr => "..."]. */
  private static function jsxAttrs($tag) {
    $out = [];
    preg_match_all('/([A-Za-z_][A-Za-z0-9_:-]*)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|\{([^{}]*)\})/', $tag, $all, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);
    foreach ($all as $m) {
      if (($m[2] ?? null) !== null) { $out[$m[1]] = $m[2]; }
      elseif (($m[3] ?? null) !== null) { $out[$m[1]] = $m[3]; }
      else { $out[$m[1]] = ['expr' => trim((string) $m[4])]; }
    }
    return $out;
  }

  /**
   * MDX and .astro markup, read by scanning (nothing runs): components (capitalised tags) are removed around their
   * content, except Aside (a stop-note), LinkCard (a link), Image and Picture (an img, when the source is a file the
   * page imports or names); {expressions} and {/* comments *\/} go. Removed components and expressions are counted.
   * Returns parts: [md] text to convert, and [html] wrappers that go around it as they are.
   */
  private static function jsx($text, $doc, &$st, $images) {
    $parts = [];
    $out = '';
    $html = function ($h) use (&$parts, &$out) { $parts[] = ['md' => $out]; $parts[] = ['html' => $h]; $out = ''; };
    $i = 0;
    $n = strlen($text);
    while ($i < $n) {
      $lt = strpos($text, '<', $i);
      $br = strpos($text, '{', $i);
      $s = $lt === false ? $br : ($br === false ? $lt : min($lt, $br));
      if ($s === false) { $out .= substr($text, $i); break; }
      $out .= substr($text, $i, $s - $i);
      if ($s === $br) {
        $e = self::braceEnd($text, $s);
        if ($e === -1) { $out .= substr($text, $s); break; }
        if (!preg_match('/^\{\s*\/\*[\s\S]*\*\/\s*\}$/D', substr($text, $s, $e - $s))) { self::bump($st, 'expression'); }
        $i = $e;
        continue;
      }
      if (!preg_match('/^<(\/?)([A-Z][A-Za-z0-9_.]*)/', substr($text, $s, 80), $m)) {
        // an HTML tag stays; attributes whose value is an {expression}, and {...spread}, go
        $he = preg_match('/^<[a-z][a-z0-9-]*/', substr($text, $s, 40)) ? self::jsxTagEnd($text, $s) : -1;
        if ($he === -1) { $out .= '<'; $i = $s + 1; continue; }
        $tag = substr($text, $s, $he - $s);
        $kept = preg_replace('/\s*\{[^{}]*\}/', '', preg_replace('/\s+[A-Za-z_:][-A-Za-z0-9_:.]*\s*=\s*\{[^{}]*\}/', '', $tag));
        if ($kept !== $tag) { self::bump($st, 'expression'); }
        $out .= $kept;
        $i = $he;
        continue;
      }
      $e = self::jsxTagEnd($text, $s);
      if ($e === -1) { $out .= substr($text, $s); break; }
      $tag = substr($text, $s, $e - $s);
      $i = $e;
      $name = $m[2];
      if ($m[1] === '/') { if ($name === 'Aside') { $html('</div></stop-note>'); } continue; }
      $a = self::jsxAttrs($tag);
      if ($name === 'Aside') {
        $note = self::NOTES[(is_string($a['type'] ?? null) && isset(self::NOTES[$a['type']])) ? $a['type'] : 'note'];
        $html('<stop-note status="' . $note[0] . '" title="' . self::escAttr(is_string($a['title'] ?? null) ? $a['title'] : $note[1]) . '"><div slot="message">');
        if (substr($tag, -2) === '/>') { $html('</div></stop-note>'); }
        continue;
      }
      if ($name === 'LinkCard' && is_string($a['href'] ?? null) && is_string($a['title'] ?? null)) { $html('<p><a href="' . self::escAttr($a['href']) . '">' . self::escHtml($a['title']) . '</a></p>'); continue; }
      if (($name === 'Image' || $name === 'Picture') && isset($a['src'])) {
        $src = is_string($a['src']) ? $a['src'] : ($images[$a['src']['expr']] ?? null);
        if (is_string($src)) { $out .= '<img src="' . self::escAttr($src) . '" alt="' . self::escAttr(is_string($a['alt'] ?? null) ? $a['alt'] : '') . '">'; continue; }
      }
      self::bump($st, 'component:' . $name);
    }
    $parts[] = ['md' => $out];
    return $parts;
  }

  /** An MDX page's imports of image files: [name => path written in the import]. */
  private static function imageImports($text) {
    $out = [];
    if (preg_match_all('/^import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["\']([^"\']+)["\'];?[ \t]*$/m', $text, $all, PREG_SET_ORDER)) {
      foreach ($all as $m) { if (preg_match(self::IMAGE, $m[2])) { $out[$m[1]] = $m[2]; } }
    }
    return $out;
  }

  /** The lines gathered so far, moved into $out (and, for MDX, read as in jsx(), its wrappers into $parts). */
  private static function flushChunk(array &$chunk, array &$out, array &$parts, array &$st, $mdx, $doc, $images) {
    if (!$chunk) { return; }
    $t = implode("\n", $chunk);
    $chunk = [];
    if (!$mdx) { $out[] = $t; return; }
    foreach (self::jsx($t, $doc, $st, $images) as $p) {
      if (isset($p['html'])) { $parts[] = ['md' => implode("\n", $out)]; $parts[] = $p; $out = []; } else { $out[] = $p['md']; }
    }
  }

  /**
   * A markdown or MDX body, outside fenced code: Starlight asides (:::note[Title] ... :::) become stop-notes and other
   * directives are unwrapped (and counted); in MDX, import and export lines go and JSX is read as in jsx().
   * Returns parts: [md] text to convert, and [html] wrappers that go around it as they are.
   */
  private static function prepare($body, $doc, &$st) {
    $mdx = $doc['ext'] === 'mdx';
    $images = $mdx ? self::imageImports($body) : [];
    $parts = []; $out = []; $chunk = [];
    $fenced = false;
    $open = [];
    $flush = function () use (&$chunk, &$out, &$parts, &$st, $mdx, $doc, $images) { self::flushChunk($chunk, $out, $parts, $st, $mdx, $doc, $images); };
    $html = function ($h) use (&$out, &$parts, $flush) { $flush(); $parts[] = ['md' => implode("\n", $out)]; $parts[] = ['html' => $h]; $out = []; };
    foreach (explode("\n", $body) as $line) {
      if (preg_match('/^\s*(\x60{3}|~~~)/', $line)) { $flush(); $out[] = $line; $fenced = !$fenced; continue; }
      if ($fenced) { $out[] = $line; continue; }
      if ($mdx && preg_match('/^(import|export)\s/', $line)) { if (strncmp($line, 'export', 6) === 0) { self::bump($st, 'export'); } continue; }
      $isDirective = (bool) preg_match('/^(:{3,})([A-Za-z][A-Za-z0-9-]*)?(?:\[([^\]\n]*)\])?\s*(\{[^{}\n]*\})?\s*$/D', trim($line), $d, PREG_UNMATCHED_AS_NULL);
      if ($isDirective && ($d[2] ?? null) !== null) {
        $note = self::NOTES[$d[2]] ?? null;
        if ($note === null) { self::bump($st, 'directive:' . $d[2]); $flush(); }
        else { $title = (($d[3] ?? null) !== null && trim($d[3]) !== '') ? trim($d[3]) : $note[1]; $html('<stop-note status="' . $note[0] . '" title="' . self::escAttr($title) . '"><div slot="message">'); }
        $open[] = ['colons' => strlen($d[1]), 'note' => $note !== null];
        continue;
      }
      if ($isDirective && ($d[2] ?? null) === null && $open && strlen($d[1]) === $open[count($open) - 1]['colons']) {
        $top = array_pop($open);
        if ($top['note']) { $html('</div></stop-note>'); } else { $flush(); }
        continue;
      }
      $chunk[] = $line;
    }
    $flush();
    while ($open) { $top = array_pop($open); if ($top['note']) { $html('</div></stop-note>'); } }
    $parts[] = ['md' => implode("\n", $out)];
    return $parts;
  }

  /** The static markup of an .astro page: no frontmatter script, no <head>, <style> or <script>; JSX read as in jsx(). */
  private static function astroMarkup($text, $doc, &$st) {
    $t = $text;
    if (preg_match('/^\s*---\n[\s\S]*?\n---[ \t]*(\n|$)/', $t, $fm)) { $t = substr($t, strlen($fm[0])); }
    $t = self::cleanHtml($t, ['script', 'style', 'head'], [], true);
    if (preg_match('/<body\b[^>]*>([\s\S]*)<\/body>/i', $t, $body)) { $t = $body[1]; }
    $out = '';
    foreach (self::jsx($t, $doc, $st, []) as $p) { $out .= isset($p['html']) ? $p['html'] : $p['md']; }
    return trim(preg_replace('/<\/?(html|main|article)\b[^>]*>/i', '', $out));
  }

  private static function markdown($ctx, $text) {
    if (trim($text) === '') { return ''; }
    $r = $ctx->contracts->call('import.file', 'convert', ['name' => 'page.md', 'data' => base64_encode("\n" . $text)]);
    if (!is_array($r) || !is_string($r['html'] ?? null)) { throw new Exception('markdown could not be converted: ' . ((is_array($r) && !empty($r['error'])) ? $r['error'] : 'no result')); }
    return $r['html'];
  }

  // ---- links and media ----

  /** A reference as a path on the site ("/x/y") when it is written against the site's address or base, else as written. */
  private static function onSite($ref, $st) {
    $r = $ref;
    $len = strlen($st['site']);
    if ($len > 0 && strncmp(strtolower($r), $st['site'], $len) === 0) { $rest = (string) substr($r, $len); $r = $rest === '' ? '/' : ($rest[0] === '/' ? $rest : $r); }
    $base = $st['base'];
    if ($base !== '' && $r !== '' && $r[0] === '/' && ($r === '/' . $base || strncmp($r, '/' . $base . '/', strlen($base) + 2) === 0)) { $rest = (string) substr($r, strlen($base) + 1); $r = $rest === '' ? '/' : $rest; }
    return $r;
  }

  /** The file a page's reference points at, or null: beside the page's file, or (from the site's root) under public/. */
  private static function mediaPath($ref, $doc, $st) {
    $clean = rawurldecode(self::withoutQuery(self::onSite($ref, $st)));
    if ($clean === '' || self::isExternal($clean)) { return null; }
    $candidates = $clean[0] === '/' ? [$st['dir'] . 'public/' . substr($clean, 1), $st['dir'] . substr($clean, 1)] : [self::dirOf($doc['file']) . '/' . $clean];
    foreach ($candidates as $c) { $n = self::normalizePath($c); if (isset($st['src']['paths'][$n])) { return $n; } }
    return null;
  }

  private static function uniqueFileName($repoPath, &$st) {
    $parts = explode('/', $repoPath);
    $base = preg_replace('/[^A-Za-z0-9._-]+/', '-', end($parts));
    if (!isset($st['fileNames'][$base])) { $st['fileNames'][$base] = true; return $base; }
    $dot = strrpos($base, '.');
    $s = $dot === false ? $base : substr($base, 0, $dot);
    $ext = $dot === false ? '' : substr($base, $dot);
    $n = 1;
    while (isset($st['fileNames']["$s-$n$ext"])) { $n++; }
    $st['fileNames']["$s-$n$ext"] = true;
    return "$s-$n$ext";
  }

  /** A file of the site that a page uses, added to the list for the new site's files/ folder; its site path, or null. */
  private static function registerAsset($ref, $doc, &$st) {
    if (!is_string($ref) || $ref === '') { return null; }
    $repoPath = self::mediaPath($ref, $doc, $st);
    if ($repoPath === null || !preg_match(self::IMPORTABLE, $repoPath)) { return null; }
    if (isset($st['filesByPath'][$repoPath])) { return $st['filesByPath'][$repoPath]; }
    $path = 'files/' . self::uniqueFileName($repoPath, $st);
    $st['media'][] = ['path' => $path, 'repoPath' => $repoPath];
    $st['filesByPath'][$repoPath] = $path;
    return $path;
  }

  /** The imported page a link points at: by its address (Astro's addresses end in /, so a relative link starts there), or by its file. */
  private static function pageSlug($href, $doc, $st) {
    $target = rawurldecode(self::withoutQuery(self::onSite($href, $st)));
    if ($target === '' || self::isExternal($target)) { return null; }
    $candidates = $target[0] === '/' ? [$target] : [$doc['url'] . '/' . $target, self::dirOf($doc['url']) . '/' . $target, self::dirOf($doc['rel']) . '/' . $target];
    foreach ($candidates as $c) {
      $k = self::normKey(self::normalizePath($c));
      if (isset($st['slugByKey'][$k])) { return $st['slugByKey'][$k]; }
    }
    return null;
  }

  /** Images become media-image, links between pages point at the imported slugs, files join the file list. */
  private static function rewrite($html, $doc, &$st) {
    $html = preg_replace_callback('/<img\b[^>]*>/i', function ($t) use ($doc, &$st) {
      $tag = $t[0];
      if (!preg_match('/\ssrc="([^"]*)"/i', $tag, $src) || $src[1] === '') { return $tag; }
      $alt = preg_match('/\salt="([^"]*)"/i', $tag, $a) ? $a[1] : '';
      $file = self::registerAsset($src[1], $doc, $st);
      $source = $file !== null ? $file : ((self::isExternal($src[1]) && preg_match(self::IMAGE, self::withoutQuery($src[1]))) ? $src[1] : null);
      return $source === null ? $tag : '<media-image source="' . self::escAttr($source) . '" alt="' . self::escAttr($alt) . '"></media-image>';
    }, $html);
    return preg_replace_callback('/(<a\b[^>]*?\shref=")([^"]*)(")/i', function ($m) use ($doc, &$st) {
      $href = $m[2];
      if ($href === '' || $href[0] === '#') { return $m[0]; }
      $slug = self::pageSlug($href, $doc, $st);
      if ($slug !== null) { $hash = strpos($href, '#'); return $m[1] . $slug . ($hash === false ? '' : substr($href, $hash)) . $m[3]; }
      $file = self::registerAsset($href, $doc, $st);
      return $file === null ? $m[0] : $m[1] . self::escAttr($file) . $m[3];
    }, $html);
  }

  private static function renderBody($ctx, $doc, &$st) {
    if ($doc['ext'] === 'astro') { $html = self::astroMarkup($doc['body'], $doc, $st); }
    elseif ($doc['ext'] === 'html') { $html = $doc['body']; }
    else {
      $html = '';
      foreach (self::prepare($doc['body'], $doc, $st) as $p) { $html .= isset($p['html']) ? $p['html'] : self::markdown($ctx, $p['md']); }
      $tagline = self::stringOf(self::mapOf($doc['data']['hero'] ?? null)['tagline'] ?? null);
      if ($tagline !== '') { $html = '<p>' . self::escHtml($tagline) . '</p>' . $html; }
    }
    return trim(self::strip(self::rewrite($html, $doc, $st)));
  }

  // ---- the documents ----

  private static function frontMatterCall($ctx, $op, $input) {
    $r = $ctx->contracts->call('import-frontmatter.data', $op, $input);
    $ok = is_array($r) && ($op === 'split' ? (isset($r['results']) && is_array($r['results'])) : (array_key_exists('data', $r) || array_key_exists('error', $r)));
    if (!$ok) { throw new Exception('front matter could not be read: ' . ((is_array($r) && !empty($r['error'])) ? $r['error'] : 'no result')); }
    return $r;
  }

  /** The text of some markup: everything outside its tags, by scanning. */
  private static function textOf($html) {
    $out = ''; $inTag = false;
    $n = strlen($html);
    for ($i = 0; $i < $n; $i++) { $c = $html[$i]; if ($c === '<') { $inTag = true; } elseif ($c === '>') { $inTag = false; } elseif (!$inTag) { $out .= $c; } }
    return trim(preg_replace('/\s+/', ' ', $out));
  }
  /** The first <h1> of some markup, as text, or "". */
  private static function firstHeading($html) {
    return preg_match('/<h1\b[^>]*>([\s\S]*?)<\/h1>/i', $html, $m) ? self::textOf($m[1]) : '';
  }

  /** Read and split every document (up to MAX_PAGES) in two calls; each gets data, body, title, created and keys. */
  private static function readDocs($ctx, $src, $st, $docs) {
    $truncated = false;
    if (count($docs) > self::MAX_PAGES) { $docs = array_slice($docs, 0, self::MAX_PAGES); $truncated = true; }
    $files = [];
    foreach ($docs as $d) { $files[] = $d['file']; }
    $texts = ($src['readMany'])($files, false);
    $docs = array_values(array_filter($docs, function ($d) use ($texts) { return is_string($texts[$d['file']] ?? null); }));
    $md = []; $mdTexts = [];
    foreach ($docs as $k => $d) { if ($d['ext'] !== 'astro') { $md[] = $k; $mdTexts[] = $texts[$d['file']]; } }
    $split = $md ? self::frontMatterCall($ctx, 'split', ['texts' => $mdTexts])['results'] : [];
    foreach ($md as $i => $k) { $r = is_array($split[$i] ?? null) ? $split[$i] : []; $docs[$k]['data'] = self::mapOf($r['data'] ?? null); $docs[$k]['body'] = is_string($r['body'] ?? null) ? $r['body'] : ''; }
    foreach ($docs as $k => $d) {
      if ($d['ext'] === 'astro') {
        $d['data'] = [];
        $d['body'] = preg_replace('/\r\n?/', "\n", $texts[$d['file']]);
        // an .astro page's title: its first <h1>, else the title its layout component is given
        $markup = preg_replace('/^\s*---\n[\s\S]*?\n---[ \t]*(\n|$)/', '', $d['body']);
        $title = self::firstHeading($markup);
        if ($title === '' && preg_match('/<[A-Z][A-Za-z0-9_.]*\b[^>]*?\stitle\s*=\s*(?:"([^"]*)"|\'([^\']*)\')/', $markup, $lm, PREG_UNMATCHED_AS_NULL)) { $title = ($lm[1] ?? null) !== null ? $lm[1] : (string) $lm[2]; }
        $d['title'] = $title;
      } else { $d['title'] = self::stringOf($d['data']['title'] ?? null); }
      if ($d['title'] === '') { $b = self::baseOf($d['route']); $d['title'] = self::titleFromName($b !== '' ? $b : $st['siteTitle']); }
      $date = '';
      foreach (['pubDate', 'date', 'publishDate', 'lastUpdated'] as $key) { $date = self::stringOf($d['data'][$key] ?? null); if ($date !== '') { break; } }
      $d['created'] = self::parseDate($date);
      $own = self::stringOf($d['data']['slug'] ?? null);
      if ($own !== '') { $d['route'] = $d['kind'] === 'entry' ? self::slugOf($d['collection']) . '/' . trim($own, '/') : trim($own, '/'); }
      $d['url'] = '/' . $d['route'];
      $d['keys'] = [$d['url'], '/' . self::stem($d['rel'])];
      $docs[$k] = $d;
    }
    return ['docs' => $docs, 'truncated' => $truncated];
  }

  // ---- the import ----

  private function importSite($ctx, $src) {
    $from = $src['repo'] ?: $src['name'];
    $found = self::findSite($src['list']);
    if ($found === null) { return ['error' => "no Astro site found in $from (expected an astro.config.mjs, .js or .ts)"]; }
    $configText = ($src['readMany'])([$found['config']], false)[$found['config']] ?? null;
    $config = self::readConfig(is_string($configText) ? $configText : '');
    $dir = $found['dir'];
    $st = [
      'src' => $src, 'dir' => $dir, 'base' => $config['base'], 'site' => $config['site'], 'siteTitle' => ($config['title'] !== null && $config['title'] !== '') ? $config['title'] : $src['name'],
      'unmapped' => [], 'media' => [], 'fileNames' => [], 'filesByPath' => [], 'slugByKey' => [],
    ];
    if ($config['sidebarUnread']) { self::bump($st, 'config:sidebar'); }
    $docsRoot = $dir . 'src/content/docs/';
    $starlight = false;
    if ($config['starlight']) { foreach ($src['list'] as $p) { if (strncmp($p, $docsRoot, strlen($docsRoot)) === 0 && preg_match(self::DOC_EXT, $p)) { $starlight = true; break; } } }
    $items = []; $outline = []; $used = [];
    $languageFiles = 0;

    // documents are kept in $all and referred to by index
    /** @var array<int, array<string, mixed>> $all */
    $all = [];
    $add = function ($k, $group, $parentIndex, $order, $depth) use (&$all, &$items, &$outline, &$used, &$st) {
      $d = $group !== null ? $group : $all[$k];
      if ($group !== null) { $own = self::titleSlug($group['slug']); }
      else { $own = $d['route'] === '' ? self::titleSlug($d['title']) : self::titleSlug(self::baseOf($d['route'])); }
      $slug = $parentIndex !== null ? $items[$parentIndex]['slug'] . '/' . $own : $own;
      for ($i = 2, $s = $slug; isset($used[$slug]); $i++) { $slug = "$s-$i"; }
      $used[$slug] = true;
      $metadata = ['sourceType' => 'astro', 'astro' => $group !== null ? ['kind' => $d['kind']] : ['path' => $d['file'], 'kind' => $d['kind']]];
      if ($group === null) {
        if ($d['hidden']) { $metadata['hideInMenu'] = true; }
        if (self::isTrue($d['data']['draft'] ?? null)) { $metadata['published'] = false; }
        if ($d['created'] !== null) { $metadata['created'] = $d['created']; }
        $tags = [];
        if (is_array($d['data']['tags'] ?? null) && array_is_list($d['data']['tags'])) { foreach ($d['data']['tags'] as $t) { if (is_string($t) && trim($t) !== '') { $tags[] = trim($t); } } }
        if ($tags) { $metadata['tags'] = $tags; }
      } elseif (isset($d['link'])) { $metadata['astro']['link'] = $d['link']; }
      $index = count($items);
      $items[] = ['id' => 'item-' . ($index + 1), 'title' => $d['title'], 'slug' => $slug, 'parent' => $parentIndex !== null ? $items[$parentIndex]['id'] : null, 'order' => $order, 'indent' => $depth, 'content' => '<p></p>', 'metadata' => $metadata];
      if ($group === null) {
        $outline[] = ['doc' => $k, 'index' => $index];
        foreach ($d['keys'] as $key) { $nk = self::normKey($key); if (!isset($st['slugByKey'][$nk])) { $st['slugByKey'][$nk] = $slug; } }
      } elseif (isset($d['link'])) { $items[$index]['content'] = '<p><a href="' . self::escAttr($d['link']) . '">' . self::escHtml($d['title']) . '</a></p>'; }
      return $index;
    };

    $truncated = false;
    if ($starlight) {
      // which folder holds the default language: the root locale, else defaultLocale's folder, else all of docs/
      $langDir = '';
      $locales = $config['locales'];
      if (is_array($locales) && !in_array('root', $locales, true) && is_string($config['defaultLocale']) && in_array($config['defaultLocale'], $locales, true)) { $langDir = $config['defaultLocale'] . '/'; }
      $others = [];
      if (is_array($locales)) { foreach ($locales as $l) { if ($l !== 'root' && $l . '/' !== $langDir) { $others[] = $l; } } }
      $candidates = [];
      $skip = strlen($docsRoot);
      foreach ($src['list'] as $p) {
        if (strncmp($p, $docsRoot, $skip) !== 0 || !preg_match(self::DOC_EXT, $p)) { continue; }
        $rel = substr($p, $skip);
        $other = false;
        foreach ($others as $l) { if (strncmp($rel, $l . '/', strlen($l) + 1) === 0) { $other = true; } }
        if ($other || ($langDir !== '' && strncmp($rel, $langDir, strlen($langDir)) !== 0)) { $languageFiles++; continue; }
        $under = false;
        foreach (explode('/', $rel) as $seg) { if (strncmp($seg, '_', 1) === 0) { $under = true; } }
        if ($under) { continue; }
        $inner = substr($rel, strlen($langDir));
        $candidates[] = ['file' => $p, 'rel' => $inner, 'ext' => substr($p, (int) strrpos($p, '.') + 1), 'kind' => 'doc', 'route' => self::slugOf(preg_replace(self::DOC_EXT, '', $inner))];
      }
      $read = self::readDocs($ctx, $src, $st, $candidates);
      $truncated = $read['truncated'];
      $all = $read['docs'];
      foreach ($all as $k => $d) {
        $sb = self::mapOf($d['data']['sidebar'] ?? null);
        $all[$k]['order'] = self::numberOf($sb['order'] ?? null);
        $all[$k]['hidden'] = self::isTrue($sb['hidden'] ?? null);
      }
      $byRoute = [];
      foreach ($all as $k => $d) { if (!isset($byRoute[$d['route']])) { $byRoute[$d['route']] = $k; } }
      $placed = [];
      // an autogenerated group: the docs under a folder, ordered by sidebar.order then slug; folders become groups
      $autogen = function ($directory, $parentIndex, $depth, $startOrder) use (&$autogen, &$all, &$placed, $byRoute, $add) {
        $pre = trim($directory, '/') === '' ? '' : self::slugOf(trim($directory, '/')) . '/';
        $under = [];
        foreach ($all as $k => $d) { if (!isset($placed[$k]) && $d['route'] !== '' && ($pre === '' || strncmp($d['route'], $pre, strlen($pre)) === 0 || $d['route'] . '/' === $pre)) { $under[] = $k; } }
        // folders first found, then the pages directly in this one (a page named like a folder is that folder's index)
        $dirs = [];
        foreach ($under as $k) {
          $rest = (string) substr($all[$k]['route'], strlen($pre));
          if (strpos($rest, '/') !== false) { $head = explode('/', $rest)[0]; if (!isset($dirs[$head])) { $dirs[$head] = ['name' => $head, 'dir' => $pre . $head, 'doc' => $byRoute[$pre . $head] ?? null]; } }
        }
        $entries = array_values($dirs);
        foreach ($under as $k) { $rest = (string) substr($all[$k]['route'], strlen($pre)); if (strpos($rest, '/') === false && !isset($dirs[$rest])) { $entries[] = ['name' => $rest, 'dir' => null, 'doc' => $k]; } }
        usort($entries, function ($a, $b) use ($all) {
          $oa = ($a['doc'] !== null && $all[$a['doc']]['order'] !== null) ? $all[$a['doc']]['order'] : INF;
          $ob = ($b['doc'] !== null && $all[$b['doc']]['order'] !== null) ? $all[$b['doc']]['order'] : INF;
          return $oa != $ob ? ($oa < $ob ? -1 : 1) : self::byText($a['name'], $b['name']);
        });
        $order = $startOrder;
        foreach ($entries as $e) {
          if ($e['dir'] === null) { $placed[$e['doc']] = true; $add($e['doc'], null, $parentIndex, $order++, $depth); continue; }
          // a folder's own index page holds that folder's group; else a group page is made
          $holder = ($e['doc'] !== null && !isset($placed[$e['doc']])) ? $e['doc'] : null;
          if ($holder !== null) { $placed[$holder] = true; }
          $index = $holder !== null ? $add($holder, null, $parentIndex, $order++, $depth) : $add(null, ['kind' => 'group', 'title' => self::titleFromName($e['name']), 'slug' => $e['name']], $parentIndex, $order++, $depth);
          $autogen($e['dir'], $index, $depth + 1, 0);
        }
        return $order;
      };
      // the sidebar in astro.config, read as data: links, groups and autogenerated groups
      $walk = function ($entries, $parentIndex, $depth, $start) use (&$walk, &$placed, $byRoute, $add, $autogen, $st) {
        $order = $start;
        foreach ($entries as $e) {
          $slugRef = is_string($e) ? $e : ((is_object($e) && is_string($e->slug ?? null)) ? $e->slug : null);
          if ($slugRef !== null) {
            $k = $byRoute[self::slugOf(trim($slugRef, '/'))] ?? null;
            if ($k !== null && !isset($placed[$k])) { $placed[$k] = true; $add($k, null, $parentIndex, $order++, $depth); }
            continue;
          }
          if (!is_object($e)) { continue; }
          $label = is_string($e->label ?? null) ? $e->label : '';
          if (is_string($e->link ?? null)) {
            $k = self::isExternal($e->link) ? null : ($byRoute[self::normKey(self::onSite($e->link, $st))] ?? null);
            if ($k !== null && !isset($placed[$k])) { $placed[$k] = true; $add($k, null, $parentIndex, $order++, $depth); }
            elseif ($k === null && $label !== '') { $add(null, ['kind' => 'link', 'title' => $label, 'link' => $e->link, 'slug' => $label], $parentIndex, $order++, $depth); }
            continue;
          }
          $ag = $e->autogenerate ?? null;
          $auto = (is_object($ag) && is_string($ag->directory ?? null)) ? $ag->directory : null;
          if ($label === '' && $auto !== null) { $order = $autogen($auto, $parentIndex, $depth, $order); continue; }
          if ($label === '') { continue; }
          $index = $add(null, ['kind' => 'group', 'title' => $label, 'slug' => $label], $parentIndex, $order++, $depth);
          if ($auto !== null) { $autogen($auto, $index, $depth + 1, 0); }
          elseif (is_array($e->items ?? null)) { $walk($e->items, $index, $depth + 1, 0); }
        }
        return $order;
      };
      $order = 0;
      $home = $byRoute[''] ?? null;
      if ($home !== null) { $placed[$home] = true; $add($home, null, null, $order++, 0); }
      if ($config['sidebar'] !== null) {
        $order = $walk($config['sidebar'], null, 0, $order);
        // pages the sidebar does not list are still pages of the site: kept, out of the menu
        $rest = [];
        foreach ($all as $k => $d) { if (!isset($placed[$k])) { $rest[] = $k; } }
        usort($rest, function ($x, $y) use ($all) { return self::byText($all[$x]['route'], $all[$y]['route']); });
        foreach ($rest as $k) { $all[$k]['hidden'] = true; $placed[$k] = true; $add($k, null, null, $order++, 0); }
      } else { $autogen('', null, 0, $order); }
    } else {
      // any other Astro site: src/pages (markdown, .astro, .html) by folder, then each content collection
      $pagesRoot = $dir . 'src/pages/';
      $contentRoot = $dir . 'src/content/';
      $candidates = [];
      foreach ($src['list'] as $p) {
        if (strncmp($p, $pagesRoot, strlen($pagesRoot)) === 0 && preg_match(self::PAGE_EXT, $p)) {
          $rel = substr($p, strlen($pagesRoot));
          $under = false;
          foreach (explode('/', $rel) as $seg) { if (strncmp($seg, '_', 1) === 0) { $under = true; } }
          if ($under) { continue; }
          if (strpos($rel, '[') !== false) { self::bump($st, 'route:dynamic'); continue; }
          if (preg_match('/^404\./', $rel)) { continue; }
          $candidates[] = ['file' => $p, 'rel' => $rel, 'ext' => substr($p, (int) strrpos($p, '.') + 1), 'kind' => 'page', 'route' => self::slugOf(self::stem($rel))];
        } elseif (strncmp($p, $contentRoot, strlen($contentRoot)) === 0 && preg_match(self::DOC_EXT, $p)) {
          $rel = substr($p, strlen($contentRoot));
          if (strpos($rel, '/') === false) { continue; }
          $under = false;
          foreach (explode('/', $rel) as $seg) { if (strncmp($seg, '_', 1) === 0) { $under = true; } }
          if ($under) { continue; }
          $collection = substr($rel, 0, strpos($rel, '/'));
          $candidates[] = ['file' => $p, 'rel' => $rel, 'ext' => substr($p, (int) strrpos($p, '.') + 1), 'kind' => 'entry', 'collection' => $collection, 'route' => self::slugOf($collection) . '/' . self::slugOf(preg_replace(self::DOC_EXT, '', substr($rel, strlen($collection) + 1)))];
        }
      }
      $read = self::readDocs($ctx, $src, $st, $candidates);
      $truncated = $read['truncated'];
      $all = $read['docs'];
      foreach ($all as $k => $d) { $all[$k]['hidden'] = false; }
      $pages = []; $entries = [];
      foreach ($all as $k => $d) { if ($d['kind'] === 'page') { $pages[] = $k; } else { $entries[] = $k; } }
      $byRoute = [];
      foreach ($pages as $k) { if (!isset($byRoute[$all[$k]['route']])) { $byRoute[$all[$k]['route']] = $k; } }
      $titleOrder = function ($x, $y) use (&$all) { $t = self::byText(strtolower($all[$x]['title']), strtolower($all[$y]['title'])); return $t !== 0 ? $t : self::byText($all[$x]['route'], $all[$y]['route']); };
      $holders = [];
      $walk = function ($route, $parentIndex, $depth, $start) use (&$walk, &$all, &$holders, $pages, $byRoute, $add, $titleOrder) {
        $order = $start;
        $kids = [];
        foreach ($pages as $k) { if ($all[$k]['route'] !== '' && self::dirOf($all[$k]['route']) === $route) { $kids[] = $k; } }
        usort($kids, $titleOrder);
        foreach ($kids as $k) { $index = $add($k, null, $parentIndex, $order++, $depth); $holders[$all[$k]['route']] = $index; $walk($all[$k]['route'], $index, $depth + 1, 0); }
        // folders of pages with no index page of their own get a page
        $dirs = [];
        foreach ($pages as $k) {
          $r = $all[$k]['route'];
          $dr = self::dirOf($r);
          if ($r === '' || $dr === $route || !($route === '' || strncmp($dr, $route . '/', strlen($route) + 1) === 0)) { continue; }
          $dirs[explode('/', $route === '' ? $r : substr($r, strlen($route) + 1))[0]] = true;
        }
        $names = array_map('strval', array_keys($dirs));
        usort($names, [self::class, 'byText']);
        foreach ($names as $name) {
          $full = $route === '' ? $name : $route . '/' . $name;
          if (isset($byRoute[$full])) { continue; }
          $hasPages = false;
          foreach ($pages as $k) { $dr = self::dirOf($all[$k]['route']); if ($dr === $full || strncmp($dr, $full . '/', strlen($full) + 1) === 0) { $hasPages = true; } }
          if (!$hasPages) { continue; }
          $index = $add(null, ['kind' => 'group', 'title' => self::titleFromName($name), 'slug' => $name], $parentIndex, $order++, $depth);
          $holders[$full] = $index;
          $walk($full, $index, $depth + 1, 0);
        }
        return $order;
      };
      $order = 0;
      $home = $byRoute[''] ?? null;
      if ($home !== null) { $add($home, null, null, $order++, 0); }
      $order = $walk('', null, 0, $order);
      // each collection: under the top-level page of the same name, else a page of its own; newest first when dated
      $names = [];
      foreach ($entries as $k) { $names[$all[$k]['collection']] = true; }
      $names = array_map('strval', array_keys($names));
      usort($names, [self::class, 'byText']);
      foreach ($names as $name) {
        $list = [];
        $dated = false;
        foreach ($entries as $k) { if ($all[$k]['collection'] === $name) { $list[] = $k; if ($all[$k]['created'] !== null) { $dated = true; } } }
        usort($list, $dated ? function ($x, $y) use (&$all) {
          $ca = $all[$x]['created'] === null ? 0 : $all[$x]['created'];
          $cb = $all[$y]['created'] === null ? 0 : $all[$y]['created'];
          return $ca !== $cb ? ($ca > $cb ? -1 : 1) : self::byText($all[$x]['route'], $all[$y]['route']);
        } : $titleOrder);
        $holder = $holders[self::slugOf($name)] ?? $add(null, ['kind' => 'collection', 'title' => self::titleFromName($name), 'slug' => $name], null, $order++, 0);
        $first = 0;
        foreach ($items as $it) { if ($it['parent'] === $items[$holder]['id']) { $first++; } }
        foreach ($list as $i => $k) { $add($k, null, $holder, $first + $i, $items[$holder]['indent'] + 1); }
      }
    }
    if (!$outline) { return ['error' => "no pages found in $from"]; }

    foreach ($outline as $o) {
      $html = self::renderBody($ctx, $all[$o['doc']], $st);
      $items[$o['index']]['content'] = $html === '' ? '<p></p>' : $html;
    }

    // media: a repository's files are fetched by core from their URLs; a zip's are read here and handed over as data
    $files = [];
    if ($src['rawUrl']) { foreach ($st['media'] as $f) { $files[] = ['path' => $f['path'], 'url' => ($src['rawUrl'])($f['repoPath'])]; } }
    elseif ($st['media']) {
      $wantedMedia = [];
      foreach ($st['media'] as $f) { $wantedMedia[] = $f['repoPath']; }
      $data = ($src['readMany'])($wantedMedia, true);
      foreach ($st['media'] as $f) { if (is_string($data[$f['repoPath']] ?? null)) { $files[] = ['path' => $f['path'], 'data' => $data[$f['repoPath']]]; } }
    }

    $out = ['title' => $st['siteTitle'], 'items' => $items, 'files' => $files];
    if ($truncated) { $out['truncated'] = true; }
    $out['stats'] = ['pages' => count($items), 'media' => count($files), 'languageFiles' => $languageFiles, 'starlight' => $starlight];
    if ($st['unmapped']) {
      $keys = array_map('strval', array_keys($st['unmapped']));
      usort($keys, [self::class, 'byText']);
      $out['stats']['unmapped'] = [];
      foreach ($keys as $k) { $out['stats']['unmapped'][$k] = $st['unmapped'][$k]; }
    }
    return $out;
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Reads an Astro site from a GitHub repository (or an uploaded zip of one). A Starlight site gives its docs in
   * the order of the sidebar in astro.config (read as data, never executed) or of its folders, with asides as
   * stop-notes. Any other Astro site gives its markdown and .astro pages by folder (static markup only) and its
   * content collections, newest first when dated. Front matter gives titles, dates, tags and drafts; links
   * between pages point at the imported slugs; the images and files pages use are listed for the new site.
   * Components and expressions are not run; what was left out is counted in stats.
   *
   * @param object $ctx    Platform context (spec/13); the repository or zip is read through import-source.tree, so nothing is fetched here.
   * @param array  $input  [url] of the repository (https://github.com/<owner>/<repo>, optionally /tree/<branch>), or [files => [[name, data (base64 zip)]]].
   * @return array  [title, items, files, truncated?, stats] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    $input = $input ?: [];
    try {
      if (!empty($input['files']) && is_array($input['files'])) {
        $f = is_array($input['files'][0] ?? null) ? $input['files'][0] : [];
        if (!preg_match('/\.zip$/i', (string) ($f['name'] ?? ''))) { return ['error' => 'expected a .zip of the Astro site']; }
      } elseif (empty($input['url'])) { return ['error' => 'url or files is required']; }
      $src = $this->openSource($ctx, $input);
      if (isset($src['error'])) { return $src; }
      return $this->importSite($ctx, $src);
    } catch (Exception $e) {
      return ['error' => $e->getMessage()];
    }
  }
}

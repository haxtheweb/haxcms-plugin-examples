<?php
// Hugo importer (PHP). Mirrors src/nodejs/index.js; both return identical results.
// Reads a Hugo site as data: the content tree (sections, page bundles and single pages), each page's front matter
// (YAML, TOML or JSON), the site configuration, and the built-in shortcodes that have a plain equivalent. Nothing of
// Hugo runs: no templates, no theme, no custom shortcodes. The repository or zip is listed and read through
// import-source.tree, front matter and configuration through import-frontmatter.data, markdown through import.file.
class ImporterHugoPlugin {
  const MAX_PAGES = 500;
  const IMPORTABLE = '/\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|xml)$/iD';
  const IMAGE = '/\.(jpg|jpeg|png|gif|webp)$/iD';
  // a content file: its folders, its name and its format
  const CONTENT_FILE = '~^((?:[^/]+/)*)([^/]+)\.(md|markdown|html)$~D';
  // a site configuration file: hugo.* or config.* at a site's top, or in its config/_default folder
  const CONFIG_FILE = '~^((?:[^/]+/)*)(?:(hugo|config)\.(toml|yaml|yml|json)|config/_default/(hugo|config)\.(toml|yaml|yml|json))$~D';
  const OTHER_FORMAT = '/\.(adoc|asciidoc|rst|org|pandoc|pdc)$/D';
  // what is read as text out of a zip: pages and configuration
  const SOURCE_TEXT = '\.(md|markdown|html|toml|yaml|yml|json)$';
  // {{< name args >}} and {{% name args %}}, opening, closing ({{< /name >}}) or self-closing ({{< name />}})
  const SHORTCODE = '/\{\{[<%]\s*(\/?)\s*([A-Za-z0-9_][A-Za-z0-9_.\/-]*)((?:"[^"]*"|\x60[^\x60]*\x60|[^"\x60])*?)[>%]\}\}/';
  // a code fence, written without the character itself (PHP reads a bare one as "run a command")
  const FENCE = "\x60\x60\x60";
  const ARG = '/(?:([A-Za-z0-9_-]+)\s*=\s*)?(?:"([^"]*)"|\x60([^\x60]*)\x60|([^\s"\x60]+))/';

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

  // ---- Hugo helpers ----

  private static function isTrue($v) { return strtolower(trim(is_scalar($v) ? (string) $v : '')) === 'true'; }
  private static function mapOf($v) { return self::isObject($v) ? $v : []; }
  private static function withoutQuery($ref) { return explode('?', explode('#', $ref)[0])[0]; }
  private static function dirOf($path) { $cut = strrpos($path, '/'); return $cut === false ? '' : substr($path, 0, $cut); }
  private static function baseOf($path) { $cut = strrpos($path, '/'); return $cut === false ? $path : substr($path, $cut + 1); }
  private static function intOf($v) { $s = trim(is_scalar($v) ? (string) $v : ''); return preg_match('/^-?\d{1,9}$/D', $s) ? (int) $s : 0; }
  /** A list of non-empty strings out of a list or a single value. */
  private static function stringList($v) {
    $out = [];
    foreach ((is_array($v) && array_is_list($v)) ? $v : [$v] as $x) { if (is_string($x) && trim($x) !== '') { $out[] = trim($x); } }
    return $out;
  }
  private static function titleFromName($name) {
    $t = trim(preg_replace('/[-_]+/', ' ', $name));
    return $t === '' ? $name : self::ucfirst($t);
  }
  /** The text of a level-one heading line (# Title, # Title #), or "". */
  private static function headingOne($line) {
    if (!preg_match('/^#[ \t]+(.*)$/D', $line, $h)) { return ''; }
    $t = rtrim($h[1], " \t");
    $u = rtrim($t, '#');
    if ($u !== $t && ($u === '' || strpos(" \t", substr($u, -1)) !== false)) { $t = rtrim($u, " \t"); }
    return $t;
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

  /** How links name a page: no slashes at the ends, lower case, no extension, no index file. */
  public static function normKey($path) {
    $k = preg_replace('/\.(md|markdown|html)$/D', '', strtolower(trim($path, '/')));
    if ($k === 'index' || $k === '_index') { return ''; }
    if (substr($k, -6) === '/index') { return substr($k, 0, -6); }
    if (substr($k, -7) === '/_index') { return substr($k, 0, -7); }
    return $k;
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

  /**
   * The Hugo site in the files: the folder holding hugo.* (or config.* beside content/, layouts/, themes/ or
   * archetypes/), the shallowest first. [dir, config] or null.
   */
  public static function findSite($list) {
    $hugoDirs = [];
    foreach ($list as $p) {
      $segs = explode('/', $p);
      for ($i = 0; $i < count($segs) - 1; $i++) {
        if ($segs[$i] === 'content' || $segs[$i] === 'layouts' || $segs[$i] === 'themes' || $segs[$i] === 'archetypes') { $hugoDirs[$i === 0 ? '' : implode('/', array_slice($segs, 0, $i)) . '/'] = true; }
      }
    }
    $best = null;
    foreach ($list as $p) {
      if (!preg_match(self::CONFIG_FILE, $p, $m, PREG_UNMATCHED_AS_NULL)) { continue; }
      $top = ($m[2] ?? null) !== null;
      $named = ($top ? $m[2] : ($m[4] ?? null)) === 'hugo';
      if (!$named && !isset($hugoDirs[$m[1]])) { continue; }
      // shallowest, then hugo.* before config.*, then a file at the top before config/_default, then by name
      $rank = [$m[1] === '' ? 0 : count(explode('/', $m[1])) - 1, $named ? 0 : 1, $top ? 0 : 1];
      $order = -1;
      if ($best !== null) {
        $order = $rank[0] - $best['rank'][0];
        if ($order === 0) { $order = $rank[1] - $best['rank'][1]; }
        if ($order === 0) { $order = $rank[2] - $best['rank'][2]; }
        if ($order === 0) { $order = self::byText($p, $best['config']); }
      }
      if ($order < 0) { $best = ['dir' => (string) $m[1], 'config' => $p, 'rank' => $rank]; }
    }
    return $best === null ? null : ['dir' => $best['dir'], 'config' => $best['config']];
  }

  private static function formatOf($path) { $ext = substr($path, (int) strrpos($path, '.') + 1); return $ext === 'yml' ? 'yaml' : $ext; }

  // ---- the outline: sections, bundles and pages ----

  private static function newNode($key, $pick) {
    return [
      'key' => $key, 'name' => self::baseOf($key), 'parent' => $key === '' ? null : self::dirOf($key), 'kind' => $pick ? $pick['kind'] : 'section', 'file' => $pick ? $pick['file'] : null, 'ext' => $pick ? $pick['ext'] : '',
      'resDir' => ($pick && $pick['kind'] === 'page') ? self::dirOf($key) : $key, 'others' => $pick ? $pick['files'] - 1 : 0,
      'data' => [], 'body' => null, 'title' => '', 'weight' => 0, 'created' => null, 'url' => '', 'capped' => false,
    ];
  }

  /**
   * One node per page of the content tree: [key => node], where key is the page's path without extension, language
   * or index file ("posts", "posts/first", "" for the home page). A folder with index.md is one page and what is under
   * it belongs to it; folders without a page file of their own still get a node, to keep their pages together.
   */
  private static function readContent($src, $contentRoot, $langs, $defaultLang) {
    $picks = [];
    $skip = strlen($contentRoot);
    foreach ($src['list'] as $p) {
      if (strncmp($p, $contentRoot, $skip) !== 0) { continue; }
      if (!preg_match(self::CONTENT_FILE, substr($p, $skip), $m)) { continue; }
      $dir = rtrim($m[1], '/');
      $name = $m[2];
      $lang = '';
      $dot = strrpos($name, '.');
      if ($dot !== false && $dot > 0 && isset($langs[substr($name, $dot + 1)])) { $lang = substr($name, $dot + 1); $name = substr($name, 0, $dot); }
      $kind = ($name === '_index' || ($name === 'index' && $dir === '')) ? 'section' : ($name === 'index' ? 'bundle' : 'page');
      $key = $kind === 'page' ? ($dir === '' ? $name : $dir . '/' . $name) : $dir;
      // a file with no language, else the site's language, else any; markdown before HTML
      $rank = ($lang === '' ? 0 : ($lang === $defaultLang ? 1 : 2)) * 10 + ($m[3] === 'md' ? 0 : ($m[3] === 'markdown' ? 1 : 2));
      if (!isset($picks[$key])) { $picks[$key] = ['kind' => $kind, 'file' => $p, 'ext' => $m[3], 'rank' => $rank, 'files' => 1]; }
      else {
        $picks[$key]['files']++;
        if ($rank < $picks[$key]['rank'] || ($rank === $picks[$key]['rank'] && self::byText($p, $picks[$key]['file']) < 0)) { $picks[$key]['kind'] = $kind; $picks[$key]['file'] = $p; $picks[$key]['ext'] = $m[3]; $picks[$key]['rank'] = $rank; }
      }
    }
    $bundles = [];
    foreach ($picks as $key => $pick) { if ($pick['kind'] === 'bundle') { $bundles[(string) $key] = true; } }
    $keys = array_map('strval', array_keys($picks));
    usort($keys, [self::class, 'byText']);
    $nodes = [];
    foreach ($keys as $key) {
      $segs = $key === '' ? [] : explode('/', $key);
      $inBundle = false;
      for ($i = 1; $i < count($segs); $i++) { if (isset($bundles[implode('/', array_slice($segs, 0, $i))])) { $inBundle = true; } }
      if ($inBundle) { continue; }
      for ($i = 1; $i < count($segs); $i++) { $d = implode('/', array_slice($segs, 0, $i)); if (!isset($nodes[$d])) { $nodes[$d] = self::newNode($d, $picks[$d] ?? null); } }
      if (!isset($nodes[$key])) { $nodes[$key] = self::newNode($key, $picks[$key]); }
    }
    return $nodes;
  }

  /** Hugo's default order: weight (set ones first, lowest first), then newest, then title, then path. */
  private static function pageOrder($a, $b) {
    if ($a['weight'] !== $b['weight']) {
      if ($a['weight'] === 0) { return 1; }
      if ($b['weight'] === 0) { return -1; }
      return $a['weight'] < $b['weight'] ? -1 : 1;
    }
    if ($a['created'] !== $b['created']) {
      if ($a['created'] === null) { return 1; }
      if ($b['created'] === null) { return -1; }
      return $a['created'] > $b['created'] ? -1 : 1;
    }
    $t = self::byText(strtolower($a['title']), strtolower($b['title']));
    return $t !== 0 ? $t : self::byText($a['key'], $b['key']);
  }

  // ---- page bodies ----

  private static function bump(&$st, $key) { $st['unmapped'][$key] = ($st['unmapped'][$key] ?? 0) + 1; }

  /** A shortcode's arguments: [named => [..], positional => [..]]. */
  private static function shortcodeArgs($text) {
    $named = []; $positional = [];
    preg_match_all(self::ARG, $text, $all, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);
    foreach ($all as $m) {
      $value = ($m[2] ?? null) !== null ? $m[2] : ((($m[3] ?? null) !== null) ? $m[3] : ($m[4] ?? ''));
      if (($m[1] ?? null) !== null) { $named[$m[1]] = $value; }
      elseif ($value !== '/') { $positional[] = $value; }
    }
    return ['named' => $named, 'positional' => $positional];
  }

  /** What a ref or relref shortcode points at: the imported page's slug (with its #anchor), or the path as written. */
  private static function refTarget($path, $node, $st) {
    $hash = strpos($path, '#');
    $anchor = $hash === false ? '' : substr($path, $hash);
    $p = $hash === false ? $path : substr($path, 0, $hash);
    if ($p === '') { return $anchor; }
    foreach ($p[0] === '/' ? [$p] : [$node['resDir'] . '/' . $p, $p] as $c) {
      $k = self::normKey(self::normalizePath($c));
      if (isset($st['slugByKey'][$k])) { return $st['slugByKey'][$k] . $anchor; }
    }
    // Hugo also finds a page by its file name alone, when only one page has it
    $name = preg_replace('/\.(md|markdown|html)$/D', '', strtolower(self::baseOf($p)));
    if ($name === 'index' || $name === '_index') { $name = strtolower(self::baseOf(self::dirOf($p))); }
    $byName = $st['slugByName'][$name] ?? null;
    return is_string($byName) ? $byName . $anchor : $path;
  }

  /** The built-in shortcodes that have a plain equivalent; everything else is removed around its content and counted. */
  private static function shortcodes($text, $node, &$st) {
    $closers = [];
    if (preg_match_all(self::SHORTCODE, $text, $all, PREG_SET_ORDER)) { foreach ($all as $m) { if ($m[1] === '/') { $closers[$m[2]] = true; } } }
    $highlighted = false;
    $out = preg_replace_callback(self::SHORTCODE, function ($m) use ($node, &$st, $closers, &$highlighted) {
      $name = $m[2];
      if ($m[1] === '/') { if ($name === 'highlight') { $highlighted = true; } return $name === 'highlight' ? "\n" . self::FENCE . "\n" : ''; }
      $args = self::shortcodeArgs($m[3]);
      $first = $args['positional'] ? $args['positional'][0] : '';
      if ($name === 'ref' || $name === 'relref') { return $first === '' ? '' : self::refTarget($first, $node, $st); }
      if ($name === 'figure') {
        $src = ($args['named']['src'] ?? '') !== '' ? $args['named']['src'] : $first;
        if ($src !== '') {
          $caption = ($args['named']['caption'] ?? '') !== '' ? $args['named']['caption'] : ($args['named']['title'] ?? '');
          $alt = ($args['named']['alt'] ?? '') !== '' ? $args['named']['alt'] : $caption;
          return "\n\n<img src=\"" . self::escAttr($src) . '" alt="' . self::escAttr($alt) . "\">\n\n" . ($caption === '' ? '' : "*$caption*\n\n");
        }
      }
      if ($name === 'youtube' || $name === 'vimeo') {
        $id = ($args['named']['id'] ?? '') !== '' ? $args['named']['id'] : $first;
        if (preg_match('/^[A-Za-z0-9_-]+$/D', $id)) { return "\n\n<video-player source=\"" . ($name === 'youtube' ? 'https://www.youtube.com/watch?v=' : 'https://vimeo.com/') . $id . "\"></video-player>\n\n"; }
      }
      if ($name === 'highlight' && isset($closers[$name])) { return "\n" . self::FENCE . (preg_match('/^[A-Za-z0-9_+-]+$/D', $first) ? $first : '') . "\n"; }
      if ($name === 'param' && is_string($st['params'][$first] ?? null)) { return $st['params'][$first]; }
      self::bump($st, 'shortcode:' . $name);
      return '';
    }, $text);
    // the code sits on its own lines between the highlight tags: no blank line inside the fence made for it
    return $highlighted ? preg_replace('/\n(\n\x60{3}\n)/', '$1', preg_replace('/(\n\x60{3}[A-Za-z0-9_+-]*\n)\n/', '$1', $out)) : $out;
  }

  /**
   * Hugo's additions to markdown, outside fenced code: the summary divider (<!--more-->) goes, {#id .class} attribute
   * blocks go, and shortcodes are replaced or removed (and counted).
   */
  private static function prepare($body, $node, &$st) {
    $out = []; $chunk = []; $fenced = false;
    foreach (explode("\n", $body) as $line) {
      if (preg_match('/^\s*(\x60{3}|~~~)/', $line)) {
        if ($chunk) { $out[] = self::shortcodes(implode("\n", $chunk), $node, $st); $chunk = []; }
        $out[] = $line; $fenced = !$fenced; continue;
      }
      if ($fenced) { $out[] = $line; continue; }
      $l = str_replace('<!--more-->', '', $line);
      $cut = preg_replace('/\{[.#][^{}]*\}[ \t]*$/D', '', $l);
      $chunk[] = $cut === $l ? $l : rtrim($cut, " \t");
    }
    if ($chunk) { $out[] = self::shortcodes(implode("\n", $chunk), $node, $st); }
    return implode("\n", $out);
  }

  private static function markdown($ctx, $text) {
    if (trim($text) === '') { return ''; }
    $r = $ctx->contracts->call('import.file', 'convert', ['name' => 'page.md', 'data' => base64_encode("\n" . $text)]);
    if (!is_array($r) || !is_string($r['html'] ?? null)) { throw new Exception('markdown could not be converted: ' . ((is_array($r) && !empty($r['error'])) ? $r['error'] : 'no result')); }
    return $r['html'];
  }

  // ---- links and media ----

  /** A reference as a path on the site ("/x/y") when it is written against the site's own address, else as written. */
  private static function onSite($ref, $st) {
    $len = strlen($st['baseUrl']);
    if ($len > 0 && strncmp(strtolower($ref), $st['baseUrl'], $len) === 0) {
      $rest = (string) substr($ref, $len);
      if ($rest === '') { return '/'; }
      return $rest[0] === '/' ? $rest : $ref;
    }
    return $ref;
  }
  /** A site path without the folder the site is served from (baseURL https://example.org/docs/ -> /docs). */
  private static function withoutBasePath($path, $st) {
    $base = $st['basePath'];
    if ($base === '' || !($path === '/' . $base || strncmp($path, '/' . $base . '/', strlen($base) + 2) === 0)) { return $path; }
    $rest = (string) substr($path, strlen($base) + 1);
    return $rest === '' ? '/' : $rest;
  }

  /** The file a page's reference points at, or null: beside the page (a bundle's resource), or under static/ or assets/. */
  private static function mediaPath($ref, $node, $st) {
    $clean = rawurldecode(self::withoutQuery(self::onSite($ref, $st)));
    if ($clean === '' || self::isExternal($clean)) { return null; }
    $candidates = [];
    if ($clean[0] === '/') {
      $path = (string) substr(self::withoutBasePath($clean, $st), 1);
      $candidates = [$st['dir'] . 'static/' . $path, $st['dir'] . 'assets/' . $path, $st['contentRoot'] . $path];
    } else {
      $candidates[] = $st['contentRoot'] . $node['resDir'] . '/' . $clean;
      if ($node['kind'] === 'page') { $candidates[] = $st['contentRoot'] . $node['key'] . '/' . $clean; }
      $candidates[] = $st['dir'] . 'static/' . $clean;
    }
    foreach ($candidates as $c) { $n = self::normalizePath($c); if (isset($st['src']['paths'][$n])) { return $n; } }
    return null;
  }

  private static function uniqueFileName($repoPath, &$st) {
    $parts = explode('/', $repoPath);
    $base = preg_replace('/[^A-Za-z0-9._-]+/', '-', end($parts));
    if (!isset($st['fileNames'][$base])) { $st['fileNames'][$base] = true; return $base; }
    $dot = strrpos($base, '.');
    $stem = $dot === false ? $base : substr($base, 0, $dot);
    $ext = $dot === false ? '' : substr($base, $dot);
    $n = 1;
    while (isset($st['fileNames']["$stem-$n$ext"])) { $n++; }
    $st['fileNames']["$stem-$n$ext"] = true;
    return "$stem-$n$ext";
  }

  /** A file of the site that a page uses, added to the list for the new site's files/ folder; its site path, or null. */
  private static function registerAsset($ref, $node, &$st) {
    if (!is_string($ref) || $ref === '') { return null; }
    $repoPath = self::mediaPath($ref, $node, $st);
    if ($repoPath === null || !preg_match(self::IMPORTABLE, $repoPath)) { return null; }
    if (isset($st['filesByPath'][$repoPath])) { return $st['filesByPath'][$repoPath]; }
    $path = 'files/' . self::uniqueFileName($repoPath, $st);
    $st['media'][] = ['path' => $path, 'repoPath' => $repoPath];
    $st['filesByPath'][$repoPath] = $path;
    return $path;
  }

  /** The imported page a link points at: by its address on the site, or by its content file, or null. */
  private static function pageSlug($href, $node, $st) {
    $target = rawurldecode(self::withoutQuery(self::onSite($href, $st)));
    if ($target === '' || self::isExternal($target)) { return null; }
    $candidates = $target[0] === '/' ? [self::withoutBasePath($target, $st), $target] : [$node['url'] . '/' . $target, $node['resDir'] . '/' . $target];
    foreach ($candidates as $c) {
      $k = self::normKey(self::normalizePath($c));
      if (isset($st['slugByKey'][$k])) { return $st['slugByKey'][$k]; }
    }
    return null;
  }

  /** Images become media-image, links between pages point at the imported slugs, files join the file list. */
  private static function rewrite($html, $node, &$st) {
    $html = preg_replace_callback('/<img\b[^>]*>/i', function ($t) use ($node, &$st) {
      $tag = $t[0];
      if (!preg_match('/\ssrc="([^"]*)"/i', $tag, $src) || $src[1] === '') { return $tag; }
      $alt = preg_match('/\salt="([^"]*)"/i', $tag, $a) ? $a[1] : '';
      $file = self::registerAsset($src[1], $node, $st);
      $source = $file !== null ? $file : ((self::isExternal($src[1]) && preg_match(self::IMAGE, self::withoutQuery($src[1]))) ? $src[1] : null);
      return $source === null ? $tag : '<media-image source="' . self::escAttr($source) . '" alt="' . self::escAttr($alt) . '"></media-image>';
    }, $html);
    return preg_replace_callback('/(<a\b[^>]*?\shref=")([^"]*)(")/i', function ($m) use ($node, &$st) {
      $href = $m[2];
      if ($href === '' || $href[0] === '#') { return $m[0]; }
      $slug = self::pageSlug($href, $node, $st);
      if ($slug !== null) { $hash = strpos($href, '#'); return $m[1] . $slug . ($hash === false ? '' : substr($href, $hash)) . $m[3]; }
      $file = self::registerAsset($href, $node, $st);
      return $file === null ? $m[0] : $m[1] . self::escAttr($file) . $m[3];
    }, $html);
  }

  private static function renderBody($ctx, $node, &$st) {
    $html = $node['ext'] === 'html' ? self::shortcodes($node['body'], $node, $st) : self::markdown($ctx, self::prepare($node['body'], $node, $st));
    return trim(self::strip(self::rewrite($html, $node, $st)));
  }

  // ---- the import ----

  private function importSite($ctx, $src) {
    $from = $src['repo'] ?: $src['name'];
    $found = self::findSite($src['list']);
    if ($found === null) { return ['error' => "no Hugo site found in $from (expected hugo.toml, hugo.yaml or hugo.json, or config.* beside a content folder)"]; }
    $dir = $found['dir'];

    // configuration: the main file, plus params.* and languages.* when the site splits its config into config/_default
    $pickFirst = function ($stem) use ($dir, $src) {
      foreach (['toml', 'yaml', 'yml', 'json'] as $e) { $p = $dir . 'config/_default/' . $stem . '.' . $e; if (isset($src['paths'][$p])) { return $p; } }
      return null;
    };
    $extra = ['params' => $pickFirst('params'), 'languages' => $pickFirst('languages')];
    $configPaths = [];
    foreach ([$found['config'], $extra['params'], $extra['languages']] as $p) { if (is_string($p)) { $configPaths[] = $p; } }
    $configTexts = ($src['readMany'])($configPaths, false);
    $parsed = function ($p) use ($ctx, $configTexts) {
      if (!is_string($p) || !is_string($configTexts[$p] ?? null)) { return []; }
      $r = $ctx->contracts->call('import-frontmatter.data', 'parse', ['format' => self::formatOf($p), 'text' => $configTexts[$p]]);
      if (!is_array($r) || (!array_key_exists('data', $r) && !array_key_exists('error', $r))) { throw new Exception('front matter could not be read: import-frontmatter gave no result'); }
      return self::mapOf($r['data'] ?? null);
    };
    $config = $parsed($found['config']);
    $params = $extra['params'] ? $parsed($extra['params']) : self::mapOf($config['params'] ?? null);
    $languages = $extra['languages'] ? $parsed($extra['languages']) : self::mapOf($config['languages'] ?? null);
    $defaultLang = self::stringOf($config['defaultContentLanguage'] ?? null);
    if ($defaultLang === '') { $defaultLang = 'en'; }
    $langs = [$defaultLang => true];
    foreach (array_keys($languages) as $l) { $langs[(string) $l] = true; }
    $contentDir = self::stringOf(self::mapOf($languages[$defaultLang] ?? null)['contentDir'] ?? null);
    if ($contentDir === '') { $contentDir = self::stringOf($config['contentDir'] ?? null); }
    if ($contentDir === '') { $contentDir = 'content'; }
    $contentRoot = $dir . trim($contentDir, '/') . '/';
    $baseUrl = strtolower(rtrim(self::stringOf($config['baseURL'] ?? null), '/'));
    $basePath = preg_match('~^[a-z][a-z0-9+.-]*://[^/]+/(.+)$~D', $baseUrl, $bp) ? trim($bp[1], '/') : '';

    $nodes = self::readContent($src, $contentRoot, $langs, $defaultLang);
    if (!$nodes) { return ['error' => "no pages found under $contentRoot in $from"]; }

    // the first MAX_PAGES page files are read in one call, in path order, and their front matter split in one call
    $wanted = []; $truncated = false;
    foreach ($nodes as $k => $n) {
      if (!$n['file']) { continue; }
      if (count($wanted) >= self::MAX_PAGES) { $nodes[$k]['capped'] = true; $truncated = true; continue; }
      $wanted[] = $n['key'];
    }
    $wantedFiles = [];
    foreach ($wanted as $key) { $wantedFiles[] = $nodes[$key]['file']; }
    $texts = ($src['readMany'])($wantedFiles, false);
    $readable = []; $readableTexts = [];
    foreach ($wanted as $key) { $t = $texts[$nodes[$key]['file']] ?? null; if (is_string($t)) { $readable[] = $key; $readableTexts[] = $t; } }
    $splitAll = $readable ? $ctx->contracts->call('import-frontmatter.data', 'split', ['texts' => $readableTexts]) : ['results' => []];
    if (!is_array($splitAll) || !isset($splitAll['results']) || !is_array($splitAll['results'])) { throw new Exception('front matter could not be read: ' . ((is_array($splitAll) && !empty($splitAll['error'])) ? $splitAll['error'] : 'no result')); }
    foreach ($readable as $i => $key) {
      $r = is_array($splitAll['results'][$i] ?? null) ? $splitAll['results'][$i] : [];
      $data = self::mapOf($r['data'] ?? null);
      $body = is_string($r['body'] ?? null) ? $r['body'] : '';
      $title = self::stringOf($data['title'] ?? null);
      if ($title === '' && $nodes[$key]['ext'] !== 'html') {
        // a page with no title in its front matter is titled by its first level-one heading
        $lines = explode("\n", $body);
        $at = 0;
        while ($at < count($lines) && trim($lines[$at]) === '') { $at++; }
        $h = $at < count($lines) ? self::headingOne($lines[$at]) : '';
        if ($h !== '') { $title = $h; array_splice($lines, $at, 1); $body = implode("\n", $lines); }
      }
      $nodes[$key]['data'] = $data;
      $nodes[$key]['body'] = $body;
      $nodes[$key]['title'] = $title;
      $nodes[$key]['weight'] = self::intOf($data['weight'] ?? null);
      $nodes[$key]['created'] = self::parseDate(self::stringOf($data['date'] ?? null));
    }
    $siteTitle = self::stringOf($config['title'] ?? null);
    if ($siteTitle === '') { $siteTitle = self::stringOf(self::mapOf($languages[$defaultLang] ?? null)['title'] ?? null); }
    if ($siteTitle === '') { $siteTitle = $src['name']; }
    foreach ($nodes as $k => $n) { if ($n['title'] === '') { $nodes[$k]['title'] = $n['key'] === '' ? $siteTitle : self::titleFromName($n['name']); } }

    $st = [
      'src' => $src, 'dir' => $dir, 'contentRoot' => $contentRoot, 'baseUrl' => $baseUrl, 'basePath' => $basePath, 'params' => $params,
      'unmapped' => [], 'media' => [], 'fileNames' => [], 'filesByPath' => [], 'slugByKey' => [], 'slugByName' => [],
    ];
    $items = []; $outline = []; $used = [];
    $languageFiles = 0;
    $add = function ($key, $parentIndex, $order, $depth, $parentUrl) use (&$nodes, &$items, &$outline, &$used, &$st, &$languageFiles, $contentRoot) {
      $n = $nodes[$key];
      $seg = self::stringOf($n['data']['slug'] ?? null);
      if ($seg === '') { $seg = $n['name']; }
      $own = $key === '' ? self::titleSlug($n['title']) : self::titleSlug($seg);
      $slug = $parentIndex !== null ? $items[$parentIndex]['slug'] . '/' . $own : $own;
      for ($i = 2, $s = $slug; isset($used[$slug]); $i++) { $slug = "$s-$i"; }
      $used[$slug] = true;
      $metadata = ['sourceType' => 'hugo', 'hugo' => ['path' => $n['file'] ?: $contentRoot . $key, 'kind' => $key === '' ? 'home' : $n['kind']]];
      if (self::isTrue($n['data']['headless'] ?? null)) { $metadata['hideInMenu'] = true; }
      if (self::isTrue($n['data']['draft'] ?? null)) { $metadata['published'] = false; }
      if ($n['created'] !== null) { $metadata['created'] = $n['created']; }
      $tags = self::stringList($n['data']['tags'] ?? null);
      if ($tags) { $metadata['tags'] = $tags; }
      $index = count($items);
      $items[] = ['id' => 'item-' . ($index + 1), 'title' => $n['title'], 'slug' => $slug, 'parent' => $parentIndex !== null ? $items[$parentIndex]['id'] : null, 'order' => $order, 'indent' => $depth, 'content' => '<p></p>', 'metadata' => $metadata];
      $outline[] = ['key' => $key, 'index' => $index];
      $languageFiles += $n['others'];
      // links reach a page by its address (folders and slug, lower case), by url and aliases in its front matter, or by its content file
      $url = $key === '' ? '' : $parentUrl . '/' . str_replace(' ', '-', strtolower($seg));
      $nodes[$key]['url'] = $url;
      $keys = array_merge([$key, $url, self::stringOf($n['data']['url'] ?? null)], self::stringList($n['data']['aliases'] ?? null));
      foreach ($keys as $k) { if ($k !== '' || $key === '') { $nk = self::normKey($k); if (!isset($st['slugByKey'][$nk])) { $st['slugByKey'][$nk] = $slug; } } }
      if ($key !== '') { $nm = strtolower($n['name']); $st['slugByName'][$nm] = array_key_exists($nm, $st['slugByName']) ? null : $slug; }
      return $index;
    };
    $walk = function ($parentKey, $parentIndex, $parentUrl, $depth, $first) use (&$walk, &$add, &$nodes) {
      $kids = [];
      foreach ($nodes as $n) { if ($n['parent'] === $parentKey) { $kids[] = $n; } }
      usort($kids, [self::class, 'pageOrder']);
      $order = $first;
      foreach ($kids as $n) {
        $index = $add($n['key'], $parentIndex, $order++, $depth, $parentUrl);
        $walk($n['key'], $index, $nodes[$n['key']]['url'], $depth + 1, 0);
      }
    };
    // the home page (content/_index.md) goes first, beside the top-level sections and pages
    $home = isset($nodes['']);
    if ($home) { $add('', null, 0, 0, ''); }
    $walk('', null, '', 0, $home ? 1 : 0);

    foreach ($outline as $o) {
      $node = $nodes[$o['key']];
      $html = $node['body'] === null ? '' : self::renderBody($ctx, $node, $st);
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

    // content in formats Hugo converts with outside tools is not read; it is counted, per format
    $skip = strlen($contentRoot);
    foreach ($src['list'] as $p) { if (strncmp($p, $contentRoot, $skip) === 0 && preg_match(self::OTHER_FORMAT, $p, $m)) { self::bump($st, 'format:' . $m[1]); } }

    $out = ['title' => $siteTitle, 'items' => $items, 'files' => $files];
    $description = self::stringOf($params['description'] ?? null);
    if ($description !== '') { $out['site'] = ['description' => $description]; }
    if ($truncated) { $out['truncated'] = true; }
    $out['stats'] = ['pages' => count($items), 'media' => count($files), 'languageFiles' => $languageFiles];
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
   * Reads a Hugo site from a GitHub repository (or an uploaded zip of one): one page per section, page bundle and
   * content file, in Hugo's own order (weight, then newest first), titled, dated and tagged from front matter in
   * YAML, TOML or JSON, with the built-in shortcodes that have a plain equivalent converted, links between pages
   * pointed at the imported slugs, and the images and files pages use listed for the new site. Templates, themes
   * and custom shortcodes are not run; what was left out is counted in stats.
   *
   * @param object $ctx    Platform context (spec/13); the repository or zip is read through import-source.tree, so nothing is fetched here.
   * @param array  $input  [url] of the repository (https://github.com/<owner>/<repo>, optionally /tree/<branch>), or [files => [[name, data (base64 zip)]]].
   * @return array  [title, items, files, site?, truncated?, stats] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    $input = $input ?: [];
    try {
      if (!empty($input['files']) && is_array($input['files'])) {
        $f = is_array($input['files'][0] ?? null) ? $input['files'][0] : [];
        if (!preg_match('/\.zip$/i', (string) ($f['name'] ?? ''))) { return ['error' => 'expected a .zip of the Hugo site']; }
      } elseif (empty($input['url'])) { return ['error' => 'url or files is required']; }
      $src = $this->openSource($ctx, $input);
      if (isset($src['error'])) { return $src; }
      return $this->importSite($ctx, $src);
    } catch (Exception $e) {
      return ['error' => $e->getMessage()];
    }
  }
}

<?php
// Grav importer (PHP). Mirrors src/nodejs/index.js; both return identical results.
// Reads a Grav site's pages folder as data: every folder under user/pages is a page, its numeric prefix (01.home) gives
// order and menu visibility, its markdown file names the template, and its YAML header carries title, slug, dates and
// taxonomy. Modules (_folders) fold into their page. Nothing of Grav is run: no Twig, no plugins, no theme.
// The repository or zip is listed and read through import-source.tree; markdown goes to import.file (import-markdown).
class ImporterGravPlugin {
  const MAX_PAGES = 500;
  const IMPORTABLE = '/\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|xml)$/iD';
  const IMAGE = '/\.(jpg|jpeg|png|gif|webp)$/iD';
  // <template>.md or <template>.<lang>.md (default.md, blog.md, default.fr.md)
  const PAGE_FILE = '/^(.+?)(?:\.([a-z]{2,3}(?:-[A-Za-z]{2})?))?\.md$/D';
  const NUMBERED = '/^(\d+)\.(.+)$/D';
  // what is read as text out of a zip: pages and configuration
  const SOURCE_TEXT = '\.(md|yaml)$';
  const SHORTCODE = '/\[(\/?)([A-Za-z][A-Za-z0-9_-]*)((?:[ =][^\]\n]*)?)\]/';

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

  // ---- Grav helpers ----

  private static function isFalse($v) { return in_array(strtolower(trim(is_scalar($v) ? (string) $v : '')), ['false', '0', 'no', 'off'], true); }
  private static function isTrue($v) { return in_array(strtolower(trim(is_scalar($v) ? (string) $v : '')), ['true', '1', 'yes', 'on'], true); }
  private static function mapOf($v) { return self::isObject($v) ? $v : []; }
  /** A list of non-empty strings out of a YAML list or a single value. */
  private static function stringList($v) {
    $out = [];
    foreach ((is_array($v) && array_is_list($v)) ? $v : [$v] as $x) { if (is_string($x) && trim($x) !== '') { $out[] = trim($x); } }
    return $out;
  }
  /** A folder name: its ordering prefix (01.), the name Grav routes by, and whether it is a module (_name). */
  private static function segment($seg) {
    $numbered = (bool) preg_match(self::NUMBERED, $seg, $m);
    $name = $numbered ? $m[2] : $seg;
    return ['numbered' => $numbered, 'name' => $name, 'modular' => strncmp($name, '_', 1) === 0];
  }
  private static function prefixless($path) {
    if ($path === '') { return ''; }
    $out = [];
    foreach (explode('/', $path) as $s) { $out[] = self::segment($s)['name']; }
    return implode('/', $out);
  }
  private static function titleFromName($name) {
    $t = trim(preg_replace('/[-_]+/', ' ', preg_replace('/^_+/', '', $name)));
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
   * Seconds since 1970 (UTC) for the date formats Grav documents: 2026-03-09 14:30, 17:34 07/04/2014 (month/day/year)
   * and 09-03-2026 or 09.03.2026 (day-month-year). null when the text is none of them.
   */
  public static function parseDate($text) {
    $s = trim(is_scalar($text) ? (string) $text : '');
    if (preg_match('/(\d{4})-(\d{1,2})-(\d{1,2})/', $s, $m)) { $y = (int) $m[1]; $mo = (int) $m[2]; $d = (int) $m[3]; }
    elseif (preg_match('/(\d{1,2})\/(\d{1,2})\/(\d{4})/', $s, $m)) { $mo = (int) $m[1]; $d = (int) $m[2]; $y = (int) $m[3]; }
    elseif (preg_match('/(\d{1,2})[-.](\d{1,2})[-.](\d{4})/', $s, $m)) { $d = (int) $m[1]; $mo = (int) $m[2]; $y = (int) $m[3]; }
    else { return null; }
    if ($mo < 1 || $mo > 12 || $d < 1 || $d > 31) { return null; }
    $at = (int) strpos($s, $m[0]);
    $rest = substr($s, 0, $at) . ' ' . substr($s, $at + strlen($m[0]));
    $has = preg_match('/(\d{1,2}):(\d{2})(?::(\d{2}))?/', $rest, $t);
    $h = $has ? (int) $t[1] : 0;
    $mi = $has ? (int) $t[2] : 0;
    $sec = ($has && isset($t[3])) ? (int) $t[3] : 0;
    if ($h > 23 || $mi > 59 || $sec > 59) { return null; }
    return gmmktime($h, $mi, $sec, $mo, $d, $y);
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
   * Where the pages are: a whole Grav install (user/pages/), the user folder on its own as Git Sync keeps it (pages/),
   * or the pages folder itself (numbered folders at the top). `user` is where config/ and images/ sit, or null.
   */
  public static function findRoot($list) {
    foreach (['user/pages/', 'pages/'] as $pages) {
      foreach ($list as $p) {
        if (strncmp($p, $pages, strlen($pages)) === 0 && preg_match('/^[^\/]+\/(?:.+\/)?[^\/]+\.md$/D', substr($p, strlen($pages)))) {
          return ['pages' => $pages, 'user' => substr($pages, 0, strlen($pages) - 6)];
        }
      }
    }
    foreach ($list as $p) { if (preg_match('/^\d+\.[^\/]+\/(?:.+\/)?[^\/]+\.md$/D', $p)) { return ['pages' => '', 'user' => null]; } }
    return null;
  }

  // ---- the outline: one page per folder ----

  /** Every folder under the pages root that holds a markdown file, and its ancestors: [dir => [markdown file names]]. */
  private static function readFolders($src, $root) {
    $folders = [];
    $skip = strlen($root['pages']);
    foreach ($src['list'] as $p) {
      if (strncmp($p, $root['pages'], $skip) !== 0 || !preg_match('/\.md$/D', $p)) { continue; }
      $rel = substr($p, $skip);
      $cut = strrpos($rel, '/');
      if ($cut === false) { continue; }
      $segs = explode('/', substr($rel, 0, $cut));
      for ($i = 1; $i <= count($segs); $i++) { $d = implode('/', array_slice($segs, 0, $i)); if (!isset($folders[$d])) { $folders[$d] = []; } }
      $folders[substr($rel, 0, $cut)][] = substr($rel, $cut + 1);
    }
    return $folders;
  }

  /** The page file of a folder: one without a language, else the site's language, else the first by name. */
  private static function pickFile($mds, $lang) {
    usort($mds, [self::class, 'byText']);
    $best = null;
    foreach ($mds as $f) {
      if (!preg_match(self::PAGE_FILE, $f, $m)) { continue; }
      $l = isset($m[2]) ? $m[2] : '';
      $rank = $l === '' ? 0 : ($l === $lang ? 1 : 2);
      if ($best === null || $rank < $best['rank']) { $best = ['file' => $f, 'template' => $m[1], 'rank' => $rank]; }
    }
    return $best;
  }

  /** One node per folder that is not inside a module, in path order: [dir => node]. */
  private static function buildNodes($folders, $lang) {
    $dirs = array_map('strval', array_keys($folders));
    usort($dirs, [self::class, 'byText']);
    $nodes = [];
    foreach ($dirs as $dir) {
      $segs = explode('/', $dir);
      $inModule = false;
      foreach (array_slice($segs, 0, -1) as $s) { if (self::segment($s)['modular']) { $inModule = true; } }
      if ($inModule) { continue; }
      $me = self::segment($segs[count($segs) - 1]);
      $pick = self::pickFile($folders[$dir], $lang);
      $nodes[$dir] = [
        'dir' => $dir, 'name' => $me['name'], 'numbered' => $me['numbered'], 'modular' => $me['modular'], 'parent' => implode('/', array_slice($segs, 0, -1)),
        'file' => $pick ? $dir . '/' . $pick['file'] : null, 'template' => $pick ? $pick['template'] : '', 'others' => $pick ? count($folders[$dir]) - 1 : 0,
        'header' => [], 'body' => null, 'title' => '', 'created' => null, 'capped' => false,
      ];
    }
    return $nodes;
  }

  /** Front matter and configuration are read by import-frontmatter.data; this is its result, or an error. */
  private static function frontMatterCall($ctx, $op, $input) {
    $r = $ctx->contracts->call('import-frontmatter.data', $op, $input);
    $ok = is_array($r) && ($op === 'split' ? (isset($r['results']) && is_array($r['results'])) : (array_key_exists('data', $r) || array_key_exists('error', $r)));
    if (!$ok) { throw new Exception('front matter could not be read: ' . ((is_array($r) && !empty($r['error'])) ? $r['error'] : 'no result')); }
    return $r;
  }

  /** Header, body, title and date of a node from its page file, split by import-frontmatter. */
  private static function readNode(&$node, $fm) {
    $node['header'] = self::mapOf($fm['data'] ?? null);
    $body = $fm['body'];
    $title = self::stringOf($node['header']['title'] ?? null);
    if ($title === '') {
      // a page with no title in its header is titled by its first level-one heading
      $lines = explode("\n", $body);
      $i = 0;
      while ($i < count($lines) && trim($lines[$i]) === '') { $i++; }
      $h = $i < count($lines) ? self::headingOne($lines[$i]) : '';
      if ($h !== '') { $title = $h; array_splice($lines, $i, 1); $body = implode("\n", $lines); }
    }
    $node['title'] = $title;
    $node['body'] = $body;
    $node['created'] = self::parseDate(self::stringOf($node['header']['date'] ?? null));
  }

  /** The folders directly under a parent, in the order Grav lists them: pages and modules apart (as dirs). */
  private static function childrenOf($nodes, $parent) {
    $pages = []; $modules = [];
    foreach ($nodes as $n) { if ($n['parent'] === $parent) { if ($n['modular']) { $modules[] = $n['dir']; } else { $pages[] = $n['dir']; } } }
    return ['pages' => $pages, 'modules' => $modules];
  }

  /** Whether a page lists its child pages itself (a blog: content.items '@self.children'), so they need no menu prefix. */
  private static function listsChildren($node) {
    return $node !== null && in_array('@self.children', self::stringList(self::mapOf($node['header']['content'] ?? null)['items'] ?? null), true);
  }

  /** Children by folder name, or by date when the parent's header asks (content.order.by: date, dir: asc | desc). */
  private static function orderPages($pages, $parentNode, $nodes) {
    $order = self::mapOf(self::mapOf($parentNode !== null ? ($parentNode['header']['content'] ?? null) : null)['order'] ?? null);
    if (self::stringOf($order['by'] ?? null) !== 'date') { return $pages; }
    $sign = strtolower(self::stringOf($order['dir'] ?? null)) === 'desc' ? -1 : 1;
    usort($pages, function ($x, $y) use ($nodes, $sign) {
      $a = $nodes[$x]['created']; $b = $nodes[$y]['created'];
      if ($a === null || $b === null) { return $a === $b ? 0 : ($a === null ? 1 : -1); }
      return $a === $b ? 0 : ($a < $b ? -1 : 1) * $sign;
    });
    return $pages;
  }

  /** Modules in the page's own order (content.order.custom lists folder names), then the rest by folder name. */
  private static function orderModules($modules, $node, $nodes) {
    $custom = self::stringList(self::mapOf(self::mapOf($node['header']['content'] ?? null)['order'] ?? null)['custom'] ?? null);
    $out = [];
    foreach ($custom as $c) { foreach ($modules as $m) { if ($nodes[$m]['name'] === $c && !in_array($m, $out, true)) { $out[] = $m; } } }
    foreach ($modules as $m) { if (!in_array($m, $out, true)) { $out[] = $m; } }
    return $out;
  }

  // ---- page bodies ----

  private static function bump(&$st, $key) { $st['unmapped'][$key] = ($st['unmapped'][$key] ?? 0) + 1; }

  /**
   * Grav's additions to markdown, outside fenced code: the summary delimiter (===) goes, notice lines (! text) become
   * quotes, {.class} attribute blocks go, Twig goes when the page processes it, and shortcode tags that have a closing
   * tag ([name]...[/name]) are removed around their content. Twig and shortcodes are counted, never dropped silently.
   */
  private static function prepare($body, $twig, &$st) {
    $parts = []; $chunk = []; $fenced = false;
    foreach (explode("\n", $body) as $line) {
      if (preg_match('/^\s*(```|~~~)/', $line)) {
        if ($chunk) { $parts[] = ['text' => implode("\n", $chunk)]; $chunk = []; }
        $parts[] = ['code' => $line]; $fenced = !$fenced; continue;
      }
      if ($fenced) { $parts[] = ['code' => $line]; continue; }
      if (trim($line) === '===') { continue; }
      $l = preg_match('/^(!{1,4})[ \t]+(.+)$/D', $line, $notice) ? '> ' . $notice[2] : $line;
      $cut = preg_replace('/\{[.#][^{}]*\}[ \t]*$/D', '', $l);
      $chunk[] = $cut === $l ? $l : rtrim($cut, " \t");
    }
    if ($chunk) { $parts[] = ['text' => implode("\n", $chunk)]; }
    $closers = [];
    foreach ($parts as $p) {
      if (isset($p['text']) && preg_match_all('/\[\/([A-Za-z][A-Za-z0-9_-]*)\]/', $p['text'], $all)) { foreach ($all[1] as $name) { $closers[$name] = true; } }
    }
    $out = [];
    foreach ($parts as $p) {
      if (!isset($p['text'])) { $out[] = $p['code']; continue; }
      $t = $p['text'];
      if ($twig) { $t = preg_replace_callback('/\{#[\s\S]*?#\}|\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/', function () use (&$st) { self::bump($st, 'twig'); return ''; }, $t); }
      if ($closers) {
        $t = preg_replace_callback(self::SHORTCODE, function ($m) use (&$st, $closers) {
          if (!isset($closers[$m[2]])) { return $m[0]; }
          if ($m[1] === '') { self::bump($st, 'shortcode:' . $m[2]); }
          return '';
        }, $t);
      }
      $out[] = $t;
    }
    return implode("\n", $out);
  }

  private static function markdown($ctx, $text) {
    if (trim($text) === '') { return ''; }
    $r = $ctx->contracts->call('import.file', 'convert', ['name' => 'page.md', 'data' => base64_encode("\n" . $text)]);
    if (!is_array($r) || !is_string($r['html'] ?? null)) { throw new Exception('markdown could not be converted: ' . ((is_array($r) && !empty($r['error'])) ? $r['error'] : 'no result')); }
    return $r['html'];
  }

  // ---- links and media ----

  private static function withoutQuery($ref) { return explode('?', explode('#', $ref)[0])[0]; }

  /** The file a page's reference points at, or null: beside the page, by folder or route, or through a Grav stream. */
  private static function mediaPath($ref, $baseDir, $st) {
    $clean = rawurldecode(self::withoutQuery($ref));
    if ($clean === '') { return null; }
    $root = $st['root'];
    $candidates = [];
    $stream = (bool) preg_match('/^(image|user|page|theme):\/\/(.*)$/D', $clean, $s);
    if ($stream) {
      if ($s[1] === 'page') { $candidates[] = $root['pages'] . $s[2]; }
      elseif ($root['user'] !== null && $s[1] === 'image') { $candidates[] = $root['user'] . 'images/' . $s[2]; }
      elseif ($root['user'] !== null && $s[1] === 'user') { $candidates[] = $root['user'] . $s[2]; }
    } elseif (self::isExternal($clean)) { return null; }
    elseif ($clean[0] === '/') {
      if ($root['user'] !== null && strncmp($clean, '/user/', 6) === 0) { $candidates[] = $root['user'] . substr($clean, 6); }
      $candidates[] = $root['pages'] . substr($clean, 1);
    } else { $candidates[] = $root['pages'] . $baseDir . '/' . $clean; }
    foreach ($candidates as $c) { $n = self::normalizePath($c); if (isset($st['src']['paths'][$n])) { return $n; } }
    if ($stream) { return null; }
    // the folder written the way Grav routes it (../other-page/photo.jpg for 02.other-page)
    $cut = strrpos($clean, '/');
    $folder = $cut === false ? '' : substr($clean, 0, $cut);
    $key = self::prefixless(self::normalizePath($clean[0] === '/' ? $folder : $baseDir . '/' . $folder));
    if (!isset($st['dirByKey'][$key])) { return null; }
    $n = $root['pages'] . $st['dirByKey'][$key] . '/' . ($cut === false ? $clean : substr($clean, $cut + 1));
    return isset($st['src']['paths'][$n]) ? $n : null;
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
  private static function registerAsset($ref, $baseDir, &$st) {
    if (!is_string($ref) || $ref === '') { return null; }
    $repoPath = self::mediaPath($ref, $baseDir, $st);
    if ($repoPath === null || !preg_match(self::IMPORTABLE, $repoPath)) { return null; }
    if (isset($st['filesByPath'][$repoPath])) { return $st['filesByPath'][$repoPath]; }
    $path = 'files/' . self::uniqueFileName($repoPath, $st);
    $st['media'][] = ['path' => $path, 'repoPath' => $repoPath];
    $st['filesByPath'][$repoPath] = $path;
    return $path;
  }

  /** The imported page a link points at (by route, by folder, with or without numeric prefixes), or null. */
  private static function pageSlug($href, $baseDir, $st) {
    $target = rawurldecode(self::withoutQuery($href));
    if ($target === '') { return null; }
    if (preg_match('/\.md$/D', $target)) { $cut = strrpos($target, '/'); $target = $cut === false ? '.' : substr($target, 0, $cut); }
    if ($target === '') { return null; }
    $key = self::prefixless(self::normalizePath($target[0] === '/' ? $target : $baseDir . '/' . $target));
    return ($key !== '' && isset($st['slugByKey'][$key])) ? $st['slugByKey'][$key] : null;
  }

  /** Images become media-image, links between pages point at the imported slugs, files join the file list. */
  private static function rewrite($html, $baseDir, &$st) {
    $html = preg_replace_callback('/<img\b[^>]*>/i', function ($t) use ($baseDir, &$st) {
      $tag = $t[0];
      if (!preg_match('/\ssrc="([^"]*)"/i', $tag, $src) || $src[1] === '') { return $tag; }
      $alt = preg_match('/\salt="([^"]*)"/i', $tag, $a) ? $a[1] : '';
      $file = self::registerAsset($src[1], $baseDir, $st);
      $source = $file !== null ? $file : ((self::isExternal($src[1]) && preg_match(self::IMAGE, self::withoutQuery($src[1]))) ? $src[1] : null);
      return $source === null ? $tag : '<media-image source="' . self::escAttr($source) . '" alt="' . self::escAttr($alt) . '"></media-image>';
    }, $html);
    return preg_replace_callback('/(<a\b[^>]*?\shref=")([^"]*)(")/i', function ($m) use ($baseDir, &$st) {
      $href = $m[2];
      if ($href === '' || $href[0] === '#') { return $m[0]; }
      if (!self::isExternal($href)) {
        $slug = self::pageSlug($href, $baseDir, $st);
        if ($slug !== null) { $hash = strpos($href, '#'); return $m[1] . $slug . ($hash === false ? '' : substr($href, $hash)) . $m[3]; }
      }
      $file = self::registerAsset($href, $baseDir, $st);
      return $file === null ? $m[0] : $m[1] . self::escAttr($file) . $m[3];
    }, $html);
  }

  private static function renderBody($ctx, $body, $heading, $node, &$st) {
    $twig = self::isTrue(self::mapOf($node['header']['process'] ?? null)['twig'] ?? null) || $st['twig'];
    $text = self::prepare($body, $twig, $st);
    if ($heading !== '' && !preg_match('/^\s*#/', $text)) { $text = "## $heading\n\n$text"; }
    return trim(self::strip(self::rewrite(self::markdown($ctx, $text), $node['dir'], $st)));
  }

  // ---- the import ----

  private function importSite($ctx, $src) {
    $root = self::findRoot($src['list']);
    $none = ['error' => 'no Grav pages found in ' . ($src['repo'] ?: $src['name']) . ' (expected user/pages/ or pages/ with a folder per page)'];
    if ($root === null) { return $none; }

    // configuration: the site's title and description, its language, its home page, whether pages run Twig
    $configPaths = [];
    if ($root['user'] !== null) { foreach ([$root['user'] . 'config/site.yaml', $root['user'] . 'config/system.yaml'] as $p) { if (isset($src['paths'][$p])) { $configPaths[] = $p; } } }
    $configs = ($src['readMany'])($configPaths, false);
    $yamlOf = function ($p) use ($ctx, $configs) { return is_string($configs[$p] ?? null) ? self::mapOf(self::frontMatterCall($ctx, 'parse', ['format' => 'yaml', 'text' => $configs[$p]])['data'] ?? null) : []; };
    $site = $root['user'] === null ? [] : $yamlOf($root['user'] . 'config/site.yaml');
    $system = $root['user'] === null ? [] : $yamlOf($root['user'] . 'config/system.yaml');
    $langs = self::stringList(self::mapOf($system['languages'] ?? null)['supported'] ?? null);
    $lang = $langs ? $langs[0] : '';
    $alias = self::stringOf(self::mapOf($system['home'] ?? null)['alias'] ?? null);
    $home = self::prefixless(self::normalizePath($alias !== '' ? $alias : '/home'));

    $nodes = self::buildNodes(self::readFolders($src, $root), $lang);
    if (!$nodes) { return $none; }

    // the first MAX_PAGES page files are read in one call, in folder order
    $wanted = []; $truncated = false;
    foreach ($nodes as $k => $n) {
      if (!$n['file']) { continue; }
      if (count($wanted) >= self::MAX_PAGES) { $nodes[$k]['capped'] = true; $truncated = true; continue; }
      $wanted[] = $root['pages'] . $n['file'];
    }
    $texts = ($src['readMany'])($wanted, false);
    // and their headers are split in one call
    $readable = []; $readableTexts = [];
    foreach ($nodes as $k => $n) {
      $text = ($n['file'] && !$n['capped']) ? ($texts[$root['pages'] . $n['file']] ?? null) : null;
      if (is_string($text)) { $readable[] = $k; $readableTexts[] = $text; }
    }
    $split = $readable ? self::frontMatterCall($ctx, 'split', ['texts' => $readableTexts])['results'] : [];
    foreach ($readable as $i => $k) { self::readNode($nodes[$k], (is_array($split[$i] ?? null) && is_string($split[$i]['body'] ?? null)) ? $split[$i] : ['data' => [], 'body' => '']); }

    $st = ['src' => $src, 'root' => $root, 'twig' => self::isTrue(self::mapOf(self::mapOf($system['pages'] ?? null)['process'] ?? null)['twig'] ?? null), 'unmapped' => [], 'media' => [], 'fileNames' => [], 'filesByPath' => [], 'slugByKey' => [], 'dirByKey' => []];
    $items = []; $outline = []; $used = [];
    $modules = 0; $languageFiles = 0;
    $walk = function ($parentDir, $parentNode, $parentIndex, $route, $depth) use (&$walk, &$nodes, &$items, &$outline, &$used, &$st, &$languageFiles, $root, $home) {
      $pages = self::orderPages(self::childrenOf($nodes, $parentDir)['pages'], $parentNode, $nodes);
      // the page Grav serves at / goes first, as the new site's home
      if ($parentDir === '') {
        foreach ($pages as $d) { if (self::prefixless($d) === $home) { $pages = array_merge([$d], array_values(array_filter($pages, function ($x) use ($d) { return $x !== $d; }))); break; } }
      }
      $order = 0;
      foreach ($pages as $dir) {
        $n = $nodes[$dir];
        $ownSlug = self::stringOf($n['header']['slug'] ?? null);
        $own = self::titleSlug($ownSlug !== '' ? $ownSlug : $n['name']);
        $slug = $parentIndex !== null ? $items[$parentIndex]['slug'] . '/' . $own : $own;
        for ($i = 2, $s = $slug; isset($used[$slug]); $i++) { $slug = "$s-$i"; }
        $used[$slug] = true;
        $metadata = ['sourceType' => 'grav', 'grav' => ['path' => $root['pages'] . ($n['file'] ?: $n['dir']), 'template' => $n['template']]];
        $visible = array_key_exists('visible', $n['header']) ? self::isTrue($n['header']['visible']) : ($n['numbered'] || self::listsChildren($parentNode));
        if (!$visible || (array_key_exists('routable', $n['header']) && self::isFalse($n['header']['routable']))) { $metadata['hideInMenu'] = true; }
        if (array_key_exists('published', $n['header']) && self::isFalse($n['header']['published'])) { $metadata['published'] = false; }
        if ($n['created'] !== null) { $metadata['created'] = $n['created']; }
        $tags = self::stringList(self::mapOf($n['header']['taxonomy'] ?? null)['tag'] ?? null);
        if ($tags) { $metadata['tags'] = $tags; }
        $index = count($items);
        $items[] = ['id' => 'item-' . ($index + 1), 'title' => $n['title'] !== '' ? $n['title'] : self::titleFromName($n['name']), 'slug' => $slug, 'parent' => $parentIndex !== null ? $items[$parentIndex]['id'] : null, 'order' => $order++, 'indent' => $depth, 'content' => '<p></p>', 'metadata' => $metadata];
        $outline[] = ['dir' => $dir, 'index' => $index];
        $languageFiles += $n['others'];
        // links reach a page by its folders (with or without prefixes) or by its route (header slugs)
        $here = $route . '/' . ($ownSlug !== '' ? $ownSlug : $n['name']);
        $st['slugByKey'][self::prefixless($dir)] = $slug;
        $st['slugByKey'][self::prefixless(self::normalizePath($here))] = $slug;
        $st['dirByKey'][self::prefixless($dir)] = $dir;
        $walk($dir, $n, $index, $here, $depth + 1);
      }
    };
    $walk('', null, null, '', 0);

    foreach ($outline as $o) {
      $node = $nodes[$o['dir']];
      $html = $node['body'] === null ? '' : self::renderBody($ctx, $node['body'], '', $node, $st);
      foreach (self::orderModules(self::childrenOf($nodes, $node['dir'])['modules'], $node, $nodes) as $md) {
        $m = $nodes[$md];
        $modules++;
        $languageFiles += $m['others'];
        if ($m['body'] !== null) { $html .= self::renderBody($ctx, $m['body'], $m['title'], $m, $st); }
      }
      $link = self::stringOf($node['header']['external_url'] ?? null);
      if ($link === '') { $link = preg_replace('/\[\d+\]$/D', '', self::stringOf($node['header']['redirect'] ?? null)); }
      if ($html === '' && $link !== '') { $html = '<p><a href="' . self::escAttr($link) . '">' . self::escAttr($items[$o['index']]['title']) . '</a></p>'; }
      $items[$o['index']]['content'] = $html === '' ? '<p></p>' : $html;
    }

    // media: a repository's files are fetched by core from their URLs; a zip's are read here and handed over as data
    $files = [];
    if ($src['rawUrl']) { foreach ($st['media'] as $f) { $files[] = ['path' => $f['path'], 'url' => ($src['rawUrl'])($f['repoPath'])]; } }
    elseif ($st['media']) {
      $wantedMedia = [];
      foreach ($st['media'] as $f) { $wantedMedia[] = $f['repoPath']; }
      $data = ($src['readMany'])($wantedMedia, true);
      foreach ($st['media'] as $f) { if (isset($data[$f['repoPath']]) && is_string($data[$f['repoPath']])) { $files[] = ['path' => $f['path'], 'data' => $data[$f['repoPath']]]; } }
    }

    $siteTitle = self::stringOf($site['title'] ?? null);
    $out = ['title' => $siteTitle !== '' ? $siteTitle : $src['name'], 'items' => $items, 'files' => $files];
    $description = self::stringOf(self::mapOf($site['metadata'] ?? null)['description'] ?? null);
    if ($description !== '') { $out['site'] = ['description' => $description]; }
    if ($truncated) { $out['truncated'] = true; }
    $out['stats'] = ['pages' => count($items), 'modules' => $modules, 'media' => count($files), 'languageFiles' => $languageFiles];
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
   * Reads a Grav site from a GitHub repository (or an uploaded zip of one): one page per folder under its pages
   * folder, ordered and shown in the menu by numeric prefix, titled, dated and tagged from each page header, with
   * modules folded into their page, links between pages pointed at the imported slugs, and the images and files
   * pages use listed for the new site. Twig and shortcodes are not run; what was left out is counted in stats.
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
        if (!preg_match('/\.zip$/i', (string) ($f['name'] ?? ''))) { return ['error' => 'expected a .zip of the Grav site']; }
      } elseif (empty($input['url'])) { return ['error' => 'url or files is required']; }
      $src = $this->openSource($ctx, $input);
      if (isset($src['error'])) { return $src; }
      return $this->importSite($ctx, $src);
    } catch (Exception $e) {
      return ['error' => $e->getMessage()];
    }
  }
}

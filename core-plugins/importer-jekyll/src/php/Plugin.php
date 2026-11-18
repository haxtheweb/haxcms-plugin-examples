<?php
// Jekyll importer (PHP). Mirrors src/nodejs/index.js; both return identical results.
// Reads a Jekyll site as data: its pages, posts and collections, each page's front matter, _config.yml, the navigation
// the common themes keep in front matter (parent and nav_order, as Just the Docs does), and the Liquid tags that have a
// plain equivalent. Nothing of Jekyll runs: no layouts, no includes, no plugins. The repository or zip is listed and
// read through import-source.tree, front matter and configuration through import-frontmatter.data, markdown through
// import.file.
class ImporterJekyllPlugin {
  const MAX_PAGES = 500;
  const IMPORTABLE = '/\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|xml)$/iD';
  const IMAGE = '/\.(jpg|jpeg|png|gif|webp)$/iD';
  const PAGE_EXT = '/\.(md|markdown|html)$/D';
  // a post's file name: its date and its title
  const POST_NAME = '/^(\d{4})-(\d{2})-(\d{2})-(.+)\.(md|markdown|html)$/D';
  // files GitHub Pages leaves out when they have no front matter (jekyll-optional-front-matter)
  const NOT_PAGES = ['readme', 'license', 'licence', 'copying', 'code_of_conduct', 'contributing', 'issue_template', 'pull_request_template', 'changelog', 'security'];
  // what Jekyll leaves out by default, on top of names starting with _ . # or ending with ~
  const DEFAULT_EXCLUDE = ['node_modules', 'vendor', 'gemfiles', 'Gemfile', 'Gemfile.lock', '.sass-cache', '.jekyll-cache'];
  // what is read as text out of a zip: pages and configuration
  const SOURCE_TEXT = '\.(md|markdown|html|yml|yaml|toml)$';
  // a code fence, written without the character itself (PHP reads a bare one as "run a command")
  const FENCE = "\x60\x60\x60";
  const BLOCK_ENDS = ['else', 'elsif', 'when', 'break', 'continue'];

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

  // ---- Jekyll helpers ----

  private static function isTrue($v) { return strtolower(trim(is_scalar($v) ? (string) $v : '')) === 'true'; }
  private static function isFalse($v) { return strtolower(trim(is_scalar($v) ? (string) $v : '')) === 'false'; }
  private static function mapOf($v) { return self::isObject($v) ? $v : []; }
  private static function withoutQuery($ref) { return explode('?', explode('#', $ref)[0])[0]; }
  private static function dirOf($path) { $cut = strrpos($path, '/'); return $cut === false ? '' : substr($path, 0, $cut); }
  private static function baseOf($path) { $cut = strrpos($path, '/'); return $cut === false ? $path : substr($path, $cut + 1); }
  private static function stem($name) { return preg_replace(self::PAGE_EXT, '', $name); }
  private static function pad2($n) { return $n < 10 ? '0' . $n : (string) $n; }
  /** A list of non-empty strings out of a list, a single value, or (for tags and categories) words. */
  private static function stringList($v, $words = false) {
    $out = [];
    foreach ((is_array($v) && array_is_list($v)) ? $v : [$v] as $x) {
      if (!is_string($x)) { continue; }
      foreach ($words ? preg_split('/\s+/', $x) : [$x] as $w) { if (trim($w) !== '') { $out[] = trim($w); } }
    }
    return $out;
  }
  private static function titleFromName($name) {
    $t = trim(preg_replace('/[-_]+/', ' ', $name));
    return $t === '' ? $name : self::ucfirst($t);
  }
  /** Jekyll's title for a post from its file name: every word capitalised. */
  private static function titleize($slug) {
    $out = [];
    foreach (preg_split('/[-_ ]+/', $slug) as $w) { if ($w !== '') { $out[] = self::ucfirst($w); } }
    return implode(' ', $out);
  }
  /** The text of a level-one heading line (# Title, # Title #), or "". */
  private static function headingOne($line) {
    if (!preg_match('/^#[ \t]+(.*)$/D', $line, $h)) { return ''; }
    $t = rtrim($h[1], " \t");
    $u = rtrim($t, '#');
    if ($u !== $t && ($u === '' || strpos(" \t", substr($u, -1)) !== false)) { $t = rtrim($u, " \t"); }
    return $t;
  }
  /** A number written in front matter (nav_order: 2, 2.5, -1), or null. */
  private static function numberOf($v) {
    $s = trim(is_scalar($v) ? (string) $v : '');
    return preg_match('/^-?\d{1,9}(\.\d{1,9})?$/D', $s) ? (float) $s : null;
  }

  /**
   * Seconds since 1970 for a Jekyll date: 2026-03-09, 2026-03-09 14:30:00, 2026-03-09T14:30:00 -0500 or +02:00.
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
    if ($k === 'index') { return ''; }
    if (substr($k, -6) === '/index') { $k = substr($k, 0, -6); }
    return trim($k, '/');
  }

  /** A post's address from a permalink pattern (Jekyll's named styles or a pattern of :placeholders). */
  public static function postUrl($pattern, $post) {
    $styles = [
      'date' => '/:categories/:year/:month/:day/:title:output_ext',
      'pretty' => '/:categories/:year/:month/:day/:title/',
      'ordinal' => '/:categories/:year/:y_day/:title:output_ext',
      'weekdate' => '/:categories/:year/W:week/:short_day/:title:output_ext',
      'none' => '/:categories/:title:output_ext',
    ];
    $p = array_key_exists($pattern, $styles) ? $styles[$pattern] : ($pattern !== '' ? $pattern : $styles['date']);
    $cats = [];
    foreach ($post['categories'] as $c) { $cats[] = str_replace(' ', '-', strtolower($c)); }
    $values = [
      'year' => (string) $post['year'], 'month' => self::pad2($post['month']), 'day' => self::pad2($post['day']), 'i_month' => (string) $post['month'], 'i_day' => (string) $post['day'],
      'short_year' => substr((string) $post['year'], 2), 'title' => $post['slug'], 'slug' => $post['slug'], 'categories' => implode('/', $cats), 'output_ext' => '.html',
    ];
    $url = preg_replace_callback('/:([a-z_]+)/', function ($m) use ($values) { return $values[$m[1]] ?? ''; }, $p);
    $segs = array_values(array_filter(explode('/', $url), function ($s) { return $s !== ''; }));
    return '/' . implode('/', $segs) . (substr($url, -1) === '/' ? '/' : '');
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

  /** The Jekyll site in the files: the shallowest folder holding _config.yml (or .yaml, .toml). [dir, config] or null. */
  public static function findSite($list) {
    $best = null;
    foreach ($list as $p) {
      if (!preg_match('~^((?:[^/]+/)*)_config\.(yml|yaml|toml)$~D', $p, $m)) { continue; }
      $depth = $m[1] === '' ? 0 : count(explode('/', $m[1])) - 1;
      $order = -1;
      if ($best !== null) {
        $order = $depth - $best['depth'];
        if ($order === 0) { $order = ($m[2] === 'yml' ? 0 : 1) - ($best['ext'] === 'yml' ? 0 : 1); }
        if ($order === 0) { $order = self::byText($p, $best['config']); }
      }
      if ($order < 0) { $best = ['dir' => $m[1], 'config' => $p, 'depth' => $depth, 'ext' => $m[2]]; }
    }
    return $best === null ? null : ['dir' => $best['dir'], 'config' => $best['config']];
  }

  private static function formatOf($path) { $ext = substr($path, (int) strrpos($path, '.') + 1); return $ext === 'yml' ? 'yaml' : $ext; }

  /** Whether Jekyll reads a path of the site (relative to its folder): not excluded, not hidden, not under _site. */
  private static function readable($rel, $st) {
    foreach ($st['exclude'] as $x) { if ($rel === $x || strncmp($rel, $x . '/', strlen($x) + 1) === 0) { return false; } }
    if (isset($st['include'][$rel])) { return true; }
    $segs = explode('/', $rel);
    $last = count($segs) - 1;
    foreach ($segs as $i => $seg) {
      $hidden = $seg !== '' && ($seg[0] === '.' || $seg[0] === '#');
      if ($hidden || ($i === $last && substr($seg, -1) === '~')) { return false; }
      if (strncmp($seg, '_', 1) === 0 && !isset($st['include'][$seg])) { return false; }
    }
    return true;
  }

  // ---- the documents: pages, posts and collection documents ----

  /** Every document Jekyll would render: [file, rel, kind: page | post | doc, collection, ...]. */
  private static function findDocs($src, $st) {
    $docs = [];
    $drafts = 0;
    $skip = strlen($st['dir']);
    foreach ($src['list'] as $p) {
      if (strncmp($p, $st['dir'], $skip) !== 0 || !preg_match(self::PAGE_EXT, $p)) { continue; }
      $rel = substr($p, $skip);
      $segs = explode('/', $rel);
      // posts: <category folders>/_posts/<more folders>/YYYY-MM-DD-title.md
      $at = array_search('_posts', $segs, true);
      if ($at !== false) {
        $before = array_slice($segs, 0, $at);
        $plain = true;
        foreach ($before as $s) { if (strncmp($s, '_', 1) === 0 || strncmp($s, '.', 1) === 0) { $plain = false; } }
        if (!preg_match(self::POST_NAME, $segs[count($segs) - 1], $m) || !$plain) { continue; }
        $docs[] = ['file' => $p, 'rel' => $rel, 'kind' => 'post', 'collection' => 'posts', 'folderCategories' => $before, 'date' => ['year' => (int) $m[1], 'month' => (int) $m[2], 'day' => (int) $m[3]], 'slug' => $m[4]];
        continue;
      }
      if (in_array('_drafts', $segs, true)) { $drafts++; continue; }
      // collections: _<label>/<path>, under collections_dir
      $cd = $st['collectionsDir'];
      $inColl = ($cd === '' || strncmp($rel, $cd . '/', strlen($cd) + 1) === 0) ? substr($rel, $cd === '' ? 0 : strlen($cd) + 1) : null;
      $label = ($inColl !== null && strncmp($inColl, '_', 1) === 0 && strpos($inColl, '/') !== false) ? substr($inColl, 1, strpos($inColl, '/') - 1) : null;
      if ($label !== null && isset($st['collections'][$label])) { $docs[] = ['file' => $p, 'rel' => $rel, 'kind' => 'doc', 'collection' => $label, 'path' => substr($inColl, strlen($label) + 2)]; continue; }
      // the error page is the site's, not content
      if (self::readable($rel, $st) && !preg_match('/^404\.(md|markdown|html)$/D', $rel)) { $docs[] = ['file' => $p, 'rel' => $rel, 'kind' => 'page', 'collection' => null]; }
    }
    return ['docs' => $docs, 'drafts' => $drafts];
  }

  // ---- Liquid: the tags with a plain equivalent are kept, the rest removed and counted ----

  private static function bump(&$st, $key) { $st['unmapped'][$key] = ($st['unmapped'][$key] ?? 0) + 1; }

  /** A Liquid value: a quoted string, site.*, page.*, or (when unknown) null. */
  private static function liquidValue($expr, $doc, $st) {
    $v = trim($expr);
    if (preg_match('/^"[^"]*"$|^\'[^\']*\'$/D', $v)) { return substr($v, 1, -1); }
    if ($v === 'site.baseurl' || $v === 'site.url' || $v === 'site.github.url') { return ''; }
    if (strncmp($v, 'site.', 5) === 0 && preg_match('/^[A-Za-z0-9_]+$/D', substr($v, 5)) && is_string($st['config'][substr($v, 5)] ?? null)) { return $st['config'][substr($v, 5)]; }
    if ($v === 'page.title') { return $doc['title']; }
    if (strncmp($v, 'page.', 5) === 0 && preg_match('/^[A-Za-z0-9_]+$/D', substr($v, 5)) && is_string($doc['data'][substr($v, 5)] ?? null)) { return $doc['data'][substr($v, 5)]; }
    return null;
  }

  /** The next {% tag %} from position $p: [start, end, name, args] or null. */
  private static function nextTag($text, $p) {
    $s = strpos($text, '{%', $p);
    if ($s === false) { return null; }
    $e = strpos($text, '%}', $s + 2);
    if ($e === false) { return null; }
    $inner = trim(substr($text, $s + 2, $e - $s - 2), " \t\n-");
    $name = preg_match('/^[A-Za-z_]+/', $inner, $nm) ? $nm[0] : '';
    return ['start' => $s, 'end' => $e + 2, 'name' => $name, 'args' => $name !== '' ? trim(substr($inner, strlen($name))) : ''];
  }

  /**
   * Liquid in a document, read by scanning (no template runs): {% raw %} keeps its text, {% comment %} goes,
   * {% highlight %} becomes a code fence, {% link %} and {% post_url %} become the address they name, {{ }} becomes a
   * known site or page value (site.baseurl is empty, so addresses start at the site's root), and every other tag is
   * removed, its block's text kept, and counted in stats.unmapped.
   */
  private static function liquid($text, $doc, &$st) {
    $out = '';
    $i = 0;
    $n = strlen($text);
    $fenced = false;
    while ($i < $n) {
      $a = strpos($text, '{%', $i);
      $b = strpos($text, '{{', $i);
      $s = $a === false ? $b : ($b === false ? $a : min($a, $b));
      if ($s === false) { $out .= substr($text, $i); break; }
      $out .= substr($text, $i, $s - $i);
      if ($s === $b) {
        $e = strpos($text, '}}', $s + 2);
        if ($e === false) { $out .= substr($text, $s); break; }
        $parts = explode('|', substr($text, $s + 2, $e - $s - 2));
        $value = self::liquidValue($parts[0], $doc, $st);
        if ($value === null) { self::bump($st, 'liquid:output'); } else { $out .= $value; }
        $i = $e + 2;
        continue;
      }
      $t = self::nextTag($text, $s);
      if ($t === null) { $out .= substr($text, $s); break; }
      $i = $t['end'];
      if ($t['name'] === 'raw' || $t['name'] === 'comment' || $t['name'] === 'highlight') {
        $c = null;
        for ($x = self::nextTag($text, $t['end']); $x !== null; $x = self::nextTag($text, $x['end'])) { if ($x['name'] === 'end' . $t['name']) { $c = $x; break; } }
        $inner = $c === null ? substr($text, $t['end']) : substr($text, $t['end'], $c['start'] - $t['end']);
        $i = $c === null ? $n : $c['end'];
        if ($t['name'] === 'raw') { $out .= $inner; }
        elseif ($t['name'] === 'highlight') {
          $lang = preg_match('/^[A-Za-z0-9_+-]+/', $t['args'], $lm) ? $lm[0] : '';
          $out .= "\n" . self::FENCE . $lang . "\n" . trim($inner, "\n") . "\n" . self::FENCE . "\n";
          $fenced = true;
        }
        continue;
      }
      if ($t['name'] === 'link' || $t['name'] === 'post_url') {
        if (preg_match('/^["\']?([^"\'\s]+)["\']?/', $t['args'], $tm)) { $out .= $t['name'] === 'link' ? '/' . trim($tm[1], '/') : '/_posts/' . trim($tm[1], '/'); }
        continue;
      }
      if (strncmp($t['name'], 'end', 3) === 0 || in_array($t['name'], self::BLOCK_ENDS, true)) { continue; }
      self::bump($st, 'liquid:' . ($t['name'] !== '' ? $t['name'] : 'tag'));
    }
    // a highlight block's fence stands on its own lines
    return $fenced ? preg_replace('/(\x60{3}[A-Za-z0-9_+-]*)\n{2,}/', "\$1\n", preg_replace('/\n{2,}(\x60{3})/', "\n\$1", $out)) : $out;
  }

  /** kramdown's additions, outside fenced code: {: attribute lists} and {::options} go, and so does a {:toc} list. */
  private static function kramdown($body) {
    $out = [];
    $fenced = false;
    foreach (explode("\n", $body) as $line) {
      if (preg_match('/^\s*(\x60{3}|~~~)/', $line)) { $out[] = $line; $fenced = !$fenced; continue; }
      if ($fenced) { $out[] = $line; continue; }
      $t = trim($line);
      if (preg_match('/^\{:\s*\.?toc\s*\}$/D', $t)) { if ($out && preg_match('/^\s*([*+-]|\d+\.)\s/', $out[count($out) - 1])) { array_pop($out); } continue; }
      if (preg_match('/^\{::?[^{}]*\}$/D', $t)) { continue; }
      $cut = preg_replace('/\{:[^{}\n]*\}/', '', $line);
      $out[] = $cut === $line ? $line : rtrim($cut, " \t");
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

  /** A reference as a path on the site ("/x/y") when it is written against the site's own address or baseurl, else as written. */
  private static function onSite($ref, $st) {
    $r = $ref;
    $len = strlen($st['url']);
    if ($len > 0 && strncmp(strtolower($r), $st['url'], $len) === 0) { $rest = (string) substr($r, $len); $r = $rest === '' ? '/' : ($rest[0] === '/' ? $rest : $r); }
    $base = $st['baseurl'];
    if ($base !== '' && $r !== '' && $r[0] === '/' && ($r === '/' . $base || strncmp($r, '/' . $base . '/', strlen($base) + 2) === 0)) { $rest = (string) substr($r, strlen($base) + 1); $r = $rest === '' ? '/' : $rest; }
    return $r;
  }

  /** The file a document's reference points at, or null: from the site's root, or beside the document. */
  private static function mediaPath($ref, $doc, $st) {
    $clean = rawurldecode(self::withoutQuery(self::onSite($ref, $st)));
    if ($clean === '' || self::isExternal($clean)) { return null; }
    $candidates = $clean[0] === '/' ? [$st['dir'] . substr($clean, 1)] : [$st['dir'] . self::dirOf($doc['rel']) . '/' . $clean, $st['dir'] . trim(self::dirOf($doc['url']), '/') . '/' . $clean];
    foreach ($candidates as $c) { $n = self::normalizePath($c); if (isset($st['src']['paths'][$n]) && self::readable(substr($n, strlen($st['dir'])), $st)) { return $n; } }
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

  /** A file of the site that a document uses, added to the list for the new site's files/ folder; its site path, or null. */
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

  /** The imported page a link points at: by its address, by its file, or (from {% link %} / {% post_url %}) its source path. */
  private static function pageSlug($href, $doc, $st) {
    $target = rawurldecode(self::withoutQuery(self::onSite($href, $st)));
    if ($target === '' || self::isExternal($target)) { return null; }
    $candidates = $target[0] === '/' ? [$target] : [self::dirOf($doc['url']) . '/' . $target, self::dirOf($doc['rel']) . '/' . $target];
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
    $text = self::liquid($doc['body'], $doc, $st);
    $html = $doc['ext'] === 'html' ? $text : self::markdown($ctx, self::kramdown($text));
    return trim(self::strip(self::rewrite($html, $doc, $st)));
  }

  // ---- the outline ----

  /** Siblings in navigation order: nav_order (numbers first, then text), then header_pages, then title, then path. */
  private static function navOrder($a, $b) {
    $na = $a['nav']; $nb = $b['nav'];
    if ($na['kind'] !== $nb['kind']) { return $na['kind'] - $nb['kind']; }
    if ($na['kind'] === 0 && $na['value'] != $nb['value']) { return $na['value'] < $nb['value'] ? -1 : 1; }
    if ($na['kind'] === 1 && $na['value'] !== $nb['value']) { return self::byText($na['value'], $nb['value']); }
    $t = self::byText(strtolower($a['title']), strtolower($b['title']));
    return $t !== 0 ? $t : self::byText($a['rel'], $b['rel']);
  }

  /** Posts newest first, then by path. */
  private static function postOrder($a, $b) {
    $ca = $a['created'] === null ? 0 : $a['created'];
    $cb = $b['created'] === null ? 0 : $b['created'];
    return $ca !== $cb ? ($ca > $cb ? -1 : 1) : self::byText($b['rel'], $a['rel']);
  }

  // ---- the import ----

  private static function frontMatterCall($ctx, $op, $input) {
    $r = $ctx->contracts->call('import-frontmatter.data', $op, $input);
    $ok = is_array($r) && ($op === 'split' ? (isset($r['results']) && is_array($r['results'])) : (array_key_exists('data', $r) || array_key_exists('error', $r)));
    if (!$ok) { throw new Exception('front matter could not be read: ' . ((is_array($r) && !empty($r['error'])) ? $r['error'] : 'no result')); }
    return $r;
  }

  private function importSite($ctx, $src) {
    $from = $src['repo'] ?: $src['name'];
    $found = self::findSite($src['list']);
    if ($found === null) { return ['error' => "no Jekyll site found in $from (expected a _config.yml)"]; }
    $configs = ($src['readMany'])([$found['config']], false);
    $config = is_string($configs[$found['config']] ?? null) ? self::mapOf(self::frontMatterCall($ctx, 'parse', ['format' => self::formatOf($found['config']), 'text' => $configs[$found['config']]])['data'] ?? null) : [];

    // collections: a map of labels or a list of them; posts are one of them
    $collections = [];
    $declared = $config['collections'] ?? null;
    if (is_array($declared) && array_is_list($declared)) { foreach (self::stringList($declared) as $c) { $collections[$c] = []; } }
    else { foreach (self::mapOf($declared) as $k => $v) { $collections[(string) $k] = self::mapOf($v); } }
    unset($collections['posts']);
    $exclude = self::DEFAULT_EXCLUDE;
    foreach (self::stringList($config['exclude'] ?? null) as $x) { $exclude[] = trim($x, '/'); }
    $include = [];
    foreach (self::stringList($config['include'] ?? null) as $x) { $include[trim($x, '/')] = true; }
    $st = [
      'src' => $src, 'dir' => $found['dir'], 'config' => $config, 'collections' => $collections, 'collectionsDir' => trim(self::stringOf($config['collections_dir'] ?? null), '/'),
      'exclude' => $exclude, 'include' => $include,
      'url' => strtolower(rtrim(self::stringOf($config['url'] ?? null), '/')), 'baseurl' => trim(self::stringOf($config['baseurl'] ?? null), '/'),
      'unmapped' => [], 'media' => [], 'fileNames' => [], 'filesByPath' => [], 'slugByKey' => [],
    ];
    $found2 = self::findDocs($src, $st);
    $docs = $found2['docs'];

    // read every document (up to MAX_PAGES) in one call, and split their front matter in one call
    $truncated = false;
    if (count($docs) > self::MAX_PAGES) { $docs = array_slice($docs, 0, self::MAX_PAGES); $truncated = true; }
    $files = [];
    foreach ($docs as $d) { $files[] = $d['file']; }
    $texts = ($src['readMany'])($files, false);
    $docs = array_values(array_filter($docs, function ($d) use ($texts) { return is_string($texts[$d['file']] ?? null); }));
    $readTexts = [];
    foreach ($docs as $d) { $readTexts[] = $texts[$d['file']]; }
    $split = $docs ? self::frontMatterCall($ctx, 'split', ['texts' => $readTexts])['results'] : [];
    $hasIndex = false;
    foreach ($docs as $d) { if (preg_match('/^index\.(md|markdown|html)$/D', $d['rel'])) { $hasIndex = true; } }
    $kept = [];
    foreach ($docs as $i => $d) {
      $r = is_array($split[$i] ?? null) ? $split[$i] : [];
      $d['data'] = self::mapOf($r['data'] ?? null);
      $d['ext'] = substr($d['file'], (int) strrpos($d['file'], '.') + 1);
      $d['readmeHome'] = false;
      $hasFront = isset($r['format']) && $r['format'] !== 'none';
      // a page needs front matter, except markdown (GitHub Pages reads it without), and never the repository's README etc.
      if ($d['kind'] === 'page' && !$hasFront && ($d['ext'] === 'html' || in_array(strtolower(self::stem(self::baseOf($d['rel']))), self::NOT_PAGES, true))) {
        if (!(strtolower($d['rel']) === 'readme.md' && !$hasIndex)) { continue; }
        $d['readmeHome'] = true;
      }
      $body = is_string($r['body'] ?? null) ? $r['body'] : '';
      $title = self::stringOf($d['data']['title'] ?? null);
      if ($title === '' && $d['ext'] !== 'html') {
        // a document with no title in its front matter is titled by its first level-one heading
        $lines = explode("\n", $body);
        $at = 0;
        while ($at < count($lines) && trim($lines[$at]) === '') { $at++; }
        $h = $at < count($lines) ? self::headingOne($lines[$at]) : '';
        if ($h !== '') { $title = $h; array_splice($lines, $at, 1); $body = implode("\n", $lines); }
      }
      $d['body'] = $body;
      if ($title === '') {
        if ($d['kind'] === 'post') { $title = self::titleize($d['slug']); }
        elseif ($d['kind'] === 'doc') { $title = self::titleFromName(self::stem(self::baseOf($d['path']))); }
        elseif (self::stem(self::baseOf($d['rel'])) === 'index') {
          $folder = self::baseOf(self::dirOf($d['rel']));
          $siteName = self::stringOf($config['title'] ?? null);
          $title = self::titleFromName($folder !== '' ? $folder : ($siteName !== '' ? $siteName : $src['name']));
        } else { $title = self::titleFromName(self::stem(self::baseOf($d['rel']))); }
      }
      $d['title'] = $title;
      $nav = self::numberOf($d['data']['nav_order'] ?? null);
      $navText = self::stringOf($d['data']['nav_order'] ?? null);
      $d['nav'] = $nav !== null ? ['kind' => 0, 'value' => $nav] : ($navText !== '' ? ['kind' => 1, 'value' => $navText] : ['kind' => 2, 'value' => 0]);
      // the address Jekyll gives it, and the keys links reach it by
      $permalink = self::stringOf($d['data']['permalink'] ?? null);
      if ($d['kind'] === 'post') {
        $d['categories'] = array_merge($d['folderCategories'], self::stringList($d['data']['categories'] ?? null, true), self::stringList($d['data']['category'] ?? null, true));
        $date = self::parseDate(self::stringOf($d['data']['date'] ?? null));
        $d['created'] = $date !== null ? $date : gmmktime(0, 0, 0, $d['date']['month'], $d['date']['day'], $d['date']['year']);
        $d['url'] = $permalink !== '' ? $permalink : self::postUrl(self::stringOf($config['permalink'] ?? null), $d['date'] + ['slug' => $d['slug'], 'categories' => $d['categories']]);
      } else {
        $d['created'] = self::parseDate(self::stringOf($d['data']['date'] ?? null));
        $d['url'] = $permalink !== '' ? $permalink : ($d['kind'] === 'doc' ? '/' . $d['collection'] . '/' . self::stem($d['path']) : ($d['readmeHome'] ? '/' : '/' . self::stem($d['rel'])));
      }
      $keys = [$d['url'], $d['kind'] === 'post' ? '/_posts/' . self::stem(self::baseOf($d['rel'])) : '', '/' . self::stem($d['rel'])];
      $keys = array_merge($keys, self::stringList($d['data']['redirect_from'] ?? null));
      $d['keys'] = array_values(array_filter($keys, function ($k) { return $k !== ''; }));
      $kept[] = $d;
    }
    $docs = $kept;
    if (!$docs) { return ['error' => "no pages found in $from"]; }

    $siteTitle = self::stringOf($config['title'] ?? null);
    if ($siteTitle === '') { $siteTitle = $src['name']; }
    // documents are referred to by index from here on
    $home = null;
    foreach ($docs as $k => $d) { if ($d['kind'] === 'page' && self::normKey($d['url']) === '' && $home === null) { $home = $k; } }
    $header = self::stringList($config['header_pages'] ?? null);
    foreach ($docs as $k => $d) {
      if ($d['kind'] !== 'page') { continue; }
      $h = array_search($d['rel'], $header, true);
      if ($h !== false && $d['nav']['kind'] === 2) { $docs[$k]['nav'] = ['kind' => 1, 'value' => '~' . str_pad((string) $h, 4, '0', STR_PAD_LEFT)]; }
    }
    $postKeys = [];
    foreach ($docs as $k => $d) { if ($d['kind'] === 'post') { $postKeys[] = $k; } }
    usort($postKeys, function ($x, $y) use ($docs) { return self::postOrder($docs[$x], $docs[$y]); });
    $nonPosts = [];
    foreach ($docs as $k => $d) { if ($d['kind'] !== 'post' && $k !== $home) { $nonPosts[] = $k; } }

    // the parent of each page: by title (parent, grand_parent), as Just the Docs and its kin do; else by folder
    $byTitle = false;
    foreach ($docs as $d) { if (self::stringOf($d['data']['parent'] ?? null) !== '') { $byTitle = true; } }
    $parentOf = [];
    if ($byTitle) {
      foreach ($nonPosts as $k) {
        $want = self::stringOf($docs[$k]['data']['parent'] ?? null);
        if ($want === '') { continue; }
        $grand = self::stringOf($docs[$k]['data']['grand_parent'] ?? null);
        foreach ($nonPosts as $o) {
          if ($o !== $k && $docs[$o]['title'] === $want && ($grand === '' || self::stringOf($docs[$o]['data']['parent'] ?? null) === $grand)) { $parentOf[$k] = $o; break; }
        }
      }
      // a parent chain that loops is cut where it loops
      foreach ($nonPosts as $k) {
        $seen = [$k => true];
        for ($p = $parentOf[$k] ?? null; $p !== null; $p = $parentOf[$p] ?? null) { if (isset($seen[$p])) { unset($parentOf[$k]); break; } $seen[$p] = true; }
      }
    } else {
      $indexOf = [];
      foreach ($docs as $k => $d) { if ($d['kind'] === 'page' && self::stem(self::baseOf($d['rel'])) === 'index' && $k !== $home) { $indexOf[self::dirOf($d['rel'])] = $k; } }
      foreach ($docs as $k => $d) {
        if ($d['kind'] !== 'page' || $k === $home) { continue; }
        $isIndex = self::stem(self::baseOf($d['rel'])) === 'index';
        if ($isIndex && self::dirOf($d['rel']) === '') { continue; }
        for ($dir = $isIndex ? self::dirOf(self::dirOf($d['rel'])) : self::dirOf($d['rel']); $dir !== ''; $dir = self::dirOf($dir)) { if (isset($indexOf[$dir])) { $parentOf[$k] = $indexOf[$dir]; break; } }
      }
    }

    // collections become a page each (unless their documents name a parent), posts go under one Posts page
    $items = []; $outline = []; $used = [];
    $add = function ($k, $synthetic, $parentIndex, $order, $depth) use (&$docs, &$items, &$outline, &$used, &$st, $home) {
      if ($synthetic !== null) { $d = $synthetic; }
      else { $d = $docs[$k]; }
      if ($synthetic !== null) { $own = self::titleSlug($synthetic['slug']); }
      elseif ($d['kind'] === 'post') { $own = self::titleSlug($d['slug']); }
      elseif ($k === $home) { $own = self::titleSlug($d['title']); }
      else {
        $slugFm = self::stringOf($d['data']['slug'] ?? null);
        if ($slugFm !== '') { $own = self::titleSlug($slugFm); }
        elseif (self::stem(self::baseOf($d['rel'])) === 'index') { $folder = self::baseOf(self::dirOf($d['rel'])); $own = self::titleSlug($folder !== '' ? $folder : $d['title']); }
        else { $own = self::titleSlug(self::stem(self::baseOf($d['kind'] === 'doc' ? $d['path'] : $d['rel']))); }
      }
      $slug = $parentIndex !== null ? $items[$parentIndex]['slug'] . '/' . $own : $own;
      for ($i = 2, $s = $slug; isset($used[$slug]); $i++) { $slug = "$s-$i"; }
      $used[$slug] = true;
      $metadata = ['sourceType' => 'jekyll', 'jekyll' => $synthetic !== null ? ['kind' => $d['kind']] : ['path' => $d['file'], 'kind' => $d['kind']]];
      if ($synthetic === null) {
        if (self::isTrue($d['data']['nav_exclude'] ?? null)) { $metadata['hideInMenu'] = true; }
        if (self::isFalse($d['data']['published'] ?? null)) { $metadata['published'] = false; }
        if ($d['created'] !== null) { $metadata['created'] = $d['created']; }
        $tags = self::stringList($d['data']['tags'] ?? null, true);
        if ($tags) { $metadata['tags'] = $tags; }
      }
      $index = count($items);
      $items[] = ['id' => 'item-' . ($index + 1), 'title' => $d['title'], 'slug' => $slug, 'parent' => $parentIndex !== null ? $items[$parentIndex]['id'] : null, 'order' => $order, 'indent' => $depth, 'content' => '<p></p>', 'metadata' => $metadata];
      if ($synthetic === null) {
        $outline[] = ['doc' => $k, 'index' => $index];
        foreach ($d['keys'] as $key) { $nk = self::normKey($key); if (!isset($st['slugByKey'][$nk])) { $st['slugByKey'][$nk] = $slug; } }
      }
      return $index;
    };
    $childrenOf = function ($parent, $pool) use (&$docs, &$parentOf) {
      $out = [];
      foreach ($pool as $k) { if (($parentOf[$k] ?? null) === $parent) { $out[] = $k; } }
      usort($out, function ($x, $y) use ($docs) { return self::navOrder($docs[$x], $docs[$y]); });
      return $out;
    };
    $walk = function ($parent, $parentIndex, $depth, $pool) use (&$walk, &$add, $childrenOf) {
      $order = 0;
      foreach ($childrenOf($parent, $pool) as $k) { $index = $add($k, null, $parentIndex, $order++, $depth); $walk($k, $index, $depth + 1, $pool); }
    };
    $order = 0;
    if ($home !== null) { $add($home, null, null, $order++, 0); }
    $topPages = [];
    foreach ($nonPosts as $k) { if ($docs[$k]['kind'] === 'page' || isset($parentOf[$k])) { $topPages[] = $k; } }
    foreach ($childrenOf(null, $topPages) as $k) { $index = $add($k, null, null, $order++, 0); $walk($k, $index, 1, $nonPosts); }
    $labels = array_map('strval', array_keys($collections));
    usort($labels, [self::class, 'byText']);
    foreach ($labels as $label) {
      $loose = [];
      foreach ($nonPosts as $k) { if ($docs[$k]['kind'] === 'doc' && $docs[$k]['collection'] === $label && !isset($parentOf[$k])) { $loose[] = $k; } }
      if (!$loose) { continue; }
      $index = $add(null, ['kind' => 'collection', 'title' => self::titleize($label), 'slug' => $label], null, $order++, 0);
      usort($loose, function ($x, $y) use ($docs) { return self::navOrder($docs[$x], $docs[$y]); });
      $o = 0;
      foreach ($loose as $k) { $child = $add($k, null, $index, $o++, 1); $walk($k, $child, 2, $nonPosts); }
    }
    if ($postKeys) {
      // a top-level page at /blog/ or /posts/ holds them; else a Posts page is made
      $holder = null;
      foreach ($outline as $o) { $d = $docs[$o['doc']]; if ($d['kind'] === 'page' && $items[$o['index']]['parent'] === null && in_array(self::normKey($d['url']), ['blog', 'posts'], true)) { $holder = $o['index']; break; } }
      $parentIndex = $holder !== null ? $holder : $add(null, ['kind' => 'posts', 'title' => 'Posts', 'slug' => 'posts'], null, $order++, 0);
      $first = 0;
      foreach ($items as $it) { if ($it['parent'] === $items[$parentIndex]['id']) { $first++; } }
      foreach ($postKeys as $i => $k) { $add($k, null, $parentIndex, $first + $i, $items[$parentIndex]['indent'] + 1); }
    }

    foreach ($outline as $o) {
      $html = self::renderBody($ctx, $docs[$o['doc']], $st);
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

    $out = ['title' => $siteTitle, 'items' => $items, 'files' => $files];
    $description = self::stringOf($config['description'] ?? null);
    if ($description !== '') { $out['site'] = ['description' => $description]; }
    if ($truncated) { $out['truncated'] = true; }
    $out['stats'] = ['pages' => count($items), 'posts' => count($postKeys), 'media' => count($files), 'drafts' => $found2['drafts']];
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
   * Reads a Jekyll site from a GitHub repository (or an uploaded zip of one): its pages (nested by the parent
   * front matter that Just the Docs and its kin use, else by folder), its collections, and its posts under one
   * Posts page, newest first; titled, dated and tagged from front matter, with the Liquid tags that have a plain
   * equivalent converted, links between pages pointed at the imported slugs, and the images and files pages use
   * listed for the new site. Layouts, includes and plugins are not run; what was left out is counted in stats.
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
        if (!preg_match('/\.zip$/i', (string) ($f['name'] ?? ''))) { return ['error' => 'expected a .zip of the Jekyll site']; }
      } elseif (empty($input['url'])) { return ['error' => 'url or files is required']; }
      $src = $this->openSource($ctx, $input);
      if (isset($src['error'])) { return $src; }
      return $this->importSite($ctx, $src);
    } catch (Exception $e) {
      return ['error' => $e->getMessage()];
    }
  }
}

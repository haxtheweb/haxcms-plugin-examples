<?php
// VitePress importer (PHP). Mirrors src/nodejs/index.js; both return identical results.
// Port of core's convertVitepressToSite.php, kept to the main path: the sidebar read out of .vitepress/config.* as data
// (never executed), pages, front matter titles, containers and Vue components. Markdown goes to import.file
// (import-markdown) through the platform.
class ImporterVitepressPlugin {
  const API = 'https://api.github.com';
  const RAW = 'https://raw.githubusercontent.com';
  const MAX_PAGES = 500;
  const CONFIG = '/(^|\/)\.vitepress\/config\.(mjs|mts|js|ts)$/';
  const IMPORTABLE = '/\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|xml)$/i';
  const IMAGE = '/\.(jpg|jpeg|png|gif|webp)$/i';
  const OER_CONTAINERS = [
    'learning-objective' => ['resource' => 'LearningObjective', 'properties' => ['skill' => 'skill', 'course' => 'forCourse']],
    'assessment' => ['resource' => 'Assessment', 'properties' => ['type' => 'additionalType', 'points' => 'gradingFormat', 'assessing' => 'assessing']],
    'practice' => ['resource' => 'Practice', 'properties' => ['action' => 'typeOfAction', 'material' => 'material']],
    'learning-component' => ['resource' => 'LearningComponent', 'properties' => ['action' => 'typeOfAction', 'objective' => 'hasLearningObjective']],
    'instructional-pattern' => ['resource' => 'InstructionalPattern', 'properties' => ['type' => 'additionalType', 'title' => 'name']],
  ];
  const NOTES = ['info' => ['info', 'Info'], 'tip' => ['success', 'Tip'], 'warning' => ['warning', 'Warning'], 'danger' => ['stop', 'Danger']];

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
  private static function escHtml($v) { return str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], (string) $v); }
  private static function isExternal($ref) { return (bool) preg_match('/^([a-z][a-z0-9+.-]*:|\/\/)/i', (string) $ref); }
  private static function byText($a, $b) { return $a < $b ? -1 : ($a > $b ? 1 : 0); }
  private static function encComponent($s) { return strtr(rawurlencode($s), ['%21' => '!', '%2A' => '*', '%27' => "'", '%28' => '(', '%29' => ')']); }
  private static function encPath($p) { return implode('/', array_map([self::class, 'encComponent'], explode('/', $p))); }
  private static function isSpace($c) { return $c === ' ' || $c === "\t" || $c === "\n" || $c === "\r" || $c === "\v" || $c === "\f"; }
  private static function startsWith($s, $p) { return strncmp((string) $s, $p, strlen($p)) === 0; }

  private static function strip($html) {
    $html = preg_replace('/<script\b[\s\S]*?<\/script\s*>/i', '', (string) $html);
    $html = preg_replace('/<script\b[^>]*>/i', '', $html);
    return preg_replace('/\son[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
  }

  private static function normalizePath($path) {
    $parts = [];
    foreach (explode('/', $path) as $piece) {
      if ($piece === '' || $piece === '.') { continue; }
      if ($piece === '..') { array_pop($parts); } else { $parts[] = $piece; }
    }
    return implode('/', $parts);
  }

  public static function parseRepo($url) {
    if (!preg_match('/^https?:\/\/(?:www\.)?github\.com\/([^\/?#]+)\/([^\/?#]+)(?:\/tree\/([^\/?#]+))?/i', trim((string) $url), $m)) { return null; }
    return ['owner' => $m[1], 'name' => preg_replace('/\.git$/i', '', $m[2]), 'branch' => !empty($m[3]) ? $m[3] : null];
  }

  private static function frontMatter($md) {
    if (!preg_match('/^---\n([\s\S]*?)\n---[ \t]*(\n|$)/', $md, $m)) { return ['data' => [], 'body' => $md]; }
    $data = [];
    foreach (explode("\n", $m[1]) as $line) {
      if (!preg_match('/^([A-Za-z0-9_-]+):\s+(.*)$/', $line, $k)) { continue; }
      $v = trim($k[2]);
      if (preg_match('/^"((?:\\\\.|[^"\\\\])*)"|^\'((?:\'\'|[^\'])*)\'/', $v, $q, PREG_UNMATCHED_AS_NULL)) {
        $data[$k[1]] = $q[1] !== null ? preg_replace('/\\\\(.)/', '$1', $q[1]) : str_replace("''", "'", $q[2]);
      } else { $data[$k[1]] = preg_replace('/\s+#.*$/', '', $v); }
    }
    return ['data' => $data, 'body' => substr($md, strlen($m[0]))];
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
    if (preg_match('/^-?\d+(\.\d+)?([eE][+-]?\d+)?/', $rest, $num)) { $st['i'] += strlen($num[0]); return $num[0] + 0; }
    throw new Exception("unsupported value at {$st['i']}");
  }

  private static function normalizeSidebar($sidebar) {
    if (is_array($sidebar)) { return $sidebar; }
    if ($sidebar instanceof stdClass) {
      $merged = [];
      foreach (get_object_vars($sidebar) as $v) { if (is_array($v)) { foreach ($v as $e) { $merged[] = $e; } } }
      return $merged ? $merged : null;
    }
    return null;
  }

  private static function readConfig($src) {
    $sidebar = null;
    $literal = self::literalValue($src, 'sidebar');
    if ($literal !== null) { try { $sidebar = self::normalizeSidebar(self::parseJsLiteral($literal)); } catch (Exception $e) { $sidebar = null; } }
    return ['sidebar' => $sidebar, 'title' => self::stringValue($src, 'title'), 'base' => self::stringValue($src, 'base'), 'siteUrl' => self::stringValue($src, 'siteUrl')];
  }

  // ---- reading the site: GitHub (core's path) or an uploaded zip of the repository ----

  private function fromGithub($ctx, $url) {
    $gh = self::parseRepo($url);
    if (!$gh) { return ['error' => 'url must be a GitHub repository (https://github.com/<owner>/<repo>)']; }
    $getJson = function ($u, $what) use ($ctx) {
      try { $r = $ctx->fetch($u); } catch (Exception $e) { throw new Exception("unable to reach $what"); }
      if ($r['status'] >= 400) { throw new Exception("unable to read $what (HTTP {$r['status']})"); }
      return $r['json'];
    };
    $repo = $gh['owner'] . '/' . $gh['name'];
    $info = $getJson(self::API . "/repos/$repo", "the repository $repo");
    $branch = $gh['branch'] ?: ((is_array($info) && !empty($info['default_branch'])) ? $info['default_branch'] : 'main');
    $tree = $getJson(self::API . "/repos/$repo/git/trees/" . self::encComponent($branch) . '?recursive=1', "the file tree of $repo");
    $paths = [];
    foreach ((is_array($tree) && isset($tree['tree']) && is_array($tree['tree'])) ? $tree['tree'] : [] as $t) {
      if (is_array($t) && ($t['type'] ?? null) === 'blob' && isset($t['path']) && is_string($t['path'])) { $paths[$t['path']] = true; }
    }
    $rawUrl = function ($p) use ($repo, $branch) { return self::RAW . "/$repo/" . self::encPath($branch) . '/' . self::encPath($p); };
    $read = function ($p) use ($ctx, $rawUrl) { try { $r = $ctx->fetch($rawUrl($p)); return $r['status'] < 400 ? $r['body'] : null; } catch (Exception $e) { return null; } };
    return ['name' => $gh['name'], 'repo' => $repo, 'branch' => $branch, 'paths' => $paths, 'read' => $read, 'rawUrl' => $rawUrl];
  }

  private function fromArchive($ctx, $file) {
    try { $texts = $ctx->archive->read((string) ($file['data'] ?? ''), ['match' => '(\.md|\.vitepress/config\.(mjs|mts|js|ts))$']); } catch (Exception $e) { return ['error' => 'the file is not a zip archive']; }
    $keys = array_map('strval', array_keys($texts ?: []));
    usort($keys, [self::class, 'byText']);
    $first = $keys ? explode('/', $keys[0])[0] . '/' : '';
    $cut = 0;
    if ($first !== '/' && $keys) {
      $all = true;
      foreach ($keys as $k) { if (strpos($k, $first) !== 0 || strlen($k) <= strlen($first)) { $all = false; break; } }
      if ($all) { $cut = strlen($first); }
    }
    $files = []; $paths = [];
    foreach ($keys as $k) { $files[substr($k, $cut)] = $texts[$k]; $paths[substr($k, $cut)] = true; }
    $read = function ($p) use ($files) { return array_key_exists($p, $files) ? preg_replace('/\r\n?/', "\n", (string) $files[$p]) : null; };
    return ['name' => preg_replace('/\.zip$/i', '', (string) ($file['name'] ?? 'site')), 'repo' => null, 'branch' => null, 'paths' => $paths, 'read' => $read, 'rawUrl' => null];
  }

  // ---- the outline ----

  private static function docsPrefix($src) { return $src['docsRoot'] === '' ? '' : $src['docsRoot'] . '/'; }

  private static function resolveDocPath($link, $src, $node = null) {
    $target = explode('?', explode('#', (string) $link)[0])[0];
    $b = $src['config']['base'];
    if ($b !== null && $b !== '' && self::startsWith($target, $b)) { $target = '/' . substr($target, strlen($b)); }
    $target = preg_replace('/\/$/', '', preg_replace('/\.(md|html)$/i', '', $target));
    $prefix = self::docsPrefix($src);
    if (self::startsWith($target, '/')) { $base = $prefix . preg_replace('/^\//', '', $target); }
    elseif ($node && $node['path']) { $base = self::normalizePath(implode('/', array_slice(explode('/', $node['path']), 0, -1)) . '/' . $target); }
    else { $base = $prefix . $target; }
    $base = preg_replace('/\/+$/', '', $base);
    if ($base === '' || $base === preg_replace('/\/$/', '', $prefix)) { return $prefix . 'index.md'; }
    if (isset($src['paths']["$base.md"])) { return "$base.md"; }
    if (isset($src['paths']["$base/index.md"])) { return "$base/index.md"; }
    return "$base.md";
  }

  private static function outlineFromSidebar($sidebar, $src) {
    $nodes = [];
    $walk = function ($entries, $depth, $parentIndex) use (&$walk, &$nodes, $src) {
      $order = 0;
      foreach ($entries as $e) {
        if (!($e instanceof stdClass) || !isset($e->text) || !is_string($e->text)) { continue; }
        $link = (isset($e->link) && is_string($e->link)) ? $e->link : null;
        $nodes[] = ['title' => $e->text, 'path' => $link === null ? null : self::resolveDocPath($link, $src), 'link' => $link, 'depth' => $depth, 'order' => $order++, 'parentIndex' => $parentIndex];
        if (isset($e->items) && is_array($e->items)) { $walk($e->items, $depth + 1, count($nodes) - 1); }
      }
    };
    $walk($sidebar, 0, null);
    return $nodes;
  }

  private static function titleFromPath($path) {
    $parts = explode('/', $path);
    $words = trim(preg_replace('/[-_]+/', ' ', preg_replace('/\.md$/i', '', end($parts))));
    return ($words === '' || $words === 'index') ? 'Home' : self::ucfirst($words);
  }

  private static function outlineFromTree($src) {
    $prefix = self::docsPrefix($src);
    $pages = [];
    foreach (array_keys($src['paths']) as $p) {
      $p = (string) $p;
      if (self::startsWith($p, $prefix) && preg_match('/\.md$/i', $p) && strpos($p, '/.vitepress/') === false && !self::startsWith($p, '.vitepress/') && strpos($p, 'node_modules/') === false) { $pages[] = $p; }
    }
    $isIndex = function ($p) { return preg_match('/(^|\/)index\.md$/i', $p) ? 0 : 1; };
    usort($pages, function ($a, $b) use ($isIndex) {
      $d = count(explode('/', $a)) - count(explode('/', $b));
      if ($d !== 0) { return $d; }
      $d = $isIndex($a) - $isIndex($b);
      return $d !== 0 ? $d : self::byText($a, $b);
    });
    $out = [];
    foreach ($pages as $order => $path) { $out[] = ['title' => self::titleFromPath($path), 'path' => $path, 'link' => '/' . preg_replace('/\.md$/i', '', substr($path, strlen($prefix))), 'depth' => 0, 'order' => $order, 'parentIndex' => null]; }
    return $out;
  }

  // ---- page bodies ----

  private static function parseAttributes($text) {
    $out = [];
    preg_match_all('/([A-Za-z][A-Za-z0-9_:-]*)(?:\s*=\s*("([^"]*)"|\'([^\']*)\'|\{([^}]*)\}))?/', $text, $all, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);
    foreach ($all as $m) { $out[$m[1]] = ($m[2] ?? null) === null ? 'true' : preg_replace('/^[\'"]|[\'"]$/', '', trim((string) ($m[3] ?? $m[4] ?? $m[5] ?? ''))); }
    return $out;
  }

  private static function mapVueComponents($md, $node, &$st, &$held) {
    $body = preg_replace_callback('/<VideoEmbed\b([\s\S]*?)\/?>(?:\s*<\/VideoEmbed>)?/', function ($m) use ($node, &$st, &$held) {
      $a = self::parseAttributes($m[1]);
      $source = isset($a['src']) && is_string($a['src']) ? $a['src'] : '';
      if ($source === '') { return ''; }
      $resolved = self::registerAsset($source, $node, $st) ?: self::absoluteSourceUrl($source, $node, $st);
      $title = !empty($a['title']) ? $a['title'] : ($a['caption'] ?? '');
      $held[] = '<video-player source="' . self::escAttr($resolved) . '"' . ($title !== '' ? ' media-title="' . self::escAttr($title) . '"' : '') . '>' . (!empty($a['caption']) ? '<div slot="caption">' . self::escHtml($a['caption']) . '</div>' : '') . '</video-player>';
      return "\n\x01" . (count($held) - 1) . "\x01\n";
    }, $md);
    return preg_replace('/<\/?([A-Z][A-Za-z0-9]*)\b[^>]*>/', '', $body);
  }

  private static function container($name, $rest) {
    if (isset(self::OER_CONTAINERS[$name])) {
      $oer = self::OER_CONTAINERS[$name];
      $open = '<oer-schema typeof="' . self::escAttr($oer['resource']) . '">';
      foreach (self::parseAttributes($rest) as $k => $v) { if (isset($oer['properties'][$k])) { $open .= '<oer-schema oer-property="' . self::escAttr($oer['properties'][$k]) . '" text="' . self::escAttr($v) . '"></oer-schema>'; } }
      return ['open' => $open, 'close' => '</oer-schema>'];
    }
    $title = trim($rest);
    if (isset(self::NOTES[$name])) { return ['open' => '<stop-note status="' . self::NOTES[$name][0] . '" title="' . self::escAttr($title !== '' ? $title : self::NOTES[$name][1]) . '"><div slot="message">', 'close' => '</div></stop-note>']; }
    if ($name === 'details') { return ['open' => '<details><summary>' . self::escHtml($title !== '' ? $title : 'Details') . '</summary>', 'close' => '</details>']; }
    return ['open' => '', 'close' => ''];
  }

  private static function parseBody($body, $held) {
    $lines = explode("\n", $body);
    $tree = [[]]; $frames = [];
    $md = [];
    $flush = function () use (&$md, &$tree) { if ($md) { $tree[count($tree) - 1][] = ['md' => implode("\n", $md)]; } $md = []; };
    $close = function () use (&$tree, &$frames) { $f = array_pop($frames); $f['children'] = array_pop($tree); $tree[count($tree) - 1][] = $f; };
    for ($i = 0; $i < count($lines); $i++) {
      $line = $lines[$i];
      if (preg_match('/^\s{0,3}(`{3,}|~{3,})\s*(.*)$/', $line, $open) && !($open[1][0] === '`' && strpos($open[2], '`') !== false)) {
        $code = []; $closed = false;
        for ($j = $i + 1; $j < count($lines); $j++) {
          if (preg_match('/^\s{0,3}(`{3,}|~{3,})\s*$/', $lines[$j], $c) && $c[1][0] === $open[1][0] && strlen($c[1]) >= strlen($open[1])) { $closed = true; break; }
          $code[] = $lines[$j];
        }
        $i = $closed ? $j : count($lines);
        preg_match('/^[\w-]*/', trim($open[2]), $lang);
        array_push($md, '```' . $lang[0], ...$code);
        $md[] = '```';
        continue;
      }
      if (preg_match('/^\s{0,3}:{3,}\s*([A-Za-z][\w-]*)?(.*)$/', $line, $fence, PREG_UNMATCHED_AS_NULL)) {
        $flush();
        if ($fence[1] === null) { if ($frames) { $close(); } continue; }
        $frames[] = self::container($fence[1], (string) $fence[2]);
        $tree[] = [];
        continue;
      }
      $parts = preg_split('/\x01(\d+)\x01/', $line, -1, PREG_SPLIT_DELIM_CAPTURE);
      foreach ($parts as $k => $p) {
        if ($k % 2 === 1) { $flush(); $tree[count($tree) - 1][] = ['html' => $held[(int) $p]]; continue; }
        if (count($parts) === 1 || trim($p) !== '') { $md[] = $p; }
      }
    }
    $flush();
    while ($frames) { $close(); }
    return $tree[0];
  }

  private static function markdown($ctx, $text) {
    if (trim($text) === '') { return ''; }
    $r = $ctx->contracts->call('import.file', 'convert', ['name' => 'page.md', 'data' => base64_encode("\n" . $text)]);
    if (!is_array($r) || !isset($r['html']) || !is_string($r['html'])) { throw new Exception('markdown could not be converted: ' . ((is_array($r) && !empty($r['error'])) ? $r['error'] : 'no result')); }
    return $r['html'];
  }

  private static function renderTree($ctx, $nodes) {
    $out = '';
    foreach ($nodes as $n) {
      if (array_key_exists('md', $n)) { $out .= self::markdown($ctx, $n['md']); }
      elseif (array_key_exists('html', $n)) { $out .= $n['html']; }
      else { $out .= $n['open'] . self::renderTree($ctx, $n['children']) . $n['close']; }
    }
    return $out;
  }

  // ---- links and assets ----

  private static function resolveAssetPath($ref, $node, $st) {
    $prefix = self::docsPrefix($st['src']);
    if (self::startsWith($ref, '/')) {
      $target = preg_replace('/^\//', '', $ref);
      $b = $st['src']['config']['base'];
      if ($b !== null && $b !== '') { $base = preg_replace('/^\//', '', $b); if (self::startsWith($target, $base)) { $target = substr($target, strlen($base)); } }
      $candidates = [$prefix . 'public/' . $target, $prefix . $target, $target];
    } else {
      $dir = $node['path'] ? implode('/', array_slice(explode('/', $node['path']), 0, -1)) : preg_replace('/\/$/', '', $prefix);
      $candidates = [self::normalizePath("$dir/$ref")];
    }
    foreach ($candidates as $c) { if (isset($st['src']['paths'][$c])) { return $c; } }
    return null;
  }

  private static function uniqueFileName($repoPath, &$st) {
    $parts = explode('/', $repoPath);
    $base = preg_replace('/[^A-Za-z0-9._-]+/', '-', end($parts));
    if (empty($st['fileNames'][$base])) { $st['fileNames'][$base] = true; return $base; }
    $dot = strrpos($base, '.');
    $stem = $dot === false ? $base : substr($base, 0, $dot);
    $ext = $dot === false ? '' : substr($base, $dot);
    $n = 1;
    while (!empty($st['fileNames']["$stem-$n$ext"])) { $n++; }
    $st['fileNames']["$stem-$n$ext"] = true;
    return "$stem-$n$ext";
  }

  private static function registerAsset($ref, $node, &$st) {
    if (!$st['src']['rawUrl'] || !is_string($ref) || $ref === '' || self::isExternal($ref)) { return null; }
    $clean = explode('?', explode('#', $ref)[0])[0];
    if ($clean === '' || !preg_match(self::IMPORTABLE, $clean)) { return null; }
    $repoPath = self::resolveAssetPath($clean, $node, $st);
    if ($repoPath === null) { return null; }
    if (!empty($st['filesByPath'][$repoPath])) { return $st['filesByPath'][$repoPath]; }
    $path = 'files/' . self::uniqueFileName($repoPath, $st);
    $st['files'][] = ['path' => $path, 'url' => ($st['src']['rawUrl'])($repoPath)];
    $st['filesByPath'][$repoPath] = $path;
    return $path;
  }

  private static function absoluteSourceUrl($ref, $node, $st) {
    if (self::isExternal($ref) || !$st['src']['rawUrl']) { return $ref; }
    $clean = explode('?', explode('#', $ref)[0])[0];
    $repoPath = self::resolveAssetPath($clean, $node, $st);
    if ($repoPath !== null) { return ($st['src']['rawUrl'])($repoPath); }
    $prefix = self::docsPrefix($st['src']);
    if (self::startsWith($clean, '/')) { return ($st['src']['rawUrl'])($prefix . preg_replace('/^\//', '', $clean)); }
    $dir = $node['path'] ? implode('/', array_slice(explode('/', $node['path']), 0, -1)) : preg_replace('/\/$/', '', $prefix);
    return ($st['src']['rawUrl'])(self::normalizePath("$dir/$clean"));
  }

  private static function rewrite($html, $node, &$st) {
    $html = preg_replace_callback('/<img\b[^>]*>/i', function ($m) use ($node, &$st) {
      $tag = $m[0];
      if (!preg_match('/\ssrc="([^"]*)"/i', $tag, $src, PREG_OFFSET_CAPTURE) || $src[1][0] === '') { return $tag; }
      $alt = preg_match('/\salt="([^"]*)"/i', $tag, $am) ? $am[1] : '';
      $resolved = self::registerAsset($src[1][0], $node, $st) ?: self::absoluteSourceUrl($src[1][0], $node, $st);
      if (preg_match(self::IMAGE, $resolved) || strpos($resolved, 'files/') === 0) { return '<media-image source="' . self::escAttr($resolved) . '" alt="' . self::escAttr($alt) . '"></media-image>'; }
      return substr_replace($tag, ' src="' . self::escAttr($resolved) . '"', $src[0][1], strlen($src[0][0]));
    }, $html);
    $html = preg_replace_callback('/(<video-player\b[^>]*?\ssource=")([^"]*)(")/i', function ($m) use ($node, &$st) {
      $source = $m[2];
      if ($source === '' || self::startsWith($source, 'files/') || self::startsWith($source, 'http')) { return $m[0]; }
      return $m[1] . self::escAttr(self::registerAsset($source, $node, $st) ?: self::absoluteSourceUrl($source, $node, $st)) . $m[3];
    }, $html);
    return preg_replace_callback('/(<a\b[^>]*?\shref=")([^"]*)(")/i', function ($m) use ($node, &$st) {
      $href = $m[2];
      if ($href === '' || $href[0] === '#' || self::isExternal($href)) { return $m[0]; }
      $doc = self::resolveDocPath(explode('#', $href)[0], $st['src'], $node);
      if (!empty($st['slugByPath'][$doc])) { $hash = strpos($href, '#') !== false ? substr($href, strpos($href, '#')) : ''; return $m[1] . $st['slugByPath'][$doc] . $hash . $m[3]; }
      return $m[1] . self::escAttr(self::registerAsset($href, $node, $st) ?: self::absoluteSourceUrl($href, $node, $st)) . $m[3];
    }, $html);
  }

  private static function renderPage($ctx, $text, $node, &$item, &$st) {
    $fm = self::frontMatter(preg_replace('/\r\n?/', "\n", $text));
    if (isset($fm['data']['title']) && is_string($fm['data']['title']) && trim($fm['data']['title']) !== '') { $item['title'] = trim($fm['data']['title']); }
    $held = [];
    $body = self::mapVueComponents($fm['body'], $node, $st, $held);
    $html = trim(self::strip(self::rewrite(self::renderTree($ctx, self::parseBody($body, $held)), $node, $st)));
    return $html === '' ? '<p></p>' : $html;
  }

  private static function fallback($source) {
    return $source ? '<p>Read this page on <a href="' . self::escAttr($source) . '">the source site</a>.</p>' : '<p></p>';
  }

  private static function findConfig($paths) {
    $rank = function ($p) { return self::startsWith($p, 'docs/.vitepress/') ? 0 : (self::startsWith($p, '.vitepress/') ? 1 : 2); };
    $c = array_values(array_filter(array_map('strval', array_keys($paths)), function ($p) { return (bool) preg_match(self::CONFIG, $p); }));
    usort($c, function ($a, $b) use ($rank) {
      $d = $rank($a) - $rank($b);
      if ($d !== 0) { return $d; }
      $d = count(explode('/', $a)) - count(explode('/', $b));
      return $d !== 0 ? $d : self::byText($a, $b);
    });
    return $c ? $c[0] : null;
  }

  private function importSite($ctx, $src) {
    $configPath = self::findConfig($src['paths']);
    if ($configPath === null) { return ['error' => 'no .vitepress/config file found in ' . ($src['repo'] ?: $src['name'])]; }
    $configText = ($src['read'])($configPath);
    if ($configText === null) { return ['error' => "unable to read $configPath"]; }
    $src['docsRoot'] = preg_replace('/\/$/', '', substr($configPath, 0, strpos($configPath, '.vitepress/')));
    $src['config'] = self::readConfig($configText);
    $outline = $src['config']['sidebar'] !== null ? self::outlineFromSidebar($src['config']['sidebar'], $src) : self::outlineFromTree($src);
    if (!$outline) { return ['error' => 'the VitePress site has no pages to import']; }
    $st = ['src' => $src, 'files' => [], 'fileNames' => [], 'filesByPath' => [], 'slugByPath' => []];
    $items = []; $used = [];
    $siteUrl = $src['config']['siteUrl'];
    $base = $src['config']['base'];
    foreach ($outline as $node) {
      $parent = $node['parentIndex'] === null ? null : $items[$node['parentIndex']];
      $slug = $parent ? $parent['slug'] . '/' . self::titleSlug($node['title']) : self::titleSlug($node['title']);
      for ($n = 2, $s = $slug; isset($used[$slug]); $n++) { $slug = "$s-$n"; }
      $used[$slug] = true;
      $metadata = ['sourceType' => 'vitepress', 'vitepress' => ['repo' => $src['repo'], 'branch' => $src['branch'], 'path' => $node['path']]];
      $link = $node['link'];
      if ($link !== null && $link !== '' && $base !== null && $base !== '' && self::startsWith($link, $base)) { $link = '/' . substr($link, strlen($base)); }
      if ($link !== null && $link !== '' && $siteUrl !== null && $siteUrl !== '') { $metadata['source'] = preg_replace('/\/$/', '', $siteUrl) . (($base !== null && $base !== '') ? preg_replace('/\/$/', '', $base) : '') . $link; }
      $items[] = ['id' => 'item-' . (count($items) + 1), 'title' => $node['title'], 'slug' => $slug, 'parent' => $parent ? $parent['id'] : null, 'order' => $node['order'], 'indent' => $node['depth'], 'content' => '<p></p>', 'metadata' => $metadata];
      if ($node['path']) { $st['slugByPath'][$node['path']] = $slug; }
    }
    $read = 0;
    foreach ($outline as $k => $node) {
      if (!$node['path']) { continue; }
      $source = $items[$k]['metadata']['source'] ?? null;
      if ($read >= self::MAX_PAGES) { $items[$k]['content'] = self::fallback($source); continue; }
      $text = ($src['read'])($node['path']);
      $read++;
      $items[$k]['content'] = $text === null ? self::fallback($source) : self::renderPage($ctx, $text, $node, $items[$k], $st);
    }
    return ['title' => ($src['config']['title'] !== null && $src['config']['title'] !== '') ? $src['config']['title'] : $src['name'], 'items' => $items, 'files' => $st['files']];
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Reads a VitePress site from a GitHub repository (or an uploaded zip of one): the sidebar out of
   * .vitepress/config.* as plain data (the config is never executed; without a readable sidebar, the markdown file
   * tree), then each page with its front matter title, containers and Vue components. Markdown is converted by
   * import.file, and repository images and files the pages use are listed for core to fetch.
   *
   * @param object $ctx    Platform context (spec/13); $ctx->fetch() reaches only api.github.com and raw.githubusercontent.com.
   * @param array  $input  [url] of the repository (https://github.com/<owner>/<repo>, optionally /tree/<branch>), or [files => [[name, data (base64)]]] with one .zip.
   * @return array  [title, items, files] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    $input = is_array($input) ? $input : [];
    try {
      if (!empty($input['files']) && is_array($input['files'])) {
        $f = is_array($input['files'][0] ?? null) ? $input['files'][0] : [];
        if (!preg_match('/\.zip$/i', (string) ($f['name'] ?? ''))) { return ['error' => 'expected a .zip of the VitePress site']; }
        $src = $this->fromArchive($ctx, $f);
      } elseif (!empty($input['url'])) { $src = $this->fromGithub($ctx, $input['url']); }
      else { return ['error' => 'url or files is required']; }
      if (isset($src['error'])) { return $src; }
      return $this->importSite($ctx, $src);
    } catch (Exception $e) {
      return ['error' => $e->getMessage()];
    }
  }
}

<?php
// Quarto importer (PHP). Mirrors src/nodejs/index.js; both return identical results.
// Port of core's convertQuartoToSite.php, kept to the main path: _quarto.yml navigation, pages, front matter titles,
// code chunks, callouts and fenced divs. Markdown goes to import.file (import-markdown) through the platform.
class ImporterQuartoPlugin {
  const API = 'https://api.github.com';
  const RAW = 'https://raw.githubusercontent.com';
  const MAX_PAGES = 500;
  const CONFIG = '/(^|\/)_quarto\.ya?ml$/';
  const PAGE = '/\.(qmd|rmd|md)$/i';
  const PAGE_EXTENSIONS = ['.qmd', '.Rmd', '.rmd', '.md'];
  const IMPORTABLE = '/\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|xml)$/i';
  const IMAGE = '/\.(jpg|jpeg|png|gif|webp)$/i';
  const CALLOUTS = [
    'note' => ['status' => 'info', 'title' => 'Note'],
    'tip' => ['status' => 'success', 'title' => 'Tip'],
    'important' => ['status' => 'stop', 'title' => 'Important'],
    'warning' => ['status' => 'warning', 'title' => 'Warning'],
    'caution' => ['status' => 'warning', 'title' => 'Caution'],
  ];
  const SHORTCODE = '/\{\{<\s*([A-Za-z0-9_-]+)\s*([\s\S]*?)\s*>\}\}/';
  const KEY = '/^("[^"]*"|\'[^\']*\'|[^\s"\'#][^:#]*?)\s*:(?:\s+(.*))?$/';

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
  private static function byText($a, $b) { return $a < $b ? -1 : ($a > $b ? 1 : 0); }
  private static function encComponent($s) { return strtr(rawurlencode($s), ['%21' => '!', '%2A' => '*', '%27' => "'", '%28' => '(', '%29' => ')']); }
  private static function encPath($p) { return implode('/', array_map([self::class, 'encComponent'], explode('/', $p))); }
  private static function first($s) { return substr((string) $s, 0, 1); }

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

  // ---- a YAML subset: block maps, block lists, scalars, [a, b] lists, | and > text. Enough for _quarto.yml. ----

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

  private static function frontMatter($md) {
    if (!preg_match('/^---\n([\s\S]*?)\n---[ \t]*(\n|$)/', $md, $m)) { return ['data' => [], 'body' => $md]; }
    $data = [];
    foreach (explode("\n", $m[1]) as $line) { if (preg_match('/^([A-Za-z0-9_-]+):\s+(.*)$/', $line, $k)) { $data[$k[1]] = self::scalar($k[2]); } }
    return ['data' => $data, 'body' => substr($md, strlen($m[0]))];
  }

  // ---- reading the project: GitHub (core's path) or an uploaded zip of the repository ----

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
    try { $texts = $ctx->archive->read((string) ($file['data'] ?? ''), ['match' => '\.(qmd|Qmd|md|rmd|Rmd|yml|yaml)$']); } catch (Exception $e) { return ['error' => 'the file is not a zip archive']; }
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
    return ['name' => preg_replace('/\.zip$/i', '', (string) ($file['name'] ?? 'project')), 'repo' => null, 'branch' => null, 'paths' => $paths, 'read' => $read, 'rawUrl' => null];
  }

  // ---- the outline (port of core's book / sidebar / navbar / file tree readers) ----

  private static function readConfig($data) {
    $project = self::isObject($data['project'] ?? null) ? $data['project'] : [];
    $book = self::isObject($data['book'] ?? null) ? $data['book'] : [];
    $website = self::isObject($data['website'] ?? null) ? $data['website'] : [];
    $sidebar = null;
    $sb = $website['sidebar'] ?? null;
    foreach ((is_array($sb) && array_is_list($sb)) ? $sb : [$sb] as $s) { if (self::isObject($s) && isset($s['contents']) && is_array($s['contents']) && array_is_list($s['contents'])) { $sidebar = $s['contents']; break; } }
    $render = (isset($project['render']) && is_array($project['render'])) ? array_values(array_filter($project['render'], 'is_string')) : null;
    $title = self::stringOf($book['title'] ?? null);
    $siteUrl = self::stringOf($book['site-url'] ?? null);
    return [
      'title' => $title !== '' ? $title : self::stringOf($website['title'] ?? null),
      'siteUrl' => $siteUrl !== '' ? $siteUrl : self::stringOf($website['site-url'] ?? null),
      'outputDir' => preg_replace('/^\.?\/|\/$/', '', self::stringOf($project['output-dir'] ?? null)),
      'render' => $render,
      'chapters' => (isset($book['chapters']) && is_array($book['chapters'])) ? $book['chapters'] : null,
      'appendices' => (isset($book['appendices']) && is_array($book['appendices'])) ? $book['appendices'] : null,
      'sidebar' => $sidebar,
      'navbar' => self::isObject($website['navbar'] ?? null) ? $website['navbar'] : null,
    ];
  }

  private static function rootPrefix($src) { return $src['root'] === '' ? '' : $src['root'] . '/'; }

  private static function globToRegExp($pattern) {
    $s = '';
    for ($i = 0; $i < strlen($pattern); $i++) {
      $c = $pattern[$i];
      if ($c === '*' && ($pattern[$i + 1] ?? '') === '*') { $s .= '.*'; $i++; }
      elseif ($c === '*') { $s .= '[^\/]*'; }
      elseif ($c === '?') { $s .= '[^\/]'; }
      else { $s .= preg_quote($c, '/'); }
    }
    return '/^' . $s . '$/';
  }

  private static function isIgnored($rel, $src) {
    $segs = explode('/', $rel);
    foreach ($segs as $i => $seg) {
      if (self::first($seg) === '.' || self::first($seg) === '_') { return true; }
      if ($i < count($segs) - 1 && (preg_match('/^(node_modules|renv|venv|site-packages)$/', $seg) || preg_match('/_(files|cache)$/', $seg))) { return true; }
    }
    $name = $segs[count($segs) - 1];
    if (preg_match('/^readme\.(md|qmd|rmd|ipynb)$/i', $name) || preg_match('/^(agents|claude)\.md$/i', $name)) { return true; }
    $out = $src['config']['outputDir'];
    return $out !== '' && ($rel === $out || strpos($rel, "$out/") === 0);
  }

  private static function isRenderable($rel, $src) {
    $render = $src['config']['render'];
    if (!$render) { return true; }
    $included = true;
    foreach ($render as $e) { if (self::first($e) !== '!') { $included = false; break; } }
    foreach ($render as $e) {
      $neg = self::first($e) === '!';
      if (preg_match(self::globToRegExp(preg_replace('/^\.?\//', '', $neg ? substr($e, 1) : $e)), $rel)) { $included = !$neg; }
    }
    return $included;
  }

  private static function listPages($src) {
    $prefix = self::rootPrefix($src);
    $out = [];
    foreach (array_keys($src['paths']) as $p) {
      $p = (string) $p;
      if ($prefix !== '' && strpos($p, $prefix) !== 0) { continue; }
      $r = substr($p, strlen($prefix));
      if (preg_match(self::PAGE, $r) && !self::isIgnored($r, $src) && self::isRenderable($r, $src)) { $out[] = $r; }
    }
    $isIndex = function ($p) { return preg_match('/(^|\/)index\.[a-z]+$/i', $p) ? 0 : 1; };
    usort($out, function ($a, $b) use ($isIndex) {
      $d = count(explode('/', $a)) - count(explode('/', $b));
      if ($d !== 0) { return $d; }
      $d = $isIndex($a) - $isIndex($b);
      return $d !== 0 ? $d : self::byText($a, $b);
    });
    return $out;
  }

  private static function resolvePagePath($ref, $src) {
    $clean = trim(explode('?', explode('#', (string) $ref)[0])[0]);
    if ($clean === '' || !preg_match(self::PAGE, $clean)) { return null; }
    $p = self::normalizePath(self::rootPrefix($src) . $clean);
    return isset($src['paths'][$p]) ? $p : null;
  }

  private static function describeEntry($entry) {
    if (is_string($entry)) { return ['target' => trim($entry), 'label' => '', 'children' => null, 'auto' => null]; }
    if (!self::isObject($entry)) { return null; }
    $target = self::stringOf($entry['href'] ?? null);
    if ($target === '') { $target = self::stringOf($entry['file'] ?? null); }
    $label = self::stringOf($entry['text'] ?? null);
    $children = null;
    $isList = function ($v) { return is_array($v) && array_is_list($v); };
    if (isset($entry['part']) && is_string($entry['part'])) {
      if (preg_match(self::PAGE, trim($entry['part']))) { if ($target === '') { $target = trim($entry['part']); } }
      elseif ($label === '') { $label = trim($entry['part']); }
      $children = $isList($entry['chapters'] ?? null) ? $entry['chapters'] : [];
    } elseif (isset($entry['section']) && is_string($entry['section'])) {
      if (trim($entry['section']) !== '') { $label = trim($entry['section']); }
      $children = $isList($entry['contents'] ?? null) ? $entry['contents'] : [];
    } elseif ($isList($entry['menu'] ?? null)) { $children = $entry['menu']; }
    elseif ($isList($entry['contents'] ?? null)) { $children = $entry['contents']; }
    $auto = null;
    $a = $entry['auto'] ?? null;
    if ($a === true || $a === 'true') { $auto = []; }
    elseif (is_string($a)) { $auto = [$a]; }
    elseif ($isList($a)) { $auto = array_values(array_filter($a, 'is_string')); }
    return ['target' => $target, 'label' => $label, 'children' => $children, 'auto' => $auto];
  }

  private static function addNode(&$b, $path, $label, $depth, $parentIndex, $order) {
    $relative = $path === null ? null : substr($path, strlen(self::rootPrefix($b['src'])));
    $b['nodes'][] = ['title' => $label !== '' ? $label : ($relative ? self::titleFromPath($relative) : 'Untitled'), 'explicit' => $label !== '', 'path' => $path, 'relative' => $relative, 'depth' => $depth, 'order' => $order, 'parentIndex' => $parentIndex];
    if ($path !== null) { $b['used'][$path] = true; }
    return count($b['nodes']) - 1;
  }

  private static function addGlobNodes($globs, $depth, $parentIndex, &$b, $order) {
    foreach (self::listPages($b['src']) as $rel) {
      if ($globs) {
        $hit = false;
        foreach ($globs as $g) { if (preg_match(self::globToRegExp(preg_replace('/^\.?\//', '', $g)), $rel)) { $hit = true; break; } }
        if (!$hit) { continue; }
      }
      $path = self::rootPrefix($b['src']) . $rel;
      if (!empty($b['used'][$path])) { continue; }
      self::addNode($b, $path, '', $depth, $parentIndex, $order++);
    }
    return $order;
  }

  private static function walkEntries($entries, $depth, $parentIndex, &$b, $order) {
    foreach ($entries as $e) {
      $info = self::describeEntry($e);
      if (!$info) { continue; }
      if (preg_match('/^-{3,}$/', $info['target']) || preg_match('/^-{3,}$/', $info['label'])) { continue; }
      if ($info['auto'] !== null) { $order = self::addGlobNodes($info['auto'], $depth, $parentIndex, $b, $order); continue; }
      if (strpos($info['target'], '*') !== false) { $order = self::addGlobNodes([$info['target']], $depth, $parentIndex, $b, $order); continue; }
      $external = $info['target'] !== '' && self::isExternal($info['target']);
      if ($external && $info['children'] === null) { continue; }
      $path = $external ? null : self::resolvePagePath($info['target'], $b['src']);
      if ($path !== null && !empty($b['used'][$path])) { $path = null; }
      if ($path === null && $info['label'] === '' && $info['children'] === null) { continue; }
      $node = self::addNode($b, $path, $info['label'], $depth, $parentIndex, $order++);
      if ($info['children'] !== null) { self::walkEntries($info['children'], $depth + 1, $node, $b, 0); }
    }
    return $order;
  }

  private static function buildOutline($src) {
    $c = $src['config'];
    $b = ['src' => $src, 'nodes' => [], 'used' => []];
    if ($c['chapters'] !== null || $c['appendices'] !== null) {
      $order = $c['chapters'] !== null ? self::walkEntries($c['chapters'], 0, null, $b, 0) : 0;
      if ($c['appendices'] !== null) { self::walkEntries($c['appendices'], 0, null, $b, $order); }
    } elseif ($c['sidebar'] !== null) { self::walkEntries($c['sidebar'], 0, null, $b, 0); }
    elseif ($c['navbar'] !== null) {
      $order = 0;
      foreach (['left', 'right'] as $side) { if (isset($c['navbar'][$side]) && is_array($c['navbar'][$side]) && array_is_list($c['navbar'][$side])) { $order = self::walkEntries($c['navbar'][$side], 0, null, $b, $order); } }
    }
    if (!$b['nodes']) { self::addGlobNodes([], 0, null, $b, 0); }
    return $b['nodes'];
  }

  private static function titleFromPath($path) {
    $parts = explode('/', $path);
    $words = trim(preg_replace('/[-_]+/', ' ', preg_replace(self::PAGE, '', end($parts))));
    return ($words === '' || strtolower($words) === 'index') ? 'Home' : self::ucfirst($words);
  }

  // ---- page bodies ----

  private static function parseAttributes($text) {
    $out = ['id' => '', 'classes' => [], 'values' => []];
    preg_match_all('/(?:#([^\s.#}"\']+))|(?:\.([^\s.#}"\']+))|([A-Za-z][A-Za-z0-9_:-]*)(?:\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'}]+)))?/', $text, $all, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);
    foreach ($all as $m) {
      if (($m[1] ?? null) !== null) { $out['id'] = $m[1]; }
      elseif (($m[2] ?? null) !== null) { $out['classes'][] = $m[2]; }
      elseif (($m[3] ?? null) !== null) { $out['values'][$m[3]] = $m[4] ?? $m[5] ?? $m[6] ?? 'true'; }
    }
    return $out;
  }

  private static function headingText($text) {
    $t = preg_replace('/\s*\{[^}]*\}\s*$/', '', $text);
    $t = preg_replace('/\*\*(.+?)\*\*/', '$1', $t);
    $t = preg_replace('/\*(.+?)\*/', '$1', $t);
    return trim(preg_replace('/`(.+?)`/', '$1', $t));
  }

  private static function appliesToHtml($values) {
    $names = function ($v) { return array_values(array_filter(preg_split('/[\s,]+/', strtolower(self::stringOf($v))), function ($n) { return $n !== ''; })); };
    $when = $names($values['when-format'] ?? null);
    $unless = $names($values['unless-format'] ?? null);
    if ($when && !in_array('html', $when, true)) { return false; }
    return !in_array('html', $unless, true);
  }

  private static function codeBlock($info, $code) {
    if (preg_match('/^\{=([A-Za-z0-9_-]+)\}$/', $info, $raw)) { return strtolower($raw[1]) === 'html' ? ['html' => implode("\n", $code)] : null; }
    $lang = '';
    if (preg_match('/^\{\s*\.?([A-Za-z0-9_+-]+)\s*(?:,\s*|\s+)?([^}]*)\}$/', $info, $chunk)) {
      $options = [];
      while ($code && preg_match('/^\s*#\|/', $code[0])) {
        if (preg_match('/^\s*#\|\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/', array_shift($code), $o)) { $options[$o[1]] = strtolower(trim($o[2])); }
      }
      if (($options['echo'] ?? null) === 'false' || ($options['include'] ?? null) === 'false' || preg_match('/\b(echo|include)\s*=\s*(FALSE|F|false)\b/', $chunk[2] ?? '')) { return null; }
      $lang = $chunk[1];
    } else { $lang = preg_split('/\s+/', $info)[0]; }
    return ['lines' => array_merge(['```' . preg_replace('/[^\w-]/', '', $lang)], $code, ['```'])];
  }

  private static function outsideInlineCode($line, $fn) {
    $pieces = preg_split('/(`+[^`]*`+)/', $line, -1, PREG_SPLIT_DELIM_CAPTURE);
    foreach ($pieces as $i => $p) { if ($i % 2 === 0) { $pieces[$i] = $fn($p); } }
    return implode('', $pieces);
  }

  private static function transformInline($line) {
    $r = preg_replace('/^(#{1,6}\s+.*?)\s+\{[^}]*\}\s*$/', '$1', $line);
    $r = preg_replace('/^:\s+(.+?)\s*\{#tbl-[^}]*\}\s*$/', '*$1*', $r);
    $before = $r;
    $r = preg_replace_callback('/!\[((?:[^\]`]|`[^`]*`)*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\{([^}]*)\}/', function ($m) use ($before) {
      if (substr_count(substr($before, 0, $m[0][1]), '`') % 2 === 1) { return $m[0][0]; }
      $alt = self::parseAttributes($m[3][0])['values']['fig-alt'] ?? '';
      return '![' . ($alt !== '' ? $alt : $m[1][0]) . '](' . $m[2][0] . ')';
    }, $r, -1, $count, PREG_OFFSET_CAPTURE);
    return self::outsideInlineCode($r, function ($piece) {
      $piece = preg_replace('/(\[[^\]]*\]\([^)]*\))\{[^}]*\}/', '$1', $piece);
      $piece = preg_replace_callback('/\[([^\]]+)\]\{([^}]*)\}/', function ($m) {
        $a = self::parseAttributes($m[2]);
        return $a['classes'] ? '<span class="' . self::escAttr(implode(' ', $a['classes'])) . '">' . $m[1] . '</span>' : $m[1];
      }, $piece);
      return preg_replace('/(^|[^\w@])@((?:fig|tbl|sec|eq|lst|thm|lem|cor|prp|cnj|def|exm|exr)-[\w:.-]*[\w])/', '$1$2', $piece);
    });
  }

  private static function shortcodes($line, $node, &$st) {
    $parts = [];
    $last = 0;
    preg_match_all(self::SHORTCODE, $line, $all, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
    foreach ($all as $m) {
      $parts[] = substr($line, $last, $m[0][1] - $last);
      $last = $m[0][1] + strlen($m[0][0]);
      $html = '';
      if (strtolower($m[1][0]) === 'video') {
        $source = preg_match('/^(?:"([^"]*)"|\'([^\']*)\'|(\S+))/', $m[2][0], $a, PREG_UNMATCHED_AS_NULL) ? ($a[1] ?? $a[2] ?? $a[3]) : '';
        $title = preg_match('/\btitle=(?:"([^"]*)"|\'([^\']*)\'|(\S+))/', $m[2][0], $t, PREG_UNMATCHED_AS_NULL) ? ($t[1] ?? $t[2] ?? $t[3]) : null;
        if ($source !== '') {
          $resolved = self::isExternal($source) ? $source : (self::registerAsset($source, $node, $st) ?: self::absoluteSourceUrl($source, $node, $st));
          $html = '<video-player source="' . self::escAttr($resolved) . '"' . ($title !== null ? ' media-title="' . self::escAttr($title) . '"' : '') . '></video-player>';
        }
      }
      $parts[] = $html;
    }
    $parts[] = substr($line, $last);
    return $parts;
  }

  private static function parseBody($body, $node, &$st) {
    $lines = explode("\n", $body);
    $tree = [[]];      // children lists, one per open frame
    $frames = [['kind' => 'root']];
    $md = [];
    $dropping = function () use (&$frames) { foreach ($frames as $f) { if ($f['kind'] === 'drop') { return true; } } return false; };
    $flush = function () use (&$md, &$tree) { if ($md) { $tree[count($tree) - 1][] = ['md' => implode("\n", $md)]; } $md = []; };
    $push = function ($n) use (&$tree) { $tree[count($tree) - 1][] = $n; };
    $close = function () use (&$tree, &$frames) {
      $f = array_pop($frames);
      $children = array_pop($tree);
      if ($f['kind'] === 'wrap') { $f['children'] = $children; $tree[count($tree) - 1][] = $f; }
    };
    for ($i = 0; $i < count($lines); $i++) {
      $line = $lines[$i];
      if (preg_match('/^\s{0,3}(`{3,}|~{3,})\s*(.*)$/', $line, $open) && !($open[1][0] === '`' && strpos($open[2], '`') !== false)) {
        $code = []; $closed = false;
        for ($j = $i + 1; $j < count($lines); $j++) {
          if (preg_match('/^\s{0,3}(`{3,}|~{3,})\s*$/', $lines[$j], $c) && $c[1][0] === $open[1][0] && strlen($c[1]) >= strlen($open[1])) { $closed = true; break; }
          $code[] = $lines[$j];
        }
        $i = $closed ? $j : count($lines);
        if ($dropping()) { continue; }
        $block = self::codeBlock(trim($open[2]), $code);
        if ($block && isset($block['html'])) { $flush(); $push(['html' => $block['html']]); }
        elseif ($block) { array_push($md, ...$block['lines']); }
        continue;
      }
      if (preg_match('/^\s{0,3}(:{3,})\s*(.*?)\s*$/', $line, $fence)) {
        $attrText = trim(preg_replace('/\s*:+\s*$/', '', $fence[2]));
        if ($attrText === '') {
          if (count($frames) > 1) { $flush(); $close(); }
          continue;
        }
        $flush();
        if ($dropping()) { $frames[] = ['kind' => 'drop']; $tree[] = []; continue; }
        $a = $attrText[0] === '{' ? self::parseAttributes(preg_replace('/^\{|\}$/', '', $attrText)) : ['id' => '', 'classes' => array_values(array_filter(preg_split('/\s+/', $attrText), function ($n) { return $n !== ''; })), 'values' => []];
        $callout = null;
        foreach ($a['classes'] as $cl) { if (preg_match('/^callout-(note|tip|important|warning|caution)$/', $cl, $cm)) { $callout = $cm[1]; break; } }
        if ($callout !== null) {
          $title = self::stringOf($a['values']['title'] ?? null);
          if ($title === '') {
            $n = $i + 1;
            while ($n < count($lines) && trim($lines[$n]) === '') { $n++; }
            if ($n < count($lines) && preg_match('/^#{1,6}\s+(.+?)\s*$/', $lines[$n], $h)) { $title = self::headingText($h[1]); $lines[$n] = ''; }
          }
          $c = self::CALLOUTS[$callout];
          $frame = ['kind' => 'wrap', 'open' => '<stop-note status="' . self::escAttr($c['status']) . '" title="' . self::escAttr($title !== '' ? $title : $c['title']) . '"><div slot="message">', 'close' => '</div></stop-note>'];
        } elseif (in_array('content-visible', $a['classes'], true) || in_array('content-hidden', $a['classes'], true)) {
          $applies = self::appliesToHtml($a['values']);
          $keep = in_array('content-visible', $a['classes'], true) ? $applies : !$applies;
          $frame = $keep ? ['kind' => 'wrap', 'open' => '', 'close' => ''] : ['kind' => 'drop'];
        } else {
          $frame = ['kind' => 'wrap', 'open' => '<div' . ($a['id'] !== '' ? ' id="' . self::escAttr($a['id']) . '"' : '') . ($a['classes'] ? ' class="' . self::escAttr(implode(' ', $a['classes'])) . '"' : '') . '>', 'close' => '</div>'];
        }
        $frames[] = $frame; $tree[] = [];
        continue;
      }
      if ($dropping()) { continue; }
      $parts = self::shortcodes($line, $node, $st);
      foreach ($parts as $k => $p) {
        if ($k % 2 === 1) { if ($p !== '') { $flush(); $push(['html' => $p]); } continue; }
        if (count($parts) === 1 || trim($p) !== '') { $md[] = self::transformInline($p); }
      }
    }
    $flush();
    while (count($frames) > 1) { $close(); }
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

  private static function dirOf($node, $prefix) {
    return $node['path'] ? implode('/', array_slice(explode('/', $node['path']), 0, -1)) : preg_replace('/\/$/', '', $prefix);
  }

  private static function resolveAssetPath($ref, $node, $st) {
    $prefix = self::rootPrefix($st['src']);
    $candidate = self::first($ref) === '/' ? self::normalizePath($prefix . $ref) : self::normalizePath(self::dirOf($node, $prefix) . '/' . $ref);
    return isset($st['src']['paths'][$candidate]) ? $candidate : null;
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
    $prefix = self::rootPrefix($st['src']);
    return ($st['src']['rawUrl'])(self::first($clean) === '/' ? self::normalizePath($prefix . $clean) : self::normalizePath(self::dirOf($node, $prefix) . '/' . $clean));
  }

  private static function resolveDocPath($link, $node, $st) {
    $target = explode('?', explode('#', (string) $link)[0])[0];
    if ($target === '') { return null; }
    $target = preg_replace(self::PAGE, '', preg_replace('/\.html$/i', '', $target));
    $dir = $node['path'] ? implode('/', array_slice(explode('/', $node['path']), 0, -1)) : '';
    $base = self::first($target) === '/' ? self::normalizePath(self::rootPrefix($st['src']) . $target) : self::normalizePath(($dir === '' ? self::rootPrefix($st['src']) : $dir) . '/' . $target);
    $candidates = [];
    foreach (self::PAGE_EXTENSIONS as $e) { $candidates[] = $base . $e; }
    foreach (self::PAGE_EXTENSIONS as $e) { $candidates[] = "$base/index$e"; }
    foreach ($candidates as $c) { if (isset($st['src']['paths'][$c])) { return $c; } }
    return null;
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
    return preg_replace_callback('/(<a\b[^>]*?\shref=")([^"]*)(")/i', function ($m) use ($node, &$st) {
      $href = $m[2];
      if ($href === '' || $href[0] === '#' || self::isExternal($href)) { return $m[0]; }
      $doc = self::resolveDocPath($href, $node, $st);
      if ($doc !== null && !empty($st['slugByPath'][$doc])) { $hash = strpos($href, '#') !== false ? substr($href, strpos($href, '#')) : ''; return $m[1] . $st['slugByPath'][$doc] . $hash . $m[3]; }
      return $m[1] . self::escAttr(self::registerAsset($href, $node, $st) ?: self::absoluteSourceUrl($href, $node, $st)) . $m[3];
    }, $html);
  }

  private static function renderPage($ctx, $text, &$node, &$item, &$st) {
    $fm = self::frontMatter(preg_replace('/\r\n?/', "\n", $text));
    $body = $fm['body'];
    $title = self::stringOf($fm['data']['title'] ?? null);
    if ($title === '') {
      $lines = explode("\n", $body);
      $i = 0;
      while ($i < count($lines) && trim($lines[$i]) === '') { $i++; }
      if ($i < count($lines) && preg_match('/^#\s+(.+?)\s*$/', $lines[$i], $h) && self::headingText($h[1]) !== '') { $title = self::headingText($h[1]); array_splice($lines, $i, 1); $body = implode("\n", $lines); }
    }
    if ($title !== '' && !$node['explicit']) { $item['title'] = $title; }
    $html = trim(self::strip(self::rewrite(self::renderTree($ctx, self::parseBody($body, $node, $st)), $node, $st)));
    return $html === '' ? '<p></p>' : $html;
  }

  private static function fallback($source) {
    return $source ? '<p>Read this page on <a href="' . self::escAttr($source) . '">the source site</a>.</p>' : '<p></p>';
  }

  private function importProject($ctx, $src) {
    $configs = array_values(array_filter(array_map('strval', array_keys($src['paths'])), function ($p) { return (bool) preg_match(self::CONFIG, $p); }));
    usort($configs, function ($a, $b) { $d = count(explode('/', $a)) - count(explode('/', $b)); return $d !== 0 ? $d : self::byText($a, $b); });
    if (!$configs) { return ['error' => 'no _quarto.yml found in ' . ($src['repo'] ?: $src['name'])]; }
    $configPath = $configs[0];
    $configText = ($src['read'])($configPath);
    if ($configText === null) { return ['error' => "unable to read $configPath"]; }
    $src['root'] = strpos($configPath, '/') !== false ? substr($configPath, 0, strrpos($configPath, '/')) : '';
    $src['config'] = self::readConfig(self::parseYaml($configText));
    $outline = self::buildOutline($src);
    if (!$outline) { return ['error' => 'the Quarto project has no pages to import']; }
    $st = ['src' => $src, 'files' => [], 'fileNames' => [], 'filesByPath' => [], 'slugByPath' => []];
    $items = []; $used = [];
    foreach ($outline as $node) {
      $parent = $node['parentIndex'] === null ? null : $items[$node['parentIndex']];
      $slug = $parent ? $parent['slug'] . '/' . self::titleSlug($node['title']) : self::titleSlug($node['title']);
      for ($n = 2, $s = $slug; isset($used[$slug]); $n++) { $slug = "$s-$n"; }
      $used[$slug] = true;
      $metadata = ['sourceType' => 'quarto', 'quarto' => ['repo' => $src['repo'], 'branch' => $src['branch'], 'path' => $node['path']]];
      if ($node['relative'] && $src['config']['siteUrl'] !== '') { $metadata['source'] = preg_replace('/\/$/', '', $src['config']['siteUrl']) . '/' . preg_replace(self::PAGE, '.html', $node['relative']); }
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
    return ['title' => $src['config']['title'] !== '' ? $src['config']['title'] : $src['name'], 'items' => $items, 'files' => $st['files']];
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Reads a Quarto book or website from a GitHub repository (or an uploaded zip of one): the outline from
   * _quarto.yml (book chapters and parts, sidebar, navbar, else the file tree), then each page with its front
   * matter title, code chunks, callouts (as stop-note) and fenced divs. Markdown is converted by import.file, and
   * repository images and files the pages use are listed for core to fetch.
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
        if (!preg_match('/\.zip$/i', (string) ($f['name'] ?? ''))) { return ['error' => 'expected a .zip of the Quarto project']; }
        $src = $this->fromArchive($ctx, $f);
      } elseif (!empty($input['url'])) { $src = $this->fromGithub($ctx, $input['url']); }
      else { return ['error' => 'url or files is required']; }
      if (isset($src['error'])) { return $src; }
      return $this->importProject($ctx, $src);
    } catch (Exception $e) {
      return ['error' => $e->getMessage()];
    }
  }
}

<?php
// Notion importer (PHP). Mirrors src/nodejs/index.js; both return identical results.
class ImporterNotionPlugin {
  const API = 'https://api.github.com';
  const RAW = 'https://raw.githubusercontent.com';
  const HEAD_MATTER = '/#\s(.*?)\n\n?(.*?):\s(.*)\n(.*?):\s((.|\n)*?)\n\n/im';
  const HEAD_TITLE = '/(#\s)(.*?)\n/';
  const HEAD_LINE = '/(.*?)(:\s)(.*)/im';
  const PAGE_TYPES = ['📙 Reading' => 'reading', '💬 Canvas Discussion' => 'discuss', '⚡️ Exercise' => 'activity', '🔎 Case Study' => 'connection'];

  private function replaceFirst($s, $find, $with) {
    if ($find === '') { return $with . $s; }
    $i = strpos($s, $find);
    return $i === false ? $s : substr_replace($s, $with, $i, strlen($find));
  }

  // HAXCMS.cleanTitle from core
  public function cleanTitle($value) {
    $t = $this->replaceFirst($this->replaceFirst(trim((string) $value), 'pages/', ''), '/index.html', '');
    $t = preg_replace('/--+/', '-', preg_replace('/[^\w\-\/]+/', '-', mb_strtolower(str_replace(' ', '-', $t))));
    return $t === '' ? 'blank' : $t;
  }

  private function toInt($value) {
    return preg_match('/^\s*([+-]?\d+)/', (string) $value, $m) ? (int) $m[1] : 0;
  }

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

  private function strip($html) {
    return self::cleanHtml($html, ['script'], [], false);
  }

  // JavaScript's encodeURI
  private function encodeUri($s) {
    return strtr(rawurlencode($s), ['%3B' => ';', '%2C' => ',', '%2F' => '/', '%3F' => '?', '%3A' => ':', '%40' => '@', '%26' => '&', '%3D' => '=', '%2B' => '+', '%24' => '$', '%21' => '!', '%2A' => '*', '%27' => "'", '%28' => '(', '%29' => ')', '%23' => '#']);
  }

  public function parseRepo($url) {
    if (!preg_match('/^https?:\/\/(?:www\.)?github\.com\/([^\/?#]+)\/([^\/?#]+)(?:\/tree\/([^\/?#]+))?/i', trim((string) $url), $m)) { return null; }
    return ['owner' => $m[1], 'repo' => preg_replace('/\.git$/', '', $m[2]), 'branch' => !empty($m[3]) ? $m[3] : null];
  }

  private function fileKey($rel) {
    return str_replace(['%20', '%C', '%'], '', $this->encodeUri("files/$rel"));
  }

  private function readHeadMatter($md) {
    if (!preg_match(self::HEAD_MATTER, $md, $m)) { return ['headMatter' => '', 'title' => null, 'values' => []]; }
    $headMatter = $m[0];
    $title = preg_match(self::HEAD_TITLE, $headMatter, $t) ? $t[2] : '';
    $values = [];
    preg_match_all(self::HEAD_LINE, $headMatter, $lines);
    foreach ($lines[0] as $line) {
      $parts = explode(':', $line);
      if (count($parts) >= 2) { $values[mb_strtolower(trim($parts[0]))] = trim($parts[1]); }
    }
    return ['headMatter' => $headMatter, 'title' => $title, 'values' => $values];
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Reads a Notion export from a GitHub repository: each markdown page becomes an item, grouped under a lesson page
   * made from its Lesson property, and every other file is listed for core to fetch into files/.
   * Markdown is converted by import.file (import-markdown); a page that cannot be read comes back empty.
   *
   * @param object $ctx    Platform context (spec/13); $ctx->fetch() reaches only api.github.com and raw.githubusercontent.com.
   * @param array  $input  [url] of the repository (https://github.com/<owner>/<repo>, optionally /tree/<branch>).
   * @return array  [title, items, files] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    if (empty($input['url'])) { return ['error' => 'url is required']; }
    $gh = $this->parseRepo($input['url']);
    if (!$gh) { return ['error' => 'url must be a GitHub repository (https://github.com/<owner>/<repo>)']; }
    $repoApi = self::API . '/repos/' . $gh['owner'] . '/' . $gh['repo'];
    $branch = $gh['branch'];
    if (!$branch) {
      try { $r = $ctx->fetch($repoApi); $d = $r['status'] < 400 ? $r['json'] : []; $branch = !empty($d['default_branch']) ? $d['default_branch'] : 'main'; }
      catch (Exception $e) { $branch = 'main'; }
    }
    try {
      $r = $ctx->fetch("$repoApi/git/trees/" . rawurlencode($branch) . '?recursive=1');
      if ($r['status'] >= 400) { throw new Exception('HTTP ' . $r['status']); }
      $tree = is_array($r['json']) && isset($r['json']['tree']) && is_array($r['json']['tree']) ? $r['json']['tree'] : [];
    } catch (Exception $e) { return ['error' => 'unable to read the repository file list: ' . $e->getMessage()]; }
    $paths = [];
    foreach ($tree as $f) { if (is_array($f) && ($f['type'] ?? '') !== 'tree' && is_string($f['path'] ?? null)) { $paths[] = $f['path']; } }
    $hasMd = false;
    foreach ($paths as $p) { if (substr($p, -3) === '.md') { $hasMd = true; break; } }
    if (!$hasMd) { return ['error' => 'the repository has no markdown pages']; }

    $base = '';
    foreach ($paths as $p) { if (strpos($p, '.csv') !== false) { $base = $this->replaceFirst($p, '.csv', ''); break; } }
    $rel = function ($p) use ($base) { return ($base !== '' && strpos($p, "$base/") === 0) ? substr($p, strlen($base) + 1) : $p; };
    $raw = function ($p) use ($gh, &$branch) { return self::RAW . '/' . $gh['owner'] . '/' . $gh['repo'] . '/' . $branch . '/' . $this->encodeUri($p); };

    $downloads = []; $fileMap = [];
    foreach ($paths as $p) {
      if (strpos($p, '.csv') !== false || strpos($p, '.md') !== false || strpos($p, '.') === false) { continue; }
      $key = $this->fileKey($rel($p));
      $downloads[$key] = $raw($p);
      $fileMap[$key] = $this->encodeUri($rel($p));
    }

    $items = []; $lessons = [];
    foreach ($paths as $p) {
      if (strpos($p, '.csv') !== false || strpos($p, '.md') === false) { continue; }
      try { $r = $ctx->fetch($raw($p)); $md = $r['status'] < 400 ? (string) $r['body'] : ''; } catch (Exception $e) { $md = ''; }
      $md = preg_replace('/\r\n?/', "\n", $md);
      $head = $this->readHeadMatter($md);
      $v = $head['values'];
      $lessonKey = $v['lesson'] ?? '';
      if ($lessonKey !== '' && !isset($lessons[$lessonKey])) {
        $parts = explode('. ', $lessonKey);
        if (count($parts) === 1) { $parts = ['0', $parts[0]]; }
        $slug = $this->cleanTitle(mb_strtolower($parts[1]));
        $lessons[$lessonKey] = count($items);
        $items[] = ['id' => "lesson-$slug", 'title' => $parts[1], 'slug' => $slug, 'parent' => null, 'order' => $this->toInt($parts[0]), 'indent' => 0, 'content' => '', 'metadata' => ['pageType' => 'lesson']];
      }
      $md = $this->replaceFirst($md, $head['headMatter'], '');
      foreach ($fileMap as $key => $from) { $md = str_replace($from, $key, $md); }
      $content = '';
      if (trim($md) !== '') {
        $out = $ctx->contracts->call('import.file', 'convert', ['name' => 'page.md', 'data' => base64_encode($md)]);
        $content = is_array($out) && is_string($out['html'] ?? null) ? $this->strip($out['html']) : '';
      }
      $name = $this->replaceFirst($rel($p), '.md', '');
      $slug = $this->cleanTitle($name);
      $type = $v['type'] ?? '';
      $segments = explode('/', $name);
      $items[] = [
        'id' => "page-$slug",
        'title' => ($head['title'] !== null && $head['title'] !== '') ? $head['title'] : preg_replace('/ [0-9a-f]{32}$/i', '', end($segments)),
        'slug' => $slug,
        'parent' => ($lessonKey !== '' && isset($lessons[$lessonKey])) ? $items[$lessons[$lessonKey]]['id'] : null,
        'order' => (isset($v['id']) && $v['id'] !== '') ? $this->toInt(substr(strrchr('.' . $v['id'], '.'), 1)) : 0,
        'indent' => 1,
        'content' => $content,
        'metadata' => isset(self::PAGE_TYPES[$type]) ? ['pageType' => self::PAGE_TYPES[$type]] : new stdClass(),
      ];
    }
    $files = [];
    foreach ($downloads as $path => $url) { $files[] = ['path' => (string) $path, 'url' => $url]; }
    return ['title' => $gh['repo'], 'items' => $items, 'files' => $files];
  }
}

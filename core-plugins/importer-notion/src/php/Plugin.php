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

  private function strip($html) {
    $html = preg_replace('/<script\b[\s\S]*?<\/script\s*>/i', '', (string) $html);
    $html = preg_replace('/<script\b[^>]*>/i', '', $html);
    return preg_replace('/\son[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
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

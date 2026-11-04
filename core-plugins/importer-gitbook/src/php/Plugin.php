<?php
// GitBook importer (PHP). Mirrors src/nodejs/index.js; identical output.
class ImporterGitbookPlugin {
  /** Removes script and style blocks and inline event handlers; core sanitizes again on save. */
  private function strip($html) {
    return preg_replace('/\son\w+\s*=\s*("[^"]*"|\'[^\']*\')/i', '', preg_replace('/<(script|style)\b[\s\S]*?<\/\1\s*>/i', '', (string) $html));
  }

  /** Core's HAXCMS::cleanTitle($value, false): lower case, spaces and other characters to dashes, "/" kept. */
  private function cleanTitle($value) {
    $s = preg_replace('/--+/', '-', preg_replace('/[^\w\-\/]+/', '-', strtolower(str_replace(' ', '-', trim((string) $value)))));
    return $s === '' ? 'blank' : $s;
  }

  private function enc($p) { return str_replace(' ', '%20', $p); }

  /** A book-relative path with "." and ".." resolved; null when it climbs above the book's root. */
  private function normalize($path) {
    $out = [];
    foreach (explode('/', (string) $path) as $seg) {
      if ($seg === '' || $seg === '.') { continue; }
      if ($seg === '..') { if (!$out) { return null; } array_pop($out); } else { $out[] = $seg; }
    }
    return implode('/', $out);
  }

  /** Where the book lives (see sourceOf in src/nodejs/index.js). */
  private function sourceOf($url) {
    $u = parse_url(trim((string) $url));
    if (!$u || empty($u['scheme']) || empty($u['host']) || !in_array(strtolower($u['scheme']), ['http', 'https'], true)) { return null; }
    $hostname = strtolower($u['host']);
    $origin = strtolower($u['scheme']) . '://' . $hostname . (isset($u['port']) ? ':' . $u['port'] : '');
    $parts = array_values(array_filter(explode('/', $u['path'] ?? ''), 'strlen'));
    $summary = 'SUMMARY.md';
    if ($parts && preg_match('/\.md$/i', $parts[count($parts) - 1])) { $summary = array_pop($parts); }
    if ($hostname === 'github.com') {
      if (count($parts) < 2) { return null; }
      $branches = ['main', 'master']; $dir = [];
      if (isset($parts[2], $parts[3]) && in_array($parts[2], ['blob', 'tree', 'raw'], true) && $parts[3] !== '') { $branches = [$parts[3]]; $dir = array_slice($parts, 4); }
      $roots = [];
      foreach ($branches as $b) { $roots[] = implode('/', array_merge([$origin, $parts[0], $parts[1], 'raw', $b], $dir)); }
      return ['roots' => $roots, 'summary' => $summary, 'title' => $parts[1]];
    }
    $title = ($hostname === 'raw.githubusercontent.com' && count($parts) > 1) ? $parts[1] : ($parts ? $parts[count($parts) - 1] : $hostname);
    return ['roots' => [implode('/', array_merge([$origin], $parts))], 'summary' => $summary, 'title' => $title];
  }

  /** SUMMARY.md list entries in order (see parseSummary in src/nodejs/index.js). */
  private function parseSummary($md) {
    $out = []; $stack = [];
    foreach (explode("\n", preg_replace('/\r\n?/', "\n", (string) $md)) as $line) {
      if (!preg_match('/^([ \t]*)[*+-][ \t]+(.*)$/', $line, $m)) { continue; }
      $width = strlen(str_replace("\t", '    ', $m[1]));
      while ($stack && $stack[count($stack) - 1]['width'] >= $width) { array_pop($stack); }
      $parent = $stack ? $stack[count($stack) - 1]['owner'] : null;
      $isLink = preg_match('/^\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/', trim($m[2]), $link);
      $href = $isLink ? explode('#', $link[2])[0] : '';
      $path = ($href !== '' && !preg_match('/^[a-z][a-z0-9+.-]*:/i', $href) && strpos($href, '//') !== 0) ? $this->normalize($href) : null;
      $owner = $parent;
      if ($path !== null && $path !== '') { $t = trim($link[1]); $out[] = ['title' => $t !== '' ? $t : $path, 'path' => $path, 'depth' => count($stack), 'parent' => $parent]; $owner = count($out) - 1; }
      $stack[] = ['width' => $width, 'owner' => $owner];
    }
    return $out;
  }

  /** Points src/href values at files the book holds to files/<path>, and lists each once for core to fetch. */
  private function rewriteFiles($html, $pagePath, $root, &$files, &$seen) {
    $dir = strpos($pagePath, '/') !== false ? substr($pagePath, 0, strrpos($pagePath, '/')) : '';
    return preg_replace_callback('/(\s(?:src|href)=")([^"]*)"/i', function ($m) use ($dir, $root, &$files, &$seen) {
      $v = explode('?', explode('#', $m[2])[0])[0];
      $segs = explode('/', $v);
      if ($v === '' || preg_match('/^[a-z][a-z0-9+.-]*:/i', $v) || strpos($v, '//') === 0 || preg_match('/\.md$/i', $v) || !preg_match('/\.[a-z0-9]+$/i', end($segs))) { return $m[0]; }
      $p = $this->normalize($v[0] === '/' ? $v : "$dir/$v");
      if ($p === null || $p === '') { return $m[0]; }
      $path = "files/$p";
      if (empty($seen[$path])) { $seen[$path] = true; $files[] = ['path' => $path, 'url' => "$root/" . $this->enc($p)]; }
      return $m[1] . $path . '"';
    }, $html);
  }

  private function text($ctx, $url) {
    try { $r = $ctx->fetch($url); return $r['status'] < 400 ? (string) $r['body'] : null; } catch (Exception $e) { return null; }
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Reads SUMMARY.md, turns its nested list into the page tree, and converts each linked Markdown page to HTML through
   * the import.file contract (import-markdown); files the pages reference are listed for core to fetch.
   *
   * @param object $ctx    Platform context (spec/13); $ctx->fetch() reaches only the input url's host.
   * @param array  $input  [url] (a github.com repository, the book's folder, or its SUMMARY.md).
   * @return array  [title, items, files] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    if (empty($input['url'])) { return ['error' => 'url is required']; }
    $src = $this->sourceOf($input['url']);
    if (!$src) { return ['error' => 'url is not a GitBook or GitHub repository URL']; }
    $root = null; $md = null;
    foreach ($src['roots'] as $r) {
      $t = $this->text($ctx, "$r/" . $this->enc($src['summary']));
      if ($t !== null && trim($t) !== '') { $root = $r; $md = $t; break; }
    }
    if ($md === null) { return ['error' => 'no ' . $src['summary'] . ' found at ' . $src['roots'][0] . '; this does not look like a GitBook']; }
    $entries = $this->parseSummary($md);
    if (!$entries) { return ['error' => $src['summary'] . ' lists no pages; this does not look like a GitBook']; }
    $items = []; $files = []; $seen = []; $slugs = []; $orders = [];
    foreach ($entries as $i => $e) {
      $parent = $e['parent'] === null ? null : 'item-' . ($e['parent'] + 1);
      $key = $parent === null ? '' : $parent;
      $orders[$key] = array_key_exists($key, $orders) ? $orders[$key] + 1 : 0;
      $bare = preg_replace('/(^|\/)readme$/i', '', preg_replace('/\.md$/i', '', $e['path']));
      $slug = $this->cleanTitle($bare !== '' ? $bare : $e['title']);
      if (!empty($slugs[$slug])) { $n = 2; while (!empty($slugs["$slug-$n"])) { $n++; } $slug = "$slug-$n"; }
      $slugs[$slug] = true;
      $content = '';
      $t = $this->text($ctx, "$root/" . $this->enc($e['path']));
      if ($t !== null && trim($t) !== '') {
        $r = $ctx->contracts->call('import.file', 'convert', ['name' => 'page.md', 'data' => base64_encode($t)]);
        if (is_array($r) && isset($r['html']) && is_string($r['html'])) { $content = $this->rewriteFiles($this->strip($r['html']), $e['path'], $root, $files, $seen); }
      }
      $items[] = ['id' => 'item-' . ($i + 1), 'title' => $e['title'], 'slug' => $slug, 'parent' => $parent, 'order' => $orders[$key], 'indent' => $e['depth'], 'content' => $content];
    }
    return ['title' => $src['title'], 'items' => $items, 'files' => $files];
  }
}

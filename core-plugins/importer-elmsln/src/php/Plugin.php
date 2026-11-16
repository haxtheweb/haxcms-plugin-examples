<?php
// ELMS:LN importer (PHP). Mirrors src/nodejs/index.js; identical output.
class ImporterElmslnPlugin {
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

  /** Removes script and style blocks and inline event handlers; core sanitizes again on save. */
  private function strip($html) {
    return self::cleanHtml($html, ['script', 'style'], [], false);
  }

  private function text($ctx, $url) {
    try { $r = $ctx->fetch($url); return $r['status'] < 400 ? (string) $r['body'] : null; } catch (Exception $e) { return null; }
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Reads the course's site.json, then each page's HTML from its location, keeping ids, tree, order and metadata;
   * lists the files pages reference for core to fetch. A page that cannot be read links to its source instead.
   *
   * @param object $ctx    Platform context (spec/13); $ctx->fetch() reaches only the input url's host.
   * @param array  $input  [url] (the site root or its site.json).
   * @return array  [title, items, files] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    if (empty($input['url'])) { return ['error' => 'url is required']; }
    $u = parse_url(rtrim(preg_replace('/\/site\.json$/', '', trim((string) $input['url'])), '/'));
    if (empty($u['scheme']) || empty($u['host'])) { return ['error' => 'url is not a URL']; }
    $host = $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    $base = rtrim($u['scheme'] . '://' . $host . ($u['path'] ?? ''), '/');
    $site = null;
    try { $r = $ctx->fetch("$base/site.json"); if ($r['status'] < 400) { $site = $r['json']; } } catch (Exception $e) { $site = null; }
    if (!is_array($site) || !isset($site['items']) || !is_array($site['items'])) { return ['error' => "no site.json with items at $base; this does not look like an ELMS:LN site"]; }
    $parts = explode('/', $base);
    $name = !empty($site['metadata']['site']['name']) ? $site['metadata']['site']['name'] : (end($parts) ?: $host);
    $items = []; $files = []; $seen = [];
    foreach ($site['items'] as $it) {
      if (!is_array($it)) { continue; }
      $location = is_string($it['location'] ?? null) ? $it['location'] : '';
      $content = '';
      if ($location !== '') {
        $path = strpos($location, "/$name/") === 0 ? substr($location, strlen($name) + 2) : ltrim($location, '/');
        $url = "$base/$path";
        $t = $this->text($ctx, $url);
        $content = $t !== null ? $this->strip($t) : "<p>get source from <a href=\"$url\">$url</a></p>";
      }
      $item = ['id' => $it['id'] ?? null, 'title' => !empty($it['title']) ? $it['title'] : 'Page', 'slug' => !empty($it['slug']) ? $it['slug'] : ($it['id'] ?? null), 'parent' => !empty($it['parent']) ? $it['parent'] : null, 'order' => $it['order'] ?? count($items), 'indent' => $it['indent'] ?? 0, 'content' => $content];
      if (isset($it['metadata']) && is_array($it['metadata']) && $it['metadata'] && array_keys($it['metadata']) !== range(0, count($it['metadata']) - 1)) { $item['metadata'] = $it['metadata']; }
      $items[] = $item;
      foreach ((isset($it['metadata']['files']) && is_array($it['metadata']['files'])) ? $it['metadata']['files'] : [] as $f) {
        if (is_array($f) && is_string($f['url'] ?? null) && $f['url'] !== '' && empty($seen[$f['url']])) { $seen[$f['url']] = true; $files[] = ['path' => $f['url'], 'url' => "$base/" . $f['url']]; }
      }
    }
    return ['title' => !empty($site['title']) ? $site['title'] : $name, 'items' => $items, 'files' => $files];
  }
}

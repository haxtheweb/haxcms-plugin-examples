<?php
// ELMS:LN importer (PHP). Mirrors src/nodejs/index.js; identical output.
class ImporterElmslnPlugin {
  /** Removes script and style blocks and inline event handlers; core sanitizes again on save. */
  private function strip($html) {
    return preg_replace('/\son\w+\s*=\s*("[^"]*"|\'[^\']*\')/i', '', preg_replace('/<(script|style)\b[\s\S]*?<\/\1\s*>/i', '', (string) $html));
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

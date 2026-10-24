<?php
// HAXcms importer (PHP). Mirrors src/nodejs/index.js.
class ImporterHaxcmsPlugin {
  const SITE_FILES = ['theme/theme.css', 'theme/theme.html', 'custom/build/custom.es6.js'];
  const BOILERPLATE = '// custom comment script here';

  private function baseOf($url) {
    $u = parse_url(preg_replace('/\/site\.json$/', '', (string) $url));
    if (empty($u['scheme']) || empty($u['host'])) { return null; }
    return rtrim($u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '') . ($u['path'] ?? ''), '/');
  }

  private function text($ctx, $url) {
    try { $r = $ctx->fetch($url); return $r['status'] < 400 ? $r['body'] : null; } catch (Exception $e) { return null; }
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Reads site.json, then each page's HTML from its location; lists the files pages reference and the site's theme
   * overrides for core to fetch. Pages that cannot be read come back empty rather than failing the import.
   *
   * @param object $ctx    Platform context (spec/13); $ctx->fetch() reaches only the input url's host.
   * @param array  $input  [url].
   * @return array  [title, items, files] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    if (empty($input['url'])) { return ['error' => 'url is required']; }
    $base = $this->baseOf($input['url']);
    if (!$base) { return ['error' => 'url is not a URL']; }
    try { $r = $ctx->fetch("$base/site.json"); if ($r['status'] >= 400) { throw new Exception('HTTP ' . $r['status']); } $site = $r['json']; }
    catch (Exception $e) { return ['error' => 'unable to fetch site.json: ' . $e->getMessage()]; }
    if (!is_array($site) || !isset($site['items']) || !is_array($site['items'])) { return ['error' => 'site.json has no items']; }
    $files = []; $items = [];
    foreach ($site['items'] as $it) {
      $content = !empty($it['location']) ? $this->text($ctx, "$base/" . $it['location']) : null;
      $items[] = ['id' => $it['id'], 'title' => $it['title'], 'slug' => $it['slug'], 'parent' => $it['parent'] ?? null, 'order' => $it['order'] ?? count($items), 'indent' => $it['indent'] ?? 0, 'content' => $content ?? '', 'metadata' => $it['metadata'] ?? new stdClass()];
      foreach ($it['metadata']['files'] ?? [] as $f) { if (!empty($f['url'])) { $files[] = ['path' => $f['url'], 'url' => "$base/" . $f['url']]; } }
    }
    foreach (self::SITE_FILES as $path) {
      $t = $this->text($ctx, "$base/$path");
      if ($t !== null && trim($t) !== '' && !(substr($path, -7) === '.es6.js' && trim($t) === self::BOILERPLATE)) { $files[] = ['path' => $path, 'url' => "$base/$path"]; }
    }
    return ['title' => $site['title'] ?? 'Imported site', 'items' => $items, 'files' => $files];
  }
}

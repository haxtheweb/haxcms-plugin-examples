<?php
// Pressbooks importer (PHP). Mirrors src/nodejs/index.js; both return identical results.
class ImporterPressbooksPlugin {
  const API = '/wp-json/pressbooks/v2';
  const STOP_SEGMENTS = ['wp-json', 'front-matter', 'chapter', 'back-matter', 'part', 'toc'];
  const SECTION = '/<div\s+class="(front-matter|part|chapter|back-matter)(?:\s[^"]*)?"[^>]*>/i';
  const SECTION_TITLE = '/<h[1-6][^>]*class="[^"]*\b(?:front-matter|part|chapter|back-matter)-title\b[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/i';

  /** HAXCMS.cleanTitle from core: lowercase, spaces and anything outside [\w-/] become single dashes. */
  public static function cleanTitle($value) {
    $t = strtolower(str_replace(' ', '-', trim((string) $value)));
    $t = preg_replace('/--+/', '-', preg_replace('/[^\w\-\/]+/', '-', $t));
    return $t === '' ? 'blank' : $t;
  }

  private static function toInt($value) {
    return preg_match('/^\s*([+-]?\d+)/', is_scalar($value) ? (string) $value : '', $m) ? (int) $m[1] : 0;
  }

  private static function decode($s) {
    $s = preg_replace_callback('/&#x([0-9a-f]+);/i', function ($m) { return mb_chr(hexdec($m[1]), 'UTF-8'); }, (string) $s);
    $s = preg_replace_callback('/&#(\d+);/', function ($m) { return mb_chr((int) $m[1], 'UTF-8'); }, $s);
    $named = ['amp' => '&', 'lt' => '<', 'gt' => '>', 'quot' => '"', 'apos' => "'", 'nbsp' => "\u{00A0}"];
    return preg_replace_callback('/&(amp|lt|gt|quot|apos|nbsp);/', function ($m) use ($named) { return $named[$m[1]]; }, $s);
  }

  private static function textOf($html) {
    return trim(preg_replace('/[ \t\n\r\f\x0B\x{00A0}]+/u', ' ', self::decode(preg_replace('/<[^>]*>/', '', (string) $html))));
  }

  private static function strip($html) {
    $html = preg_replace('/<script\b[\s\S]*?<\/script\s*>/i', '', (string) $html);
    $html = preg_replace('/<script\b[^>]*>/i', '', $html);
    return preg_replace('/\son[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
  }

  public static function candidates($url) {
    $u = parse_url((string) $url);
    if (!$u || empty($u['scheme']) || empty($u['host']) || !in_array(strtolower($u['scheme']), ['http', 'https'], true)) { return []; }
    $origin = strtolower($u['scheme']) . '://' . strtolower($u['host']) . (isset($u['port']) ? ':' . $u['port'] : '');
    $parts = array_values(array_filter(explode('/', $u['path'] ?? ''), 'strlen'));
    foreach ($parts as $i => $p) { if (in_array($p, self::STOP_SEGMENTS, true)) { $parts = array_slice($parts, 0, $i); break; } }
    $out = [];
    for ($i = count($parts); $i >= 0; $i--) {
      $c = $i > 0 ? $origin . '/' . implode('/', array_slice($parts, 0, $i)) : $origin;
      if (!in_array($c, $out, true)) { $out[] = $c; }
    }
    return $out;
  }

  private function getJson($ctx, $url) {
    try { $r = $ctx->fetch($url); return $r['status'] < 400 ? $r['json'] : null; } catch (Exception $e) { return null; }
  }

  private static function tocOk($t) {
    return is_array($t) && isset($t['front-matter'], $t['parts'], $t['back-matter']) && is_array($t['front-matter']) && is_array($t['parts']) && is_array($t['back-matter']);
  }

  private function discover($ctx, $url) {
    foreach (self::candidates($url) as $c) {
      $index = $this->getJson($ctx, "$c/wp-json/");
      if (is_array($index) && isset($index['namespaces']) && is_array($index['namespaces']) && in_array('pressbooks/v2', $index['namespaces'], true)) { return ['base' => $c, 'toc' => null]; }
      $toc = $this->getJson($ctx, $c . self::API . '/toc');
      if (self::tocOk($toc)) { return ['base' => $c, 'toc' => $toc]; }
    }
    return null;
  }

  private static function field($obj, $key) {
    $v = is_array($obj) ? ($obj[$key] ?? null) : null;
    if (is_string($v)) { return $v; }
    if (is_array($v)) {
      if (isset($v['rendered']) && is_string($v['rendered']) && $v['rendered'] !== '') { return $v['rendered']; }
      if (isset($v['raw']) && is_string($v['raw']) && $v['raw'] !== '') { return $v['raw']; }
    }
    return '';
  }

  private static function sorted($list) {
    $list = is_array($list) ? array_values($list) : [];
    usort($list, function ($a, $b) { return self::toInt(is_array($a) ? ($a['menu_order'] ?? null) : null) - self::toInt(is_array($b) ? ($b['menu_order'] ?? null) : null); });
    return $list;
  }

  private static function absolutize($html, $base) {
    $u = parse_url($base);
    $origin = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
    return preg_replace('/(href|src|poster|srcset)="\/(?!\/)/', '$1="' . $origin . '/', (string) $html);
  }

  private static function metadataFor($entry, $full, $sourceType) {
    $pressbooks = [];
    $id = !empty($full['id']) ? $full['id'] : (!empty($entry['id']) ? $entry['id'] : null);
    if ($id) { $pressbooks['id'] = $id; }
    if (!empty($entry['slug'])) { $pressbooks['slug'] = $entry['slug']; }
    if (is_array($entry) && isset($entry['menu_order'])) { $pressbooks['menuOrder'] = $entry['menu_order']; }
    if (!empty($entry['status'])) { $pressbooks['status'] = $entry['status']; }
    $meta = ['sourceType' => $sourceType, 'pressbooks' => $pressbooks ?: new stdClass()];
    $source = !empty($full['link']) ? $full['link'] : (!empty($entry['link']) ? $entry['link'] : null);
    if ($source) { $meta['source'] = $source; }
    return $meta;
  }

  private static function unique($slug, &$used) {
    $s = $slug; $n = 2;
    while (isset($used[$s])) { $s = $slug . '-' . $n++; }
    $used[$s] = true;
    return $s;
  }

  private function fromApi($ctx, $url) {
    $found = $this->discover($ctx, $url);
    if (!$found) { return ['error' => 'no Pressbooks API found at that address (expected /wp-json/pressbooks/v2)']; }
    $base = $found['base'];
    $toc = $found['toc'] ?: $this->getJson($ctx, $base . self::API . '/toc');
    if (!self::tocOk($toc)) { return ['error' => 'the Pressbooks table of contents could not be read']; }
    $meta = $this->getJson($ctx, $base . self::API . '/metadata');
    $items = []; $used = []; $top = 0;
    $add = function ($entry, $endpoint, $sourceType, $parent) use ($ctx, $base, &$items, &$used) {
      $full = !empty($entry['id']) ? $this->getJson($ctx, $base . self::API . "/$endpoint/" . $entry['id']) : null;
      $t = self::field($full, 'title');
      if ($t === '') { $t = self::field($entry, 'title'); }
      if ($t === '' && !empty($entry['slug'])) { $t = (string) $entry['slug']; }
      $title = self::textOf($t);
      $raw = self::field($full, 'content');
      $items[] = [
        'id' => 'item-' . (count($items) + 1),
        'title' => $title,
        'slug' => self::unique($parent ? $parent['slug'] . '/' . self::cleanTitle($title) : self::cleanTitle($title), $used),
        'parent' => $parent ? $parent['id'] : null,
        'order' => 0,
        'indent' => $parent ? 1 : 0,
        'content' => $raw === '' ? '<p></p>' : self::strip(self::absolutize($raw, $base)),
        'metadata' => self::metadataFor($entry, $full, $sourceType),
      ];
      return count($items) - 1;
    };
    foreach (self::sorted($toc['front-matter']) as $s) { if (is_array($s) && ($s['export'] ?? null) === false) { continue; } $items[$add($s, 'front-matter', 'front-matter', null)]['order'] = $top++; }
    foreach (self::sorted($toc['parts']) as $part) {
      if (is_array($part) && ($part['export'] ?? null) === false) { continue; }
      $pi = $add($part, 'parts', 'part', null);
      $items[$pi]['order'] = $top++;
      $n = 0;
      foreach (self::sorted($part['chapters'] ?? []) as $ch) { if (is_array($ch) && ($ch['export'] ?? null) === false) { continue; } $items[$add($ch, 'chapters', 'chapter', $items[$pi])]['order'] = $n++; }
    }
    foreach (self::sorted($toc['back-matter']) as $s) { if (is_array($s) && ($s['export'] ?? null) === false) { continue; } $items[$add($s, 'back-matter', 'back-matter', null)]['order'] = $top++; }
    if (!$items) { return ['error' => 'the Pressbooks book has no sections to import']; }
    $segs = array_values(array_filter(explode('/', parse_url($base, PHP_URL_PATH) ?? ''), 'strlen'));
    $last = $segs ? end($segs) : '';
    $name = (is_array($meta) && isset($meta['name']) && is_string($meta['name']) && $meta['name'] !== '') ? $meta['name'] : ($last !== '' ? $last : 'Pressbooks import');
    return ['title' => self::textOf($name), 'items' => $items];
  }

  private static function balance($html) {
    $s = trim($html);
    while (preg_match('/<\/div>$/i', $s) && preg_match_all('/<\/div>/i', $s) > preg_match_all('/<div\b/i', $s)) { $s = trim(substr($s, 0, -6)); }
    return $s;
  }

  public static function fromExport($html, $name) {
    $doc = self::strip($html);
    $end = preg_match('/<\/body>/i', $doc, $em, PREG_OFFSET_CAPTURE) ? $em[0][1] : -1;
    $body = $end === -1 ? $doc : substr($doc, 0, $end);
    preg_match_all(self::SECTION, $body, $marks, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
    if (!$marks) { return ['error' => 'the file is not a Pressbooks XHTML export (no front-matter, part or chapter sections)']; }
    $items = []; $used = []; $top = 0; $part = null; $n = 0;
    foreach ($marks as $i => $m) {
      $kind = strtolower($m[1][0]);
      $start = $m[0][1] + strlen($m[0][0]);
      $stop = $i + 1 < count($marks) ? $marks[$i + 1][0][1] : strlen($body);
      $seg = substr($body, $start, $stop - $start);
      $title = preg_match(self::SECTION_TITLE, $seg, $h) ? self::textOf($h[1]) : '';
      $idAttr = preg_match('/\sid="([^"]*)"/', $m[0][0], $im) ? $im[1] : null;
      if ($title === '') { $title = ($idAttr !== null && $idAttr !== '') ? $idAttr : $kind; }
      $content = preg_match('/<div\s+class="ugc[^"]*"[^>]*>/i', $seg, $u, PREG_OFFSET_CAPTURE) ? self::balance(substr($seg, $u[0][1] + strlen($u[0][0]))) : '';
      $parent = $kind === 'chapter' ? $part : null;
      $item = [
        'id' => 'item-' . (count($items) + 1),
        'title' => $title,
        'slug' => self::unique($parent ? $parent['slug'] . '/' . self::cleanTitle($title) : self::cleanTitle($title), $used),
        'parent' => $parent ? $parent['id'] : null,
        'order' => $parent ? $n++ : $top++,
        'indent' => $parent ? 1 : 0,
        'content' => $content === '' ? '<p></p>' : $content,
        'metadata' => ['sourceType' => $kind, 'pressbooks' => $idAttr !== null ? ['slug' => $idAttr] : new stdClass()],
      ];
      if ($kind === 'part') { $part = $item; $n = 0; }
      if ($kind !== 'chapter' && $kind !== 'part') { $part = null; }
      $items[] = $item;
    }
    $t = preg_match('/<title[^>]*>([\s\S]*?)<\/title>/i', $doc, $tm) ? self::textOf($tm[1]) : '';
    return ['title' => $t !== '' ? $t : preg_replace('/\.[^.]+$/', '', (string) $name), 'items' => $items];
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Reads a Pressbooks book through its REST API (front matter, each part with its chapters, back matter, in menu
   * order) or splits an uploaded XHTML export into the same tree. Root-relative links are pointed at the book's
   * host, and scripts and inline handlers are dropped (core sanitizes again).
   *
   * @param object $ctx    Platform context (spec/13); $ctx->fetch() reaches only the input url's host.
   * @param array  $input  [url] of the book (any page of it), or [files => [[name, data (base64)]]] with one .html export.
   * @return array  [title, items] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    $input = is_array($input) ? $input : [];
    if (!empty($input['files']) && is_array($input['files'])) {
      $f = is_array($input['files'][0] ?? null) ? $input['files'][0] : [];
      $name = (string) ($f['name'] ?? '');
      if (!preg_match('/\.(html|htm|xhtml)$/i', $name)) { return ['error' => 'expected a Pressbooks XHTML export (.html)']; }
      $html = (string) base64_decode((string) ($f['data'] ?? ''));
      if (trim($html) === '') { return ['error' => 'the file is empty']; }
      return self::fromExport($html, $name);
    }
    if (empty($input['url'])) { return ['error' => 'url or files is required']; }
    if (!self::candidates($input['url'])) { return ['error' => 'url is not a URL']; }
    return $this->fromApi($ctx, $input['url']);
  }
}

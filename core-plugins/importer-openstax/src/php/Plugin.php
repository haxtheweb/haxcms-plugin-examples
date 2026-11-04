<?php
// OpenStax importer (PHP). Mirrors src/nodejs/index.js; both return identical results.
class ImporterOpenstaxPlugin {
  const MAX_PAGES = 500;
  const MAX_IMAGES = 1000;
  const EXTENSION_BY_CONTENT_TYPE = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/gif' => 'gif', 'image/webp' => 'webp'];
  const SITE_LICENSES = ['by', 'by-sa', 'by-nd', 'by-nc', 'by-nc-sa', 'by-nc-nd'];
  const KEEP_ATTRIBUTES = [
    'a' => ['href'],
    'img' => ['src', 'alt', 'width', 'height'],
    'td' => ['colspan', 'rowspan', 'headers'],
    'th' => ['colspan', 'rowspan', 'scope'],
    'ol' => ['start', 'type'],
    'math' => ['display'],
    'media-image' => ['source', 'alt'],
  ];
  const ATTR = '/([^\s=\/>"\']+)(?:\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'>]+)))?/';
  const SPACE = '/(?:[\t\n\x0B\f\r ]|\xC2\xA0)+/';

  private function replaceFirst($s, $find, $with) {
    $i = strpos($s, $find);
    return $i === false ? $s : substr_replace($s, $with, $i, strlen($find));
  }

  private function cleanTitle($value) {
    $t = $this->replaceFirst($this->replaceFirst(trim((string) $value), 'pages/', ''), '/index.html', '');
    $t = preg_replace('/--+/', '-', preg_replace('/[^\w\-\/]+/', '-', mb_strtolower(str_replace(' ', '-', $t))));
    return $t === '' ? 'blank' : $t;
  }

  private function titleSlug($title) {
    $cleaned = $this->cleanTitle($title);
    $trimmed = preg_replace('/^-+|-+$/', '', $cleaned);
    return $trimmed === '' ? $cleaned : $trimmed;
  }

  private function decode($s) {
    $s = preg_replace_callback('/&#x([0-9a-f]+);/i', function ($m) { return mb_chr(hexdec($m[1]), 'UTF-8'); }, (string) $s);
    $s = preg_replace_callback('/&#(\d+);/', function ($m) { return mb_chr((int) $m[1], 'UTF-8'); }, $s);
    $s = str_replace(['&nbsp;', '&lt;', '&gt;', '&quot;', '&apos;'], [' ', '<', '>', '"', "'"], $s);
    return str_replace('&amp;', '&', $s);
  }

  private function escapeAttr($s) {
    return str_replace(['&', '<', '>', '"', "'"], ['&amp;', '&lt;', '&gt;', '&quot;', '&#039;'], (string) $s);
  }

  private function plainText($value) {
    return trim(preg_replace(self::SPACE, ' ', $this->decode(preg_replace('/<[^>]+>/', ' ', (string) ($value ?? '')))));
  }

  private function attrs($tag) {
    $inner = preg_replace('/\/?>$/', '', preg_replace('/^<[^\s>\/]+/', '', $tag));
    preg_match_all(self::ATTR, $inner, $mm, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);
    $out = [];
    foreach ($mm as $m) { $out[] = [$m[1], $m[2] ?? ($m[3] ?? ($m[4] ?? null))]; }
    return $out;
  }

  private function attr($tag, $name) {
    foreach ($this->attrs($tag) as $a) { if (strtolower($a[0]) === $name) { return $a[1] ?? ''; } }
    return null;
  }

  private function buildTag($name, $list, $selfClosing) {
    $out = '';
    foreach ($list as $a) { $out .= $a[1] === null ? ' ' . $a[0] : ' ' . $a[0] . '="' . str_replace('"', '&quot;', (string) $a[1]) . '"'; }
    return '<' . $name . $out . ($selfClosing ? ' /' : '') . '>';
  }

  private function resolveUrl($base, $rel) {
    preg_match('/^([a-z][a-z0-9+.-]*:)\/\/([^\/?#]*)([^?#]*)/i', $base, $m);
    if (strpos($rel, '//') === 0) { return $m[1] . $rel; }
    $origin = $m[1] . '//' . $m[2];
    if (strpos($rel, '/') === 0) { $path = $rel; }
    elseif (strpos($rel, '?') === 0) { $path = $m[3] . $rel; }
    else { $path = preg_replace('/[^\/]*$/', '', $m[3]) . $rel; }
    preg_match('/^([^?#]*)(.*)$/s', $path, $q);
    $segs = explode('/', $q[1]);
    $out = [];
    foreach ($segs as $i => $s) {
      $last = $i === count($segs) - 1;
      if ($s === '..') { if (count($out) > 1) { array_pop($out); } if ($last) { $out[] = ''; } }
      elseif ($s === '.') { if ($last) { $out[] = ''; } }
      else { $out[] = $s; }
    }
    return $origin . implode('/', $out) . $q[2];
  }

  private function licenseCode($license) {
    $value = strtolower(($license['url'] ?? '') . ' ' . ($license['name'] ?? ''));
    foreach (self::SITE_LICENSES as $code) { if (strpos($value, "/licenses/$code/") !== false) { return $code; } }
    $compact = preg_replace('/[^a-z]/', '', $value);
    $nc = strpos($compact, 'noncommercial') !== false; $nd = strpos($compact, 'noderivatives') !== false; $sa = strpos($compact, 'sharealike') !== false;
    if ($nc && $nd) { return 'by-nc-nd'; }
    if ($nc && $sa) { return 'by-nc-sa'; }
    if ($nc) { return 'by-nc'; }
    if ($nd) { return 'by-nd'; }
    if ($sa) { return 'by-sa'; }
    return 'by';
  }

  public function bookSlugFromUrl($url) {
    if (!preg_match('/^https?:\/\/([^\/?#:]+)(?::\d+)?([^?#]*)/i', trim((string) $url), $m)) { throw new Exception("url is not a valid URL: $url"); }
    $host = strtolower($m[1]);
    if ($host !== 'openstax.org' && $host !== 'www.openstax.org') { throw new Exception('url must be an openstax.org URL, got: ' . $m[1]); }
    $segs = array_values(array_filter(explode('/', $m[2]), function ($s) { return $s !== ''; }));
    $i = array_search('books', $segs, true);
    if ($i === false || empty($segs[$i + 1])) { throw new Exception('unable to read a book slug from url; expected /details/books/<slug> or /books/<slug>/pages/<page>'); }
    return ['origin' => "https://$host", 'slug' => $segs[$i + 1]];
  }

  private function fetchJson($ctx, $url, $what) {
    try { $r = $ctx->fetch($url); } catch (Exception $e) { throw new Exception("unable to reach OpenStax for $what: " . $e->getMessage()); }
    if ($r['status'] >= 400) { throw new Exception('OpenStax returned ' . $r['status'] . " for $what"); }
    $data = json_decode((string) $r['body'], true);
    if (json_last_error() !== JSON_ERROR_NONE) { throw new Exception("OpenStax returned unreadable data for $what"); }
    return $data;
  }

  private function resolveBook($ctx, $origin, $slug) {
    $release = $this->fetchJson($ctx, "$origin/rex/release.json", 'the OpenStax release manifest');
    $archivePath = is_array($release) && !empty($release['archiveUrl']) ? (string) $release['archiveUrl'] : '';
    if ($archivePath === '') { throw new Exception('the OpenStax release manifest did not name an archive'); }
    $lookup = $this->fetchJson($ctx, "$origin/apps/cms/api/v2/pages/?type=books.Book&fields=title,cnx_id&slug=" . rawurlencode($slug), "the book \"$slug\"");
    $entries = is_array($lookup) && isset($lookup['items']) && is_array($lookup['items']) ? $lookup['items'] : [];
    if (!$entries || empty($entries[0]['cnx_id'])) { throw new Exception("OpenStax has no book with the slug \"$slug\""); }
    $contentId = (string) $entries[0]['cnx_id'];
    $bookRelease = $release['books'][$contentId] ?? null;
    if (!is_array($bookRelease) || empty($bookRelease['defaultVersion'])) { throw new Exception("OpenStax is not currently publishing \"$slug\""); }
    $archiveUrl = $origin . $archivePath;
    $version = (string) $bookRelease['defaultVersion'];
    $contents = $this->fetchJson($ctx, "$archiveUrl/contents/$contentId@$version.json", "the contents of \"$slug\"");
    if (!is_array($contents) || !isset($contents['tree']['contents']) || !is_array($contents['tree']['contents'])) { throw new Exception("OpenStax returned no table of contents for \"$slug\""); }
    $license = isset($contents['license']) && is_array($contents['license']) ? $contents['license'] : [];
    return ['slug' => $slug, 'contentId' => $contentId, 'version' => $version, 'archiveUrl' => $archiveUrl, 'origin' => $origin, 'title' => $this->plainText(!empty($contents['title']) ? $contents['title'] : $slug), 'license' => $license, 'tree' => $contents['tree']];
  }

  private function flattenTree($tree) {
    $nodes = [];
    $walk = function ($branch, $depth, $parentIndex) use (&$walk, &$nodes) {
      $order = 0;
      foreach (isset($branch['contents']) && is_array($branch['contents']) ? $branch['contents'] : [] as $child) {
        $title = $this->plainText($child['title'] ?? '');
        if ($title === '') { continue; }
        $hasChildren = isset($child['contents']) && is_array($child['contents']) && count($child['contents']) > 0;
        $index = count($nodes);
        $nodes[] = ['title' => $title, 'depth' => $depth, 'order' => $order, 'parentIndex' => $parentIndex, 'pageId' => $hasChildren ? null : strtolower(explode('@', (string) ($child['id'] ?? ''))[0]), 'sourceSlug' => !empty($child['slug']) ? (string) $child['slug'] : ''];
        $order++;
        if ($hasChildren) { $walk($child, $depth + 1, $index); }
      }
    };
    $walk($tree, 0, null);
    return $nodes;
  }

  private function resourcePath($src) {
    $v = trim((string) $src);
    if ($v === '' || preg_match('/^(https?:)?\/\//i', $v) || strpos($v, 'data:') === 0) { return ''; }
    return preg_match('/resources\/([A-Za-z0-9._-]+)$/', $v, $m) ? 'resources/' . $m[1] : '';
  }

  private function header($headers, $name) {
    foreach ((array) $headers as $k => $v) { if (strtolower($k) === $name) { return is_array($v) ? (string) reset($v) : (string) $v; } }
    return '';
  }

  private function listImage($ctx, &$run, $url, $resource) {
    if (count($run['files']) >= self::MAX_IMAGES) { return null; }
    try { $r = $ctx->fetch($url, ['method' => 'HEAD']); } catch (Exception $e) { return null; }
    if ($r['status'] >= 400) { return null; }
    $type = strtolower(trim(explode(';', $this->header($r['headers'] ?? [], 'content-type'))[0]));
    $ext = self::EXTENSION_BY_CONTENT_TYPE[$type] ?? null;
    if (!$ext) { return null; }
    $parts = explode('/', $resource);
    $path = 'files/' . end($parts) . '.' . $ext;
    $run['files'][] = ['path' => $path, 'url' => $url];
    return $path;
  }

  private function cleanPage($ctx, $content, &$run) {
    if (!is_string($content) || trim($content) === '') { return '<p></p>'; }
    if (preg_match('/<body\b[^>]*>([\s\S]*)<\/body\s*>/i', $content, $body)) { $html = $body[1]; }
    else { $html = preg_replace('/<!DOCTYPE[^>]*>/i', '', preg_replace('/<\?xml[^>]*\?>/i', '', $content)); }
    $html = preg_replace('/<(style|script|noscript|head)\b[\s\S]*?<\/\1\s*>/i', '', $html);
    $html = preg_replace('/<\/?(link|meta|script|style|noscript)\b[^>]*>/i', '', $html);
    if (preg_match('/^\s*<div\b([^>]*)>([\s\S]*)<\/div>\s*$/i', $html, $wrap) && preg_match('/\bdata-type\s*=\s*["\']page["\']/i', $wrap[1])) { $html = $wrap[2]; }
    $html = preg_replace('/<([a-z][a-z0-9]*)\b[^>]*\bdata-type\s*=\s*["\']document-title["\'][^>]*>[\s\S]*?<\/\1\s*>/i', '', $html, 1);

    preg_match_all('/<img\b[^>]*>/i', $html, $imgs);
    foreach ($imgs[0] as $tag) {
      $resource = $this->resourcePath($this->attr($tag, 'src') ?? '');
      if ($resource !== '' && !array_key_exists($resource, $run['images'])) { $run['images'][$resource] = $this->listImage($ctx, $run, $run['book']['archiveUrl'] . '/' . $resource, $resource); }
    }
    $html = preg_replace_callback('/<img\b[^>]*>/i', function ($m) use (&$run) {
      $tag = $m[0];
      $resource = $this->resourcePath($this->attr($tag, 'src') ?? '');
      if ($resource === '') { return $tag; }
      $listed = $run['images'][$resource] ?? null;
      if ($listed) { return '<media-image source="' . $listed . '" alt="' . $this->escapeAttr($this->decode($this->attr($tag, 'alt') ?? '')) . '"></media-image>'; }
      $abs = $run['book']['archiveUrl'] . '/' . $resource;
      $list = array_map(function ($a) use ($abs) { return strtolower($a[0]) === 'src' ? [$a[0], $abs] : $a; }, $this->attrs($tag));
      return $this->buildTag('img', $list, (bool) preg_match('/\/>$/', $tag));
    }, $html);

    $html = preg_replace_callback('/<a\b[^>]*>/i', function ($m) use (&$run) {
      $tag = $m[0];
      $href = $this->attr($tag, 'href');
      if ($href === null) { return $tag; }
      $v = trim($href);
      if ($v === '' || strpos($v, '#') === 0 || preg_match('/^[a-z][a-z0-9+.-]*:/i', $v)) { return $tag; }
      $slug = preg_match('/\/contents\/([0-9a-f-]{36})/i', $v, $t) ? ($run['slugByPageId'][strtolower($t[1])] ?? null) : null;
      $next = $slug ? $slug . (strpos($v, '#') !== false ? substr($v, strpos($v, '#')) : '') : $this->resolveUrl($run['book']['archiveUrl'] . '/', $v);
      $list = array_map(function ($a) use ($next) { return strtolower($a[0]) === 'href' ? [$a[0], $next] : $a; }, $this->attrs($tag));
      return $this->buildTag('a', $list, false);
    }, $html);

    $parts = preg_split('/(<math\b[\s\S]*?<\/math\s*>)/i', $html, -1, PREG_SPLIT_DELIM_CAPTURE);
    foreach ($parts as $i => $part) {
      if ($i % 2) { continue; }
      $parts[$i] = preg_replace_callback('/<([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*?)?(\/?)>/', function ($m) {
        $keep = self::KEEP_ATTRIBUTES[strtolower($m[1])] ?? [];
        $list = array_values(array_filter($this->attrs($m[0]), function ($a) use ($keep) { return in_array(strtolower($a[0]), $keep, true); }));
        return $this->buildTag($m[1], $list, ($m[3] ?? '') === '/');
      }, $part);
    }
    $html = implode('', $parts);
    $html = preg_replace('/\son[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
    $html = trim(preg_replace('/>\s*\n\s*</', '><', $html));
    return $html === '' ? '<p></p>' : $html;
  }

  private function sourceFallback($source) {
    return $source ? '<p>Read this page on <a href="' . $source . '">OpenStax</a>.</p>' : '<p></p>';
  }

  private function isoTime($ms) {
    $ms = (int) $ms;
    return gmdate('Y-m-d\TH:i:s', intdiv($ms, 1000)) . sprintf('.%03dZ', $ms % 1000);
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Reads an OpenStax book through the public archive API and returns its units, chapters and pages as a tree, with
   * clean HTML, in-book links pointing at the new pages, and each image listed in files for core to fetch.
   * Pages past the 500-page cap link to their source instead of carrying a body.
   *
   * @param object $ctx    Platform context (spec/13); $ctx->fetch() reaches only the input url's host (openstax.org).
   * @param array  $input  [url] of the book: https://openstax.org/details/books/<slug> or a reader page.
   * @return array  [title, items, files] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    if (empty($input['url'])) { return ['error' => 'url is required']; }
    try {
      $u = $this->bookSlugFromUrl($input['url']);
      $origin = $u['origin']; $slug = $u['slug'];
      $book = $this->resolveBook($ctx, $origin, $slug);
      $nodes = $this->flattenTree($book['tree']);
      if (!$nodes) { return ['error' => "OpenStax returned an empty table of contents for \"$slug\""]; }
      $accessed = $this->isoTime($ctx->now());
      $run = ['book' => $book, 'slugByPageId' => [], 'images' => [], 'files' => []];
      $items = [];
      foreach ($nodes as $i => $node) {
        $parent = $node['parentIndex'] === null ? null : $items[$node['parentIndex']];
        $item = [
          'id' => 'item-' . ($i + 1),
          'title' => $node['title'],
          'slug' => $parent ? $parent['slug'] . '/' . $this->titleSlug($node['title']) : $this->titleSlug($node['title']),
          'parent' => $parent ? $parent['id'] : null,
          'order' => $node['order'],
          'indent' => $node['depth'],
          'content' => '<p></p>',
          'metadata' => ['sourceType' => 'openstax', 'openstax' => ['bookSlug' => $book['slug'], 'bookTitle' => $book['title'], 'pageSlug' => $node['sourceSlug'], 'license' => $book['license'] ?: new stdClass(), 'licenseCode' => $this->licenseCode($book['license']), 'publisher' => 'OpenStax / Rice University', 'accessed' => $accessed]],
        ];
        if ($node['pageId']) {
          $item['metadata']['source'] = "$origin/books/" . $book['slug'] . '/pages/' . $node['sourceSlug'];
          $run['slugByPageId'][$node['pageId']] = $item['slug'];
        }
        $items[] = $item;
      }
      $fetched = 0;
      foreach ($nodes as $i => $node) {
        if (!$node['pageId']) { continue; }
        if ($fetched >= self::MAX_PAGES) { $items[$i]['content'] = $this->sourceFallback($items[$i]['metadata']['source']); continue; }
        $page = $this->fetchJson($ctx, $book['archiveUrl'] . '/contents/' . $book['contentId'] . '@' . $book['version'] . ':' . $node['pageId'] . '.json', 'the page "' . $node['title'] . '"');
        $fetched++;
        $items[$i]['content'] = $this->cleanPage($ctx, is_array($page) && is_string($page['content'] ?? null) ? $page['content'] : '', $run);
        if (is_array($page) && !empty($page['abstract'])) { $items[$i]['description'] = mb_substr($this->plainText($page['abstract']), 0, 280); }
      }
      return ['title' => $book['title'], 'items' => $items, 'files' => $run['files']];
    } catch (Exception $e) {
      return ['error' => $e->getMessage()];
    }
  }
}

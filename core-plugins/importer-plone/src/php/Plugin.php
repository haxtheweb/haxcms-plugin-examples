<?php
// Plone importer (PHP). Mirrors src/nodejs/index.js; both return identical results.
class ImporterPlonePlugin {
  const PAGE_TYPES = ['Document', 'News Item', 'Event', 'Folder', 'Collection', 'Link', 'Topic', 'Listing'];
  const BINARY_TYPES = ['Image', 'File'];
  const STOP_SEGMENTS = ['@site', '@search', '@types', '++api++'];
  const MAX_ITEMS = 5000;
  const MAX_SEARCH_PAGES = 500;
  const BATCH = 100;
  const METADATA_FIELDS = ['UID', 'portal_type', 'path', 'is_folderish', 'created', 'modified', 'review_state', 'getObjPositionInParent'];

  private function cleanTitle($value) {
    $t = preg_replace('/--+/', '-', preg_replace('/[^\w\-\/]+/', '-', mb_strtolower(str_replace(' ', '-', trim((string) $value)))));
    return $t === '' ? 'blank' : $t;
  }

  private function positiveInt($value, $fallback) {
    if (!preg_match('/^\s*([+-]?\d+)/', $value === null ? '' : (is_bool($value) ? ($value ? 'true' : 'false') : (string) $value), $m)) { return $fallback; }
    $n = (int) $m[1];
    return $n < 1 ? $fallback : $n;
  }

  private function isText($v) { return is_string($v) && trim($v) !== ''; }
  private function stripSlash($v) { return substr($v, -1) === '/' ? substr($v, 0, -1) : $v; }

  private function parseUrl($url) {
    if (!preg_match('/^(https?):\/\/([^\/?#]+)([^?#]*)/i', (string) $url, $m)) { return null; }
    return ['scheme' => strtolower($m[1]), 'host' => $m[2], 'path' => $m[3] !== '' ? $m[3] : '/'];
  }

  private function resolveUrl($base, $rel) {
    if (preg_match('/^[a-z][a-z0-9+.-]*:/i', $rel)) { return $rel; }
    if (!preg_match('/^([a-z][a-z0-9+.-]*:)\/\/([^\/?#]*)([^?#]*)/i', (string) $base, $m)) { return $rel; }
    if (strpos($rel, '//') === 0) { return $m[1] . $rel; }
    if (strpos($rel, '/') === 0) { $path = $rel; }
    elseif (strpos($rel, '?') === 0) { $path = $m[3] . $rel; }
    else { $dir = preg_replace('/[^\/]*$/', '', $m[3]); $path = ($dir !== '' ? $dir : '/') . $rel; }
    preg_match('/^([^?#]*)(.*)$/s', $path, $q);
    $segs = explode('/', $q[1]);
    $out = [];
    foreach ($segs as $i => $s) {
      $last = $i === count($segs) - 1;
      if ($s === '..') { if (count($out) > 1) { array_pop($out); } if ($last) { $out[] = ''; } }
      elseif ($s === '.') { if ($last) { $out[] = ''; } }
      else { $out[] = $s; }
    }
    return $m[1] . '//' . $m[2] . implode('/', $out) . $q[2];
  }

  private function strip($html) {
    $html = preg_replace('/<script\b[\s\S]*?<\/script\s*>/i', '', (string) $html);
    $html = preg_replace('/<script\b[^>]*>/i', '', $html);
    return preg_replace('/\son[a-z]+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $html);
  }

  private function getJson($ctx, $url) {
    try {
      $r = $ctx->fetch($url, ['headers' => ['Accept' => 'application/json']]);
      return ['ok' => $r['status'] < 400, 'status' => $r['status'], 'data' => $r['json'] ?? null];
    } catch (Exception $e) {
      return ['ok' => false, 'status' => 0, 'data' => null];
    }
  }

  private function reason($res, $fallback) {
    $d = $res['data'] ?? null;
    if (is_array($d)) { foreach (['reason', 'message', 'error', 'error_type', 'type'] as $k) { if (is_string($d[$k] ?? null) && $d[$k] !== '') { return $d[$k]; } } }
    return $fallback !== '' ? $fallback : 'Unknown error';
  }

  private function restDenied($res) {
    return ($res['status'] === 401 || $res['status'] === 403) && strpos(strtolower($this->reason($res, '')), 'plone.restapi') !== false;
  }

  private function candidates($u) {
    $origin = $u['scheme'] . '://' . $u['host'];
    $parts = array_values(array_filter(explode('/', $u['path']), 'strlen'));
    while ($parts && in_array($parts[count($parts) - 1], self::STOP_SEGMENTS, true)) { array_pop($parts); }
    $out = [];
    for ($i = count($parts); $i >= 0; $i--) {
      $c = $this->stripSlash($i > 0 ? $origin . '/' . implode('/', array_slice($parts, 0, $i)) : $origin);
      if (!in_array($c, $out, true)) { $out[] = $c; }
    }
    return $out;
  }

  private function discover($ctx, $u) {
    $blocked = null;
    foreach ($this->candidates($u) as $c) {
      $site = $this->getJson($ctx, "$c/@site");
      if ($site['ok'] && is_array($site['data'])) { return ['base' => $c, 'site' => $site['data']]; }
      if ($this->restDenied($site)) { $blocked = ['base' => $c, 'status' => $site['status']]; }
      $api = $this->getJson($ctx, "$c/++api++");
      if ($this->restDenied($api)) { $blocked = ['base' => $c, 'status' => $api['status']]; }
    }
    if ($blocked) { return ['error' => 'Plone REST API detected at ' . $blocked['base'] . ' but access is denied (' . $blocked['status'] . '). Enable "plone.restapi: Use REST API" permission for authenticated/anonymous access and retry.']; }
    return ['error' => 'Unable to discover Plone REST endpoints from url. Expected endpoints like /@site and /@search. Install/enable the plone.restapi add-on and expose REST access before importing.'];
  }

  private function searchUrl($base, $start, $full) {
    $q = ["b_start=$start", 'b_size=' . self::BATCH, 'sort_on=path', 'sort_order=ascending'];
    foreach (self::METADATA_FIELDS as $f) { $q[] = "metadata_fields=$f"; }
    if ($full) { $q[] = 'fullobjects=1'; }
    return "$base/@search?" . implode('&', $q);
  }

  private function searchAll($ctx, $base) {
    $start = 0; $pages = 0; $total = null; $full = true; $all = [];
    while ($pages < self::MAX_SEARCH_PAGES && count($all) < self::MAX_ITEMS) {
      $res = $this->getJson($ctx, $this->searchUrl($base, $start, $full));
      if (!$res['ok'] && $full) {
        $fallback = $this->getJson($ctx, $this->searchUrl($base, $start, false));
        if ($fallback['ok']) { $res = $fallback; $full = false; }
      }
      if (!$res['ok']) {
        if ($this->restDenied($res)) { return ['error' => 'Plone REST search endpoint is not accessible. Enable "plone.restapi: Use REST API" permission and retry.']; }
        if ($res['status'] === 404) { return ['error' => 'Plone REST search endpoint /@search was not found. Enable/install plone.restapi and retry.']; }
        return ['error' => "Plone search failed at $base/@search (" . $res['status'] . '): ' . $this->reason($res, 'search request failed')];
      }
      $payload = is_array($res['data']) ? $res['data'] : [];
      $batch = isset($payload['items']) && is_array($payload['items']) ? $payload['items'] : [];
      if (isset($payload['items_total']) && (is_int($payload['items_total']) || is_float($payload['items_total']))) { $total = $payload['items_total']; }
      if (!$batch) { break; }
      foreach ($batch as $it) { $all[] = $it; if (count($all) >= self::MAX_ITEMS) { break; } }
      $start += count($batch);
      $pages++;
      if (($total !== null && $start >= $total) || count($batch) < self::BATCH) { break; }
    }
    return ['items' => $all, 'full' => $full];
  }

  private function relativePath($itemUrl, $basePath) {
    $u = $this->parseUrl($itemUrl);
    if (!$u) { return ''; }
    $p = $u['path'];
    $b = $basePath === '/' ? '' : $this->stripSlash($basePath);
    if ($b !== '' && $p === $b) { return ''; }
    $p = ($b !== '' && strpos($p, "$b/") === 0) ? substr($p, strlen($b) + 1) : preg_replace('/^\/+/', '', $p);
    $p = preg_replace('/\/+$/', '', $p);
    return rawurldecode($p);
  }

  private function importAsPage($item, $type) {
    if (!$type || in_array($type, self::BINARY_TYPES, true)) { return false; }
    if (in_array($type, self::PAGE_TYPES, true) || ($item['is_folderish'] ?? null) === true) { return true; }
    if (is_array($item['text'] ?? null) && $this->isText($item['text']['data'] ?? null)) { return true; }
    return $this->isText($item['description'] ?? null);
  }

  private function absolutize($html, $origin) {
    return str_replace(['href="/', 'src="/', 'poster="/', 'srcset="/'], ["href=\"$origin/", "src=\"$origin/", "poster=\"$origin/", "srcset=\"$origin/"], $html);
  }

  private function contents($item, $type, $origin) {
    if (is_array($item['text'] ?? null) && $this->isText($item['text']['data'] ?? null)) { return $this->strip($this->absolutize($item['text']['data'], $origin)); }
    if ($type === 'Link' && !empty($item['remoteUrl'])) { return $this->strip('<p><a href="' . $item['remoteUrl'] . '" target="_blank" rel="noopener noreferrer">' . $item['remoteUrl'] . '</a></p>'); }
    if (!empty($item['blocks']) && is_array($item['blocks_layout'] ?? null) && !empty($item['blocks_layout']['items']) && is_array($item['blocks_layout']['items'])) { return '<p>This Plone item stores body content in blocks and requires a blocks-to-HTML transform for full fidelity import.</p>'; }
    if ($this->isText($item['description'] ?? null)) { return $this->strip('<p>' . trim($item['description']) . '</p>'); }
    return '<p></p>';
  }

  private function record($item, $type, $rel, $origin) {
    $parts = array_values(array_filter(explode('/', $rel), 'strlen'));
    if (!$parts) { return null; }
    $hint = $this->positiveInt($item['getObjPositionInParent'] ?? null, -1);
    return [
      'relativePath' => $rel,
      'parentPath' => count($parts) > 1 ? implode('/', array_slice($parts, 0, -1)) : '',
      'slug' => implode('/', array_map([$this, 'cleanTitle'], $parts)),
      'title' => $this->isText($item['title'] ?? null) ? trim($item['title']) : $parts[count($parts) - 1],
      'description' => is_string($item['description'] ?? null) ? $item['description'] : '',
      'orderHint' => $hint >= 0 ? $hint : null,
      'content' => $this->contents($item, $type, $origin),
      'metadata' => [
        'sourceType' => 'plone',
        'source' => $item['@id'],
        'plone' => ['uid' => !empty($item['UID']) ? $item['UID'] : '', 'type' => $type, 'reviewState' => !empty($item['review_state']) ? $item['review_state'] : '', 'created' => !empty($item['created']) ? $item['created'] : '', 'modified' => !empty($item['modified']) ? $item['modified'] : ''],
      ],
    ];
  }

  private function score($r) {
    return ($r['content'] !== '<p></p>' ? 2 : 0) + ($r['description'] !== '' ? 1 : 0) + ($r['orderHint'] !== null ? 1 : 0);
  }

  private function sanitizeFilename($value) {
    $f = preg_replace('/--+/', '-', preg_replace('/[^a-z0-9\-._\/]+/', '-', preg_replace('/\s+/', '-', trim(mb_strtolower($value)))));
    return $f === '' ? 'file' : $f;
  }

  private function uniqueKey($files, $key) {
    if (empty($files[$key])) { return $key; }
    $parts = explode('/', $key);
    $name = array_pop($parts);
    $folder = implode('/', $parts);
    $dot = strrpos($name, '.');
    $stem = ($dot !== false && $dot > 0) ? substr($name, 0, $dot) : $name;
    $ext = ($dot !== false && $dot > 0) ? substr($name, $dot) : '';
    $i = 2;
    while (!empty($files["$folder/$stem-$i$ext"])) { $i++; }
    return "$folder/$stem-$i$ext";
  }

  private function registerBinary($item, &$files) {
    $filename = ''; $download = '';
    foreach (['file', 'image'] as $field) {
      $f = $item[$field] ?? null;
      if (!is_array($f)) { continue; }
      if ($filename === '' && is_string($f['filename'] ?? null)) { $filename = $f['filename']; }
      if ($download === '' && is_string($f['download'] ?? null)) { $download = $this->resolveUrl($item['@id'], $f['download']); }
    }
    $type = $item['@type'] ?? null;
    if ($download === '' && $type === 'File') { $download = $this->stripSlash($item['@id']) . '/@@download/file'; }
    if ($download === '' && $type === 'Image') { $download = $this->stripSlash($item['@id']) . '/@@images/image'; }
    if ($filename === '') { $bits = explode('/', (string) $item['@id']); $filename = end($bits); }
    if ($filename === '' || $download === '') { return; }
    $files[$this->uniqueKey($files, 'files/' . $this->sanitizeFilename($filename))] = $download;
  }

  private function compare($a, $b) {
    $ah = $a['orderHint'] !== null; $bh = $b['orderHint'] !== null;
    if ($ah && $bh && $a['orderHint'] !== $b['orderHint']) { return $a['orderHint'] - $b['orderHint']; }
    if ($ah && !$bh) { return -1; }
    if (!$ah && $bh) { return 1; }
    return $a['title'] < $b['title'] ? -1 : ($a['title'] > $b['title'] ? 1 : 0);
  }

  private function toItems($records) {
    $byPath = [];
    foreach ($records as $r) { $byPath['p:' . $r['relativePath']] = true; }
    $children = [];
    foreach ($records as $r) {
      $parent = ($r['parentPath'] !== '' && isset($byPath['p:' . $r['parentPath']])) ? $r['parentPath'] : '';
      $children['p:' . $parent][] = $r;
    }
    foreach ($children as $k => $list) { usort($list, [$this, 'compare']); $children[$k] = $list; }
    $items = []; $seen = [];
    $walk = function ($parentPath, $parentId, $depth) use (&$walk, &$items, &$seen, $children) {
      foreach ($children['p:' . $parentPath] ?? [] as $i => $r) {
        if (isset($seen['p:' . $r['relativePath']])) { continue; }
        $seen['p:' . $r['relativePath']] = true;
        $id = 'item-' . (count($items) + 1);
        $items[] = ['id' => $id, 'title' => $r['title'], 'slug' => $r['slug'], 'parent' => $parentId, 'order' => $i, 'indent' => $depth, 'description' => $r['description'], 'content' => $r['content'], 'metadata' => $r['metadata']];
        $walk($r['relativePath'], $id, $depth + 1);
      }
    };
    $walk('', null, 0);
    return $items;
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Finds the Plone REST API from any URL inside the site, reads every item through @search, and returns documents,
   * folders, news, events and links as a page tree by path, with images and files listed for core to fetch.
   * Items whose body is in Volto blocks get a placeholder paragraph, as in core.
   *
   * @param object $ctx    Platform context (spec/13); $ctx->fetch() reaches only the input url's host.
   * @param array  $input  [url] of the Plone site or any page in it.
   * @return array  [title, items, files] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    if (!$this->isText($input['url'] ?? null)) { return ['error' => 'url is required']; }
    // core needs the full URL to open its host for this call (egress { input: url }), so no scheme guessing here
    $u = $this->parseUrl(trim($input['url']));
    if (!$u) { return ['error' => 'url is not a valid http(s) URL']; }
    $found = $this->discover($ctx, $u);
    if (isset($found['error'])) { return ['error' => $found['error']]; }
    $search = $this->searchAll($ctx, $found['base']);
    if (isset($search['error'])) { return ['error' => $search['error']]; }
    $baseUrl = $this->parseUrl($found['base']);
    $origin = $baseUrl['scheme'] . '://' . $baseUrl['host'];
    $byPath = []; $files = [];
    foreach ($search['items'] as $item) {
      if (!$search['full'] && is_array($item) && !empty($item['@id'])) {
        $full = $this->getJson($ctx, $item['@id']);
        if ($full['ok'] && is_array($full['data'])) { $item = array_merge($item, $full['data']); }
      }
      if (!is_array($item) || empty($item['@id'])) { continue; }
      $type = !empty($item['@type']) ? $item['@type'] : ($item['portal_type'] ?? null);
      if (in_array($type, self::BINARY_TYPES, true)) { $this->registerBinary($item, $files); continue; }
      if (!$this->importAsPage($item, $type)) { continue; }
      $rel = $this->relativePath($item['@id'], $baseUrl['path']);
      if ($rel === '') { continue; }
      $r = $this->record($item, $type, $rel, $origin);
      if ($r && (!isset($byPath['p:' . $rel]) || $this->score($r) > $this->score($byPath['p:' . $rel]))) { $byPath['p:' . $rel] = $r; }
    }
    $items = $this->toItems(array_values($byPath));
    if (!$items) { return ['error' => 'Plone REST API is reachable but import produced no page-like content items']; }
    $bits = array_values(array_filter(explode('/', $baseUrl['path']), 'strlen'));
    $title = $this->isText($found['site']['title'] ?? null) ? trim($found['site']['title']) : ($bits ? end($bits) : 'Plone site');
    $out = [];
    foreach ($files as $path => $url) { $out[] = ['path' => (string) $path, 'url' => $url]; }
    return ['title' => $title, 'items' => $items, 'files' => $out];
  }
}

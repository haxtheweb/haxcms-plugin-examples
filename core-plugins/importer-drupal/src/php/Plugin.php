<?php
// Drupal importer (PHP). Mirrors src/nodejs/index.js; identical output. Helper names match the Node functions.
class ImporterDrupalPlugin {
  const MAX_FILES = 2000;
  const SAFE_EXT = '/\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|html|md|xml|ics|vcf|h5p)$/i';
  const FILES_PATH = '/^\/(?:sites\/[^\/]+\/)?files\/(.+)$/i';
  const MEDIA_KINDS = ['image' => 'image', 'document' => 'document', 'video' => 'video', 'audio' => 'audio', 'remote_video' => 'remote-video'];
  const MEDIA_FILE_FIELDS = ['image' => ['field_media_image', 'thumbnail'], 'document' => ['field_media_document'], 'video' => ['field_media_video'], 'audio' => ['field_media_audio']];
  const ACCEPT = ['headers' => ['Accept' => 'application/vnd.api+json,application/json']];

  private function isObj($x) { return is_array($x) && ($x === [] || array_keys($x) !== range(0, count($x) - 1)); }
  private function isList($x) { return is_array($x) && ($x === [] || array_keys($x) === range(0, count($x) - 1)); }
  private function str($x) { return is_string($x) ? $x : ''; }

  /** Removes script and style blocks and inline event handlers; core sanitizes again on save. */
  private function strip($html) {
    return preg_replace('/\son\w+\s*=\s*("[^"]*"|\'[^\']*\')/i', '', preg_replace('/<(script|style)\b[\s\S]*?<\/\1\s*>/i', '', (string) $html));
  }
  private function esc($s) { return str_replace(['&', '"', "'", '<', '>'], ['&amp;', '&quot;', '&#39;', '&lt;', '&gt;'], (string) $s); }

  /** Core's HAXCMS::cleanTitle($value, false). */
  private function cleanTitle($value) {
    $s = preg_replace('/--+/', '-', preg_replace('/[^\w\-\/]+/', '-', strtolower(str_replace(' ', '-', trim((string) $value)))));
    return $s === '' ? 'blank' : $s;
  }

  /** Leading integer of a number or string, else the fallback (see num in src/nodejs/index.js). */
  private function num($v, $fallback = 0) {
    if (is_int($v)) { return $v; }
    if (is_float($v)) { return is_finite($v) ? (int) $v : $fallback; }
    if (is_string($v)) { return preg_match('/^\s*([-+]?\d+)/', $v, $m) ? (int) $m[1] : $fallback; }
    return $fallback;
  }
  // JavaScript truthiness, spelled out ("0" is truthy there)
  private function truthy($v) { return $v !== null && $v !== false && $v !== 0 && $v !== 0.0 && $v !== '' && !(is_float($v) && is_nan($v)); }
  private function firstTruthy(...$vals) { foreach ($vals as $v) { if ($this->truthy($v)) { return $v; } } return null; }
  private function lower($s) { return function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s); }

  private function json($ctx, $url) {
    try { $r = $ctx->fetch($url, self::ACCEPT); return $r['status'] < 400 ? $r['json'] : null; } catch (Exception $e) { return null; }
  }

  private function withLimit($url, $n) {
    if (strpos($url, 'page[limit]=') !== false || strpos($url, 'page%5Blimit%5D=') !== false) { return $url; }
    return $url . (strpos($url, '?') === false ? '?' : '&') . "page[limit]=$n";
  }

  /** Every record of a JSON:API collection, following links.next (only on the named host; egress refuses others). */
  private function collection($ctx, $href, $limit, $maxPages) {
    $out = [];
    $url = $href ? $this->withLimit($href, $limit) : null;
    for ($page = 0; $url && $page < $maxPages; $page++) {
      $payload = $this->json($ctx, $url);
      if (!$this->isObj($payload) || !isset($payload['data']) || !$this->isList($payload['data'])) { break; }
      foreach ($payload['data'] as $r) { $out[] = $r; }
      $next = (isset($payload['links']) && $this->isObj($payload['links']) && isset($payload['links']['next']) && $this->isObj($payload['links']['next'])) ? ($payload['links']['next']['href'] ?? null) : null;
      $url = is_string($next) && $next !== '' ? $next : null;
    }
    return $out;
  }

  private function origin($url) {
    $u = parse_url($url);
    if (!$u || empty($u['scheme']) || empty($u['host'])) { return null; }
    return strtolower($u['scheme']) . '://' . strtolower($u['host']) . (isset($u['port']) ? ':' . $u['port'] : '');
  }
  private function pathParts($url) {
    return array_values(array_filter(explode('/', (string) parse_url($url, PHP_URL_PATH)), 'strlen'));
  }

  /** The JSON:API base: the given path, then each parent path, then the origin, whichever answers /jsonapi with links. */
  private function discover($ctx, $url) {
    $origin = $this->origin($url);
    if ($origin === null) { return null; }
    $parts = $this->pathParts($url);
    for ($i = count($parts); $i >= 0; $i--) {
      $base = $i > 0 ? $origin . '/' . implode('/', array_slice($parts, 0, $i)) : $origin;
      $payload = $this->json($ctx, "$base/jsonapi");
      if ($this->isObj($payload) && isset($payload['links']) && $this->isObj($payload['links'])) { return ['base' => $base, 'links' => $payload['links']]; }
    }
    return null;
  }

  private function nid($r) { return ($this->isObj($r) && isset($r['attributes']) && $this->isObj($r['attributes'])) ? $this->num($r['attributes']['drupal_internal__nid'] ?? null, 0) : 0; }
  private function nodeTitle($r) {
    $t = ($this->isObj($r) && isset($r['attributes']) && $this->isObj($r['attributes']) && $this->truthy($r['attributes']['title'] ?? null)) ? trim((string) $r['attributes']['title']) : '';
    if ($t !== '') { return $t; }
    return $this->nid($r) > 0 ? 'Node ' . $this->nid($r) : 'Node';
  }
  private function nodeSegment($r) {
    $alias = (isset($r['attributes']['path']) && $this->isObj($r['attributes']['path'])) ? $this->str($r['attributes']['path']['alias'] ?? null) : '';
    $parts = array_values(array_filter(explode('/', $alias), 'strlen'));
    if ($parts) { return $this->cleanTitle($parts[count($parts) - 1]); }
    return $this->cleanTitle($this->nodeTitle($r));
  }
  private function uniqueSegment($segment, &$siblings, $n) {
    if (empty($siblings[$segment])) { $siblings[$segment] = true; return $segment; }
    $c = "$segment-$n";
    if (empty($siblings[$c])) { $siblings[$c] = true; return $c; }
    $i = 2;
    while (!empty($siblings["$c-$i"])) { $i++; }
    $c = "$c-$i";
    $siblings[$c] = true;
    return $c;
  }
  private function nodeMetadata($r, $base, $inOutline) {
    $n = $this->nid($r);
    $published = !(isset($r['attributes']) && $this->isObj($r['attributes']) && array_key_exists('status', $r['attributes']) && $r['attributes']['status'] === false);
    return ['sourceType' => 'drupal-node', 'source' => $n > 0 ? "$base/node/$n" : null, 'published' => $published, 'drupal' => ['nid' => $n, 'uuid' => $this->str($r['id'] ?? null) ?: null, 'type' => $this->str($r['type'] ?? null) ?: null, 'inOutline' => $inOutline]];
  }
  private function siteName($url) {
    $u = parse_url($url);
    if ($u && !empty($u['scheme']) && !empty($u['host'])) {
      $parts = $this->pathParts($url);
      if ($parts) {
        $last = rawurldecode($parts[count($parts) - 1]);
        if (preg_match('/^jsonapi$/i', $last)) { $last = count($parts) > 1 ? rawurldecode($parts[count($parts) - 2]) : ''; }
        if ($last !== '') { $c = $this->cleanTitle($last); if ($c !== 'blank') { return $c; } }
      }
      $h = $this->cleanTitle(strtolower($u['host']) . (isset($u['port']) ? ':' . $u['port'] : ''));
      if ($h !== 'blank') { return $h; }
    }
    return 'drupal-import';
  }

  // ---- files and media ----

  private function stripExtras($v) { return explode('?', explode('#', trim((string) $v))[0])[0]; }
  private function urlPath($v) { $p = parse_url($v, PHP_URL_PATH); return $p === false ? null : ($p === null || $p === '' ? '/' : $p); }
  private function pathOf($value) {
    $v = $this->stripExtras($value);
    if ($v === '' || strpos($v, '//') === 0) { return null; }
    if (preg_match('/^[a-z][a-z0-9+.-]*:\/\//i', $v)) { return $this->urlPath($v); }
    if (preg_match('/^[a-z][a-z0-9+.-]*:/i', $v) || $v[0] !== '/') { return null; }
    return $v;
  }

  private function fileMap($records, $base) {
    $files = []; $byKey = []; $byUuid = []; $byPath = [];
    $origin = $this->origin($base);
    foreach ($records as $r) {
      if (!$this->isObj($r) || !isset($r['attributes']) || !$this->isObj($r['attributes']) || ($r['attributes']['status'] ?? null) !== true) { continue; }
      $url = (isset($r['attributes']['uri']) && $this->isObj($r['attributes']['uri'])) ? $this->str($r['attributes']['uri']['url'] ?? null) : '';
      $pathname = $url !== '' ? $this->pathOf($url) : null;
      if ($pathname === null) { continue; }
      $key = preg_match(self::FILES_PATH, $pathname, $m) ? $m[1] : preg_replace('/^\//', '', $pathname);
      if ($key === '' || strpos($key, '..') !== false || strpos($key, "\0") !== false || !preg_match(self::SAFE_EXT, $key) || isset($byKey[$key]) || count($files) >= self::MAX_FILES) { continue; }
      $abs = preg_match('/^https?:\/\//i', $url) ? $url : $origin . ($url[0] === '/' ? '' : '/') . $url;
      $byKey[$key] = true;
      $files[] = ['path' => "files/$key", 'url' => $abs];
      $byPath[$pathname] = "files/$key";
      if ($this->str($r['id'] ?? null) !== '') { $byUuid[$r['id']] = ['key' => $key, 'ref' => "files/$key", 'filename' => $this->str($r['attributes']['filename'] ?? null)]; }
    }
    return ['files' => $files, 'byUuid' => $byUuid, 'byPath' => $byPath];
  }

  private function firstRel($rel) {
    if (!$this->isObj($rel) || !isset($rel['data']) || !is_array($rel['data'])) { return null; }
    $d = $rel['data'];
    if ($this->isObj($d) && $this->truthy($d['id'] ?? null)) { return $d; }
    if ($this->isList($d) && isset($d[0]) && $this->isObj($d[0]) && $this->truthy($d[0]['id'] ?? null)) { return $d[0]; }
    return null;
  }

  private function mediaElement($kind, $ref, $alt, $title) {
    if ($kind === 'image') { return '<media-image source="' . $this->esc($ref) . '" alt="' . $this->esc($alt) . '"></media-image>'; }
    if ($kind === 'video') { return '<video-player source="' . $this->esc($ref) . '" media-title="' . $this->esc($title) . '"></video-player>'; }
    if ($kind === 'audio') { return '<media-playlist><audio-player source="' . $this->esc($ref) . '" media-title="' . $this->esc($title) . '"></audio-player></media-playlist>'; }
    return '<a href="' . $this->esc($ref) . '">' . $this->esc($title) . '</a>';
  }

  /** media--<bundle> record -> HAX element (media-image, video-player, audio-player, or a link), or null. */
  private function mediaFor($r, $map) {
    $type = $this->str($r['type'] ?? null);
    $bundle = strpos($type, '--') !== false ? substr($type, strrpos($type, '--') + 2) : '';
    $kind = self::MEDIA_KINDS[$bundle] ?? 'file';
    $attrs = (isset($r['attributes']) && $this->isObj($r['attributes'])) ? $r['attributes'] : [];
    $rels = (isset($r['relationships']) && $this->isObj($r['relationships'])) ? $r['relationships'] : [];
    $name = $this->str($attrs['name'] ?? null);
    if ($kind === 'remote-video') {
      $o = $attrs['field_media_oembed_video'] ?? null;
      $url = is_string($o) ? $o : ($this->isObj($o) ? $this->str($o['value'] ?? null) : '');
      return ($url !== '' && preg_match('/^https?:\/\//i', $url)) ? $this->mediaElement('video', $url, '', $name !== '' ? $name : $url) : null;
    }
    $data = null;
    foreach (self::MEDIA_FILE_FIELDS[$kind] ?? [] as $f) { $d = $this->firstRel($rels[$f] ?? null); if ($d && ($d['type'] ?? null) === 'file--file') { $data = $d; break; } }
    if (!$data) { foreach ($rels as $rel) { $d = $this->firstRel($rel); if ($d && ($d['type'] ?? null) === 'file--file') { $data = $d; break; } } }
    $file = ($data && is_string($data['id'])) ? ($map['byUuid'][$data['id']] ?? null) : null;
    if (!$file) { return null; }
    $meta = (isset($data['meta']) && $this->isObj($data['meta'])) ? $data['meta'] : [];
    $title = $this->str($meta['title'] ?? null);
    if ($title === '') { $title = $name; }
    if ($title === '') { $title = $file['filename']; }
    if ($title === '') { $title = $file['key']; }
    return $this->mediaElement($kind, $file['ref'], $this->str($meta['alt'] ?? null), $title);
  }

  // ---- page content ----

  private function fileRef($value, $map) {
    $v = $this->stripExtras($value);
    if ($v === '' || strpos($v, '//') === 0) { return null; }
    if (preg_match('/^[a-z][a-z0-9+.-]*:\/\//i', $v)) { $p = $this->urlPath($v); return $p === null ? null : ($map['byPath'][$p] ?? null); }
    if (preg_match('/^[a-z][a-z0-9+.-]*:/i', $v)) { return null; }
    $p = ltrim($v, '/');
    return $p === '' ? null : ($map['byPath']["/$p"] ?? null);
  }

  /** Points src, href, poster, source and srcset values at known Drupal files to their files/... path. */
  private function rewriteFiles($html, $map) {
    return preg_replace_callback('/(\s)(src|href|poster|source|srcset)(\s*=\s*)(?:"([^"]*)"|\'([^\']*)\')/i', function ($m) use ($map) {
      $single = isset($m[5]);
      $q = $single ? "'" : '"';
      $value = $single ? $m[5] : $m[4];
      $out = $value;
      if (strtolower($m[2]) === 'srcset') {
        $parts = [];
        foreach (explode(',', $value) as $part) {
          $part = trim($part);
          if ($part === '') { continue; }
          $pieces = preg_split('/\s+/', $part);
          $ref = $this->fileRef($pieces[0], $map);
          if ($ref) { $pieces[0] = $ref; }
          $parts[] = implode(' ', $pieces);
        }
        $out = implode(', ', $parts);
      } else {
        $ref = $this->fileRef($value, $map);
        if ($ref) { $out = $ref; }
      }
      return $m[1] . $m[2] . $m[3] . $q . $out . $q;
    }, $html);
  }

  private function pageContent($r, $base, $media, $map) {
    $attrs = (isset($r['attributes']) && $this->isObj($r['attributes'])) ? $r['attributes'] : [];
    $body = $attrs['body'] ?? null;
    $raw = ($this->isObj($body) && is_string($body['value'] ?? null)) ? $body['value'] : $this->str($body);
    $content = '';
    if ($raw !== '') {
      $content = preg_replace_callback('/<drupal-media\b([^>]*)>([\s\S]*?)<\/drupal-media\s*>|<drupal-media\b([^>]*)\/>/i', function ($m) use ($media) {
        $a = isset($m[3]) ? $m[3] : $m[1];
        $id = preg_match('/data-entity-uuid\s*=\s*(?:"([^"]*)"|\'([^\']*)\')/i', $a, $u) ? (isset($u[2]) ? $u[2] : $u[1]) : '';
        return ($id !== '' && !empty($media[$id])) ? $media[$id] : '';
      }, $this->strip($raw));
      $content = $this->rewriteFiles($content, $map);
    }
    if ($content === '') {
      $d = $this->firstRel(isset($r['relationships']) && $this->isObj($r['relationships']) ? ($r['relationships']['field_media'] ?? null) : null);
      $content = ($d && is_string($d['id']) && !empty($media[$d['id']])) ? $media[$d['id']] : '';
    }
    if ($content === '') { return '<p></p>'; }
    $origin = $this->origin($base);
    return str_replace(['href="/', 'src="/', 'poster="/', 'srcset="/'], ["href=\"$origin/", "src=\"$origin/", "poster=\"$origin/", "srcset=\"$origin/"], $content);
  }

  // ---- outline ----

  private function menuNid($uri) {
    if (!is_string($uri)) { return 0; }
    $u = trim($uri);
    if (preg_match('/^entity:node\/(\d+)$/i', $u, $m) || preg_match('/^internal:\/node\/(\d+)$/i', $u, $m) || preg_match('/\/node\/(\d+)/i', $u, $m)) { return $this->num($m[1], 0); }
    return 0;
  }
  private function parentLinkId($r) {
    $attrs = (isset($r['attributes']) && $this->isObj($r['attributes'])) ? $r['attributes'] : [];
    $rels = (isset($r['relationships']) && $this->isObj($r['relationships'])) ? $r['relationships'] : [];
    if (is_string($attrs['parent'] ?? null) && trim($attrs['parent']) !== '') { $p = trim($attrs['parent']); return strpos($p, ':') !== false ? substr($p, strrpos($p, ':') + 1) : $p; }
    if (isset($rels['parent']['data']) && $this->isObj($rels['parent']['data']) && $this->truthy($rels['parent']['data']['id'] ?? null)) { return (string) $rels['parent']['data']['id']; }
    return '';
  }
  private function addRelation(&$rel, $n, $parentNid, $weight) {
    if (!isset($rel[$n])) { $rel[$n] = ['parentNid' => $parentNid, 'weight' => $weight]; }
    elseif ($weight < $rel[$n]['weight']) { $rel[$n]['weight'] = $weight; }
  }
  private function childrenOf($rel) {
    $buckets = [];
    foreach ($rel as $n => $r) { $buckets[$r['parentNid']][] = ['nid' => $n, 'weight' => $r['weight']]; }
    $out = [];
    foreach ($buckets as $p => $list) {
      usort($list, function ($a, $b) { return ($a['weight'] <=> $b['weight']) ?: ($a['nid'] <=> $b['nid']); });
      $out[$p] = array_column($list, 'nid');
    }
    return $out;
  }
  // walk up parent links until one reaches a page; links to views or external pages are skipped
  private function ancestorNid($parentId, $byPluginId, $pages) {
    $cur = $parentId;
    for ($hops = 0; $cur !== '' && $hops < 20; $hops++) {
      if (!isset($byPluginId[$cur])) { return 0; }
      $item = $byPluginId[$cur];
      if ($item['nid'] > 0 && isset($pages[$item['nid']])) { return $item['nid']; }
      $cur = $item['parentId'];
    }
    return 0;
  }

  /** menu_link_content -> tree: the main menu (or the one linking the most pages), other menus' pages appended. */
  private function forestFromMenuLinks($records, $pages) {
    $groups = []; // keys prefixed so a numeric menu name stays a string key
    foreach ($records as $r) {
      if (!$this->isObj($r) || !isset($r['attributes']) || !$this->isObj($r['attributes'])) { continue; }
      $a = $r['attributes'];
      $menu = (is_string($a['menu_name'] ?? null) && trim($a['menu_name']) !== '') ? trim($a['menu_name']) : '__default__';
      $groups["m:$menu"][] = ['id' => $this->str($r['id'] ?? null), 'nid' => (isset($a['link']) && $this->isObj($a['link'])) ? $this->menuNid($a['link']['uri'] ?? null) : 0, 'weight' => $this->num($a['weight'] ?? null, 0), 'parentId' => $this->parentLinkId($r)];
    }
    $linked = function ($e) use ($pages) { return $e['nid'] > 0 && isset($pages[$e['nid']]); };
    $selected = null;
    if (isset($groups['m:main']) && count(array_filter($groups['m:main'], $linked))) { $selected = 'm:main'; }
    else { $best = 0; foreach ($groups as $name => $list) { $c = count(array_filter($list, $linked)); if ($c > $best) { $best = $c; $selected = $name; } } }
    if ($selected === null) { return null; }
    $byPluginId = [];
    foreach ($groups[$selected] as $e) { if ($e['id'] !== '') { $byPluginId[$e['id']] = $e; } }
    $rel = [];
    foreach ($groups[$selected] as $e) { if ($linked($e)) { $this->addRelation($rel, $e['nid'], $this->ancestorNid($e['parentId'], $byPluginId, $pages), $e['weight']); } }
    if (!$rel) { return null; }
    $children = $this->childrenOf($rel);
    $others = []; $seen = [];
    foreach ($groups as $name => $list) {
      if ($name === $selected) { continue; }
      foreach ($list as $e) { if ($linked($e) && !isset($rel[$e['nid']]) && !isset($seen[$e['nid']])) { $seen[$e['nid']] = true; $others[] = $e; } }
    }
    if ($others) {
      usort($others, function ($a, $b) { return ($a['weight'] <=> $b['weight']) ?: ($a['nid'] <=> $b['nid']); });
      $children[0] = array_merge($children[0] ?? [], array_column($others, 'nid'));
    }
    return $children;
  }

  /** node--book book fields -> tree (book sites without menu links). */
  private function forestFromBooks($records, $pages) {
    $rel = [];
    foreach ($records as $r) {
      if (!$this->isObj($r) || !isset($r['attributes']) || !$this->isObj($r['attributes'])) { continue; }
      $a = $r['attributes'];
      $n = $this->nid($r);
      if (!$n || !isset($pages[$n])) { continue; }
      if (isset($a['book']) && $this->isObj($a['book'])) {
        $b = $a['book'];
        $p = $this->num($this->firstTruthy($b['pid'] ?? null, $b['parent'] ?? null, $b['parent_nid'] ?? null), 0);
        $this->addRelation($rel, $n, isset($pages[$p]) ? $p : 0, $this->num($this->firstTruthy($b['weight'] ?? null, $b['menu_order'] ?? null), 0));
        continue;
      }
      $p = $this->num($this->firstTruthy($a['book_parent'] ?? null, $a['book_parent_id'] ?? null, $a['book_parent_nid'] ?? null, $a['field_book_parent'] ?? null, $a['field_book_parent_nid'] ?? null), 0);
      if ($p || ($a['book_parent'] ?? null) === 0 || ($a['book_parent_id'] ?? null) === 0) { $this->addRelation($rel, $n, isset($pages[$p]) ? $p : 0, $this->num($this->firstTruthy($a['book_weight'] ?? null, $a['book_order'] ?? null), 0)); }
    }
    return $rel ? $this->childrenOf($rel) : null;
  }

  private function created($r) { return (isset($r['attributes']) && $this->isObj($r['attributes'])) ? $this->str($r['attributes']['created'] ?? null) : ''; }

  // per-call state for the outline walk (one call at a time per instance)
  private $s;

  private function content($n) {
    if (!array_key_exists($n, $this->s['cache'])) { $this->s['cache'][$n] = isset($this->s['records'][$n]) ? $this->pageContent($this->s['records'][$n], $this->s['base'], $this->s['media'], $this->s['map']) : '<p></p>'; }
    return $this->s['cache'][$n];
  }
  // a top-level page with no content but with children is structural: its children take its place
  private function expand($list) {
    $out = [];
    foreach ($list as $n) {
      if (isset($this->s['dropped'][$n])) { continue; }
      $kids = $this->s['children'][$n] ?? [];
      if ($this->content($n) === '<p></p>' && $kids) { $this->s['dropped'][$n] = true; foreach ($this->expand($kids) as $k) { $out[] = $k; } continue; }
      $out[] = $n;
    }
    return $out;
  }
  private function walk($list, $parent, $prefix, $indent) {
    $siblings = [];
    $order = 0;
    foreach ($list as $n) {
      $r = $this->s['records'][$n] ?? null;
      if (!$r || isset($this->s['consumed'][$n])) { continue; }
      $slug = ($prefix !== '' ? "$prefix/" : '') . $this->uniqueSegment($this->nodeSegment($r), $siblings, $n);
      $id = "item-$n";
      $this->s['items'][] = ['id' => $id, 'title' => $this->nodeTitle($r), 'slug' => $slug, 'parent' => $parent, 'order' => $order++, 'indent' => $indent, 'content' => $this->content($n), 'metadata' => $this->nodeMetadata($r, $this->s['base'], true)];
      $this->s['consumed'][$n] = true;
      $this->walk($this->s['children'][$n] ?? [], $id, $slug, $indent + 1);
    }
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Finds the site's JSON:API, reads its pages, book pages, files, media and menu links, and builds the outline from the
   * menu (or book fields, or creation order), with media embeds turned into HAX elements and files listed for core to
   * fetch.
   *
   * @param object $ctx    Platform context (spec/13); $ctx->fetch() reaches only the input url's host.
   * @param array  $input  [url] (any URL of the Drupal site).
   * @return array  [title, items, files] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    if (empty($input['url'])) { return ['error' => 'url is required']; }
    $url = trim((string) $input['url']);
    $found = $this->discover($ctx, $url);
    if (!$found) { return ['error' => 'no Drupal JSON:API found at this URL or its parents (expected <base>/jsonapi)']; }
    $base = $found['base']; $links = $found['links'];
    $href = function ($k) use ($links) { return (isset($links[$k]) && $this->isObj($links[$k]) && is_string($links[$k]['href'] ?? null) && $links[$k]['href'] !== '') ? $links[$k]['href'] : null; };
    if (!$href('node--page') && !$href('node--book')) {
      $exposed = array_values(array_filter(array_map('strval', array_keys($links)), function ($k) { return strpos($k, 'node--') === 0; }));
      return ['error' => 'Drupal JSON:API found, but it exposes neither node--page nor node--book' . ($exposed ? ' (found: ' . implode(', ', $exposed) . ')' : '')];
    }
    $pageRecords = $this->collection($ctx, $href('node--page'), 50, 200);
    $bookRecords = $this->collection($ctx, $href('node--book'), 50, 200);
    $records = [];
    foreach (array_merge($pageRecords, $bookRecords) as $r) { $n = $this->nid($r); if ($n > 0 && !isset($records[$n])) { $records[$n] = $r; } }
    if (!$records) { return ['error' => 'Drupal JSON:API found, but node--page and node--book have no readable records']; }
    $map = $this->fileMap($this->collection($ctx, $href('file--file'), 50, 400), $base);
    $media = [];
    foreach (array_keys($links) as $k) {
      $k = (string) $k;
      if (strpos($k, 'media--') !== 0 || !$href($k)) { continue; }
      foreach ($this->collection($ctx, $href($k), 50, 200) as $r) { if ($this->isObj($r) && $this->str($r['id'] ?? null) !== '') { $media[$r['id']] = $this->mediaFor($r, $map); } }
    }
    $menuLinks = $this->collection($ctx, $href('menu_link_content--menu_link_content'), 100, 200);
    $children = $this->forestFromMenuLinks($menuLinks, $records);
    if ($children === null) { $children = $this->forestFromBooks($bookRecords, $records); }
    if ($children === null) {
      $flat = array_values($records);
      usort($flat, function ($a, $b) { return strcmp($this->created($a), $this->created($b)) ?: ($this->nid($a) <=> $this->nid($b)); });
      $children = [0 => array_map([$this, 'nid'], $flat)];
    }
    $this->s = ['records' => $records, 'base' => $base, 'media' => $media, 'map' => $map, 'children' => $children, 'cache' => [], 'items' => [], 'consumed' => [], 'dropped' => []];
    $this->walk($this->expand($children[0] ?? []), null, '', 0);
    $items = $this->s['items'];
    $rest = array_values(array_filter($records, function ($r) { $n = $this->nid($r); return !isset($this->s['consumed'][$n]) && !isset($this->s['dropped'][$n]); }));
    usort($rest, function ($a, $b) { return strcmp($this->lower($this->nodeTitle($a)), $this->lower($this->nodeTitle($b))) ?: ($this->nid($a) <=> $this->nid($b)); });
    if ($rest) {
      $top = [];
      foreach ($items as $it) { if ($it['parent'] === null) { $top[$it['slug']] = true; } }
      $count = count($top);
      $group = ['id' => 'item-additional-pages', 'title' => 'additional pages', 'slug' => $this->uniqueSegment('additional-pages', $top, 'group'), 'parent' => null, 'order' => $count, 'indent' => 0, 'content' => '<p></p>', 'metadata' => ['hideInMenu' => true, 'sourceType' => 'drupal-additional-pages']];
      $items[] = $group;
      $siblings = [];
      foreach ($rest as $i => $r) {
        $n = $this->nid($r);
        $items[] = ['id' => "item-$n", 'title' => $this->nodeTitle($r), 'slug' => $group['slug'] . '/' . $this->uniqueSegment($this->nodeSegment($r), $siblings, $n), 'parent' => $group['id'], 'order' => $i, 'indent' => 1, 'content' => $this->content($n), 'metadata' => $this->nodeMetadata($r, $base, false)];
      }
    }
    $this->s = null;
    return ['title' => $this->siteName($url), 'items' => $items, 'files' => $map['files']];
  }
}

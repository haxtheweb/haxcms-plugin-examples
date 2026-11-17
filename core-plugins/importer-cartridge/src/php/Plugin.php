<?php
// Common Cartridge importer (PHP). Mirrors src/nodejs/index.js.
class ImporterCartridgePlugin {
  const KINDS = ['syllabus', 'page', 'assignment', 'discussion', 'announcement', 'quiz', 'link'];
  const GROUPS = [['assignment', 'Assignments'], ['discussion', 'Discussions'], ['announcement', 'Announcements'], ['quiz', 'Quizzes'], ['link', 'Links']];
  const MEDIA = '\\.(png|jpe?g|gif|webp|svg|pdf|mp3|m4a|mp4|webm|vtt|srt|docx?|pptx?|xlsx?|csv|txt)$';
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

  private static function decode($s) {
    return str_replace(['&lt;', '&gt;', '&quot;', '&#39;', '&apos;', '&nbsp;', '&amp;'], ['<', '>', '"', "'", "'", ' ', '&'], (string) ($s ?? ''));
  }
  private static function tag($xml, $name) {
    if (!preg_match('/<' . preg_quote($name, '/') . '(?:\s[^>]*)?>([\s\S]*?)<\/' . preg_quote($name, '/') . '>/', (string) ($xml ?? ''), $m)) { return ''; }
    return trim($m[1]);
  }
  private static function attr($attrs, $name) {
    return preg_match('/(?:^|\s)' . preg_quote($name, '/') . '="([^"]*)"/', $attrs, $m) ? self::decode($m[1]) : '';
  }
  private static function text($s) {
    return trim(preg_replace('/\s+/', ' ', self::decode(preg_replace('/<[^>]*>/', '', (string) ($s ?? '')))));
  }
  private static function body($html) {
    return trim(preg_match('/<body[^>]*>([\s\S]*)<\/body>/i', $html, $m) ? $m[1] : $html);
  }
  private static function slugify($s) {
    return substr(trim(preg_replace('/[^a-z0-9]+/', '-', strtolower((string) $s)), '-'), 0, 80);
  }
  // where a file of the cartridge lives in the new site: files/<path under web_resources>, each segment made safe
  private static function sitePath($p) {
    $parts = [];
    foreach (explode('/', preg_replace('/^web_resources\//', '', (string) $p)) as $x) {
      $x = preg_replace('/^\.+/', '', preg_replace('/[^A-Za-z0-9._-]+/', '-', $x));
      if ($x !== '') { $parts[] = $x; }
    }
    return 'files/' . implode('/', $parts);
  }
  // Canvas writes links to course files as $IMS-CC-FILEBASE$/<path>; they become the file's place in the new site
  private static function relink($html) {
    return preg_replace_callback('/(?:\$|%24)IMS-CC-FILEBASE(?:\$|%24)\/([^"\'<>\s?#]+)(?:\?[^"\'<>\s#]*)?/', function ($m) { return self::sitePath(rawurldecode($m[1])); }, $html);
  }
  private static function clean($html) {
    return trim(self::relink(self::cleanHtml(self::body((string) ($html ?? '')), ['script', 'style'], ['html', 'head', 'meta', 'title', 'body'], false)));
  }

  /** The manifest's resources, in file order: [id, type, href, files, deps]. */
  private static function readResources($manifest) {
    $out = [];
    preg_match_all('/<resource\b([^>]*?)(?:\/>|>([\s\S]*?)<\/resource>)/', $manifest, $mm, PREG_SET_ORDER);
    foreach ($mm as $m) {
      $inner = $m[2] ?? '';
      $files = [];
      preg_match_all('/<file\b([^>]*?)\/?>/', $inner, $ff);
      foreach ($ff[1] as $f) { $h = self::attr($f, 'href'); if ($h !== '') { $files[] = $h; } }
      $deps = [];
      preg_match_all('/<dependency\b([^>]*?)\/?>/', $inner, $dd);
      foreach ($dd[1] as $d) { $h = self::attr($d, 'identifierref'); if ($h !== '') { $deps[] = $h; } }
      $out[] = ['id' => self::attr($m[1], 'identifier'), 'type' => self::attr($m[1], 'type'), 'href' => self::attr($m[1], 'href'), 'files' => $files, 'deps' => $deps];
    }
    return $out;
  }

  /** The organization tree as a flat list in document order: [title, ref, depth]; the untitled root is left out. */
  private static function readOutline($manifest) {
    $org = self::tag($manifest, 'organizations');
    $out = [];
    $depth = 0;
    $open = -1;
    preg_match_all('/<item\b([^>]*?)(\/?)>|<\/item>|<title>([\s\S]*?)<\/title>/', $org, $mm, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);
    foreach ($mm as $m) {
      if ($m[0] === '</item>') { $depth--; $open = -1; continue; }
      if ($m[3] !== null) { if ($open >= 0) { $out[$open]['title'] = self::text($m[3]); $open = -1; } continue; }
      $out[] = ['title' => '', 'ref' => self::attr($m[1], 'identifierref'), 'depth' => $depth];
      if ($m[2] === '/') { continue; }
      $open = count($out) - 1;
      $depth++;
    }
    return array_values(array_filter($out, function ($n) { return $n['title'] !== ''; }));
  }

  /** One entry per importable resource: [id, kind, title, content, published, position, seq]. */
  private static function classify($resources, $texts) {
    $byId = [];
    foreach ($resources as $r) { $byId[$r['id']] = $r; }
    $entries = [];
    $skipped = ['lti' => 0];
    foreach ($resources as $seq => $r) {
      $main = $r['href'] !== '' ? $r['href'] : ($r['files'][0] ?? '');
      $e = ['id' => $r['id'], 'kind' => '', 'title' => '', 'content' => '', 'published' => true, 'position' => 0, 'seq' => $seq];
      if (strpos($r['type'], 'imsdt_') === 0) {
        $topic = $texts[$main] ?? '';
        $e['kind'] = 'discussion';
        $e['title'] = self::text(self::tag($topic, 'title'));
        $e['content'] = self::clean(self::decode(self::tag($topic, 'text')));
        foreach ($r['deps'] as $d) {
          $dep = $byId[$d] ?? null;
          $meta = $texts[$dep ? ($dep['href'] !== '' ? $dep['href'] : ($dep['files'][0] ?? '')) : ''] ?? '';
          if (strpos($meta, '<topicMeta') === false) { continue; }
          if (self::tag($meta, 'type') === 'announcement') { $e['kind'] = 'announcement'; }
          $e['position'] = (int) self::tag($meta, 'position');
          $state = self::tag($meta, 'workflow_state');
          if ($state !== '' && $state !== 'active') { $e['published'] = false; }
        }
      } elseif (strpos($r['type'], 'imsqti_') === 0) {
        $qti = $texts[$main] ?? '';
        $e['kind'] = 'quiz';
        $e['title'] = preg_match('/<assessment\b([^>]*)>/', $qti, $m) ? self::attr($m[1], 'title') : '';
        $e['content'] = '<p>This quiz has ' . preg_match_all('/<item\b/', $qti) . ' questions that were not converted. Rebuild it with question elements.</p>';
      } elseif (strpos($r['type'], 'imswl_') === 0) {
        $wl = $texts[$main] ?? '';
        $url = preg_match('/<url\b([^>]*)>/', $wl, $m) ? self::attr($m[1], 'href') : '';
        if (!preg_match('/^https?:\/\//', $url)) { continue; }
        $e['kind'] = 'link';
        $title = self::text(self::tag($wl, 'title'));
        $e['title'] = $title !== '' ? $title : $url;
        $e['content'] = '<p><a href="' . str_replace(['&', '"', '<'], ['&amp;', '&quot;', '&lt;'], $url) . '">' . str_replace(['&', '<'], ['&amp;', '&lt;'], $e['title']) . '</a></p>';
      } elseif (strpos($r['type'], 'imsbasiclti_') === 0) {
        $skipped['lti']++;
        continue;
      } else {
        $settings = null;
        $page = preg_match('/\.html?$/i', $main) ? $main : null;
        $isSettings = false;
        foreach ($r['files'] as $f) {
          if (strpos($f, 'course_settings/') === 0) { $isSettings = true; }
          if ($settings === null && substr($f, -24) === '/assignment_settings.xml') { $settings = $f; }
          if ($page === null && preg_match('/\.html?$/i', $f)) { $page = $f; }
        }
        if ($isSettings) { continue; } // Canvas course settings; the syllabus is read on its own
        if ($page === null) { continue; } // a media file, a Canvas meta file, or a dependency of another resource
        $html = $texts[$page] ?? '';
        $e['kind'] = $settings !== null ? 'assignment' : 'page';
        $title = $settings !== null ? self::text(self::tag($texts[$settings] ?? '', 'title')) : '';
        if ($title === '') { $title = preg_replace('/^Assignment: /', '', self::text(self::tag($html, 'title'))); }
        if ($title === '') { $parts = explode('/', $page); $title = preg_replace('/\.html?$/i', '', end($parts)); }
        $e['title'] = $title;
        $e['content'] = self::clean($html);
        if ($settings !== null) {
          $e['position'] = (int) self::tag($texts[$settings] ?? '', 'position');
          $state = self::tag($texts[$settings] ?? '', 'workflow_state');
          if ($state !== '' && $state !== 'published') { $e['published'] = false; }
        } elseif (preg_match('/<meta name="workflow_state" content="unpublished"/', $html)) { $e['published'] = false; }
      }
      if ($e['title'] === '') { $e['title'] = 'Untitled'; }
      $entries[] = $e;
    }
    return [$entries, $skipped];
  }

  /**
   * Turns the text entries of a cartridge into the import.platform result.
   *
   * @param array  $texts    [path => text] for the manifest and every .xml and .html entry.
   * @param array  $media    [path => base64] for the media entries.
   * @param string $name     The uploaded file's name.
   * @param array  $include  The kinds to bring over; empty means all.
   * @return array  [title, items, files?, site, stats] or [error].
   */
  private function convert($texts, $media, $name, $include) {
    $manifest = $texts['imsmanifest.xml'] ?? '';
    if ($manifest === '' || strpos($manifest, '<manifest') === false) { return ['error' => 'the file is not a Common Cartridge (no imsmanifest.xml)']; }
    $want = function ($k) use ($include) { return count($include) === 0 || in_array($k, $include, true); };
    $canvas = false;
    foreach (array_keys($texts) as $k) { if (strpos((string) $k, 'course_settings/') === 0) { $canvas = true; break; } }
    $resources = self::readResources($manifest);
    [$entries, $skipped] = self::classify($resources, $texts);
    $byId = [];
    foreach ($entries as $e) { $byId[$e['id']] = $e; }
    $items = [];
    $slugs = [];
    $counts = [];
    foreach (self::KINDS as $k) { $counts[$k] = 0; }
    $add = function ($title, $content, $parent, $published, $kind) use (&$items, &$slugs, &$counts) {
      $slug = self::slugify($title);
      if ($slug === '') { $slug = 'page'; }
      if (isset($slugs[$slug])) { $n = 2; while (isset($slugs["$slug-$n"])) { $n++; } $slug = "$slug-$n"; }
      $slugs[$slug] = true;
      $item = ['id' => 'item-' . (count($items) + 1), 'title' => $title, 'slug' => $slug, 'parent' => $parent, 'order' => count($items), 'content' => $content];
      if (!$published) { $item['metadata'] = ['published' => false]; }
      $items[] = $item;
      if ($kind !== '') { $counts[$kind]++; }
      return $item['id'];
    };
    $syllabus = self::clean($texts['course_settings/syllabus.html'] ?? '');
    if ($syllabus !== '' && $want('syllabus')) { $add('Syllabus', $syllabus, null, true, 'syllabus'); }
    // the outline first: modules become parent pages, their items the pages under them
    $used = [];
    $parents = [];
    foreach (self::readOutline($manifest) as $n) {
      $parent = $n['depth'] > 1 ? ($parents[$n['depth'] - 1] ?? null) : null;
      if ($n['ref'] === '') { $parents[$n['depth']] = $add($n['title'], '', $parent, true, ''); continue; }
      $e = $byId[$n['ref']] ?? null;
      if (!$e || isset($used[$e['id']]) || !$want($e['kind'])) { continue; }
      $used[$e['id']] = true;
      $parents[$n['depth']] = $add($n['title'] !== '' ? $n['title'] : $e['title'], $e['content'], $parent, $e['published'], $e['kind']);
    }
    // then whatever no module holds: pages at the top, the rest under one parent page per kind, in the course's order
    $rest = array_values(array_filter($entries, function ($e) use ($used, $want) { return !isset($used[$e['id']]) && $want($e['kind']); }));
    usort($rest, function ($a, $b) { return ($a['position'] <=> $b['position']) ?: ($a['seq'] <=> $b['seq']); });
    foreach ($rest as $e) { if ($e['kind'] === 'page') { $add($e['title'], $e['content'], null, $e['published'], $e['kind']); } }
    foreach (self::GROUPS as $g) {
      $group = array_values(array_filter($rest, function ($e) use ($g) { return $e['kind'] === $g[0]; }));
      if (!$group) { continue; }
      $parent = $add($g[1], '', null, true, '');
      foreach ($group as $e) { $add($e['title'], $e['content'], $parent, $e['published'], $e['kind']); }
    }
    $paths = array_values(array_filter(array_map('strval', array_keys($media)), function ($p) { return strpos($p, 'course_settings/') !== 0; }));
    sort($paths, SORT_STRING);
    $files = [];
    foreach ($paths as $p) { $files[] = ['path' => self::sitePath($p), 'data' => $media[$p]]; }
    $lom = self::tag($manifest, 'lomimscc:title');
    $course = self::text($lom !== '' ? self::tag($lom, 'lomimscc:string') : self::tag(self::tag($manifest, 'lom:title'), 'lom:string'));
    $title = trim(preg_replace('/\.(imscc|zip)$/i', '', (string) $name));
    if ($title === '') { $title = $course !== '' ? $course : 'Imported course'; }
    $out = ['title' => $title, 'items' => $items];
    if ($files) { $out['files'] = $files; }
    if ($course !== '') { $out['site'] = ['description' => $course]; }
    $out['stats'] = ['flavor' => $canvas ? 'canvas' : 'ims', 'version' => self::tag($manifest, 'schemaversion'), 'kinds' => $counts, 'files' => count($files), 'skipped' => $skipped];
    return $out;
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Turns a Common Cartridge (.imscc) into pages: the syllabus, the module outline, then pages, assignments, discussions, announcements, quizzes and links that no module holds, grouped by kind. Media goes to files for core to write.
   *
   * @param object $ctx    Platform context (spec/13); archive->read unpacks the cartridge.
   * @param array  $input  [files => [[name, data (base64)]], include? => [kinds]] with one .imscc.
   * @return array  [title, items, files?, site?, stats] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    $f = (is_array($input['files'] ?? null) && count($input['files'])) ? ($input['files'][0] ?? []) : null;
    if ($f === null) { return ['error' => 'a Common Cartridge (.imscc) file is required']; }
    try {
      $texts = $ctx->archive->read((string) ($f['data'] ?? ''), ['match' => '(^imsmanifest\\.xml|\\.xml|\\.html?)$']);
      $media = $ctx->archive->read((string) ($f['data'] ?? ''), ['match' => self::MEDIA, 'binary' => true]);
    } catch (\Throwable $e) { return ['error' => 'the file is not a zip archive']; }
    $include = is_array($input['include'] ?? null) ? array_values(array_filter($input['include'], function ($k) { return in_array($k, self::KINDS, true); })) : [];
    return $this->convert($texts, $media, (string) ($f['name'] ?? ''), $include);
  }
}

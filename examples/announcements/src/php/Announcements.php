<?php
// Announcements logic (PHP). Mirrors src/nodejs/announcements.js function for function; tests/ run the same cases
// against both. Pure functions: no I/O.
class Announcements {
  const SOURCE_ONLY = ['status', 'notes', 'sourcePRs'];

  // Compare dotted numeric versions (26.10.1). Missing parts count as 0; a non-numeric part sorts as newest.
  public static function compareVersions($a, $b) {
    $pa = explode('.', (string) $a);
    $pb = explode('.', (string) $b);
    $n = max(count($pa), count($pb));
    for ($i = 0; $i < $n; $i++) {
      $xa = $pa[$i] ?? '0';
      $ya = $pb[$i] ?? '0';
      $xn = is_numeric($xa);
      $yn = is_numeric($ya);
      if (!$xn || !$yn) { return (!$xn && !$yn) ? 0 : (!$xn ? 1 : -1); }
      $x = $xa + 0;
      $y = $ya + 0;
      if ($x != $y) { return $x < $y ? -1 : 1; }
    }
    return 0;
  }

  // FNV-1a 32-bit over the UTF-8 bytes, identical to the Node version.
  public static function fnv1a($str) {
    $h = 0x811c9dc5;
    $len = strlen($str);
    for ($i = 0; $i < $len; $i++) {
      $h ^= ord($str[$i]);
      $h = ($h * 0x01000193) & 0xffffffff;
    }
    return $h;
  }

  public static function servable($entries, $running) {
    return array_values(array_filter($entries, function ($e) use ($running) {
      return ($e['status'] ?? '') === 'ready' && (($e['kind'] ?? '') !== 'update' || self::compareVersions($e['version'], $running) <= 0);
    }));
  }

  public static function present($entry, $overlay = []) {
    $out = [];
    foreach ($entry as $k => $v) { if (!in_array($k, self::SOURCE_ONLY, true)) { $out[$k] = $v; } }
    $t = $overlay[$entry['uuid']] ?? null;
    if ($t) {
      if (!empty($t['label'])) { $out['label'] = $t['label']; }
      if (!empty($t['description'])) { $out['description'] = $t['description']; }
      if (!empty($t['alt']) && isset($out['visual'])) { $out['visual']['alt'] = $t['alt']; }
    }
    if (isset($out['visual']) && ($out['visual']['mode'] ?? '') === 'screenshot') {
      unset($out['visual']['file']);
      $out['visual']['url'] = $entry['uuid'] . '/visual';
    }
    return $out;
  }

  public static function latestVersion($entries, $running) {
    $best = null;
    foreach (self::servable($entries, $running) as $e) {
      if ($e['kind'] === 'update' && ($best === null || self::compareVersions($e['version'], $best) > 0)) { $best = $e['version']; }
    }
    return $best;
  }

  private static function typeUuid($types, $value) {
    foreach ($types as $t) { if ($t['key'] === $value || $t['uuid'] === $value) { return $t['uuid']; } }
    return $value;
  }

  private static function sortEntries($list) {
    // stable sort: updates newest first, then tips in source order
    $indexed = [];
    foreach ($list as $i => $e) { $indexed[] = [$i, $e]; }
    usort($indexed, function ($a, $b) {
      [$ia, $ea] = $a; [$ib, $eb] = $b;
      if ($ea['kind'] !== $eb['kind']) { return $ea['kind'] === 'update' ? -1 : 1; }
      if ($ea['kind'] === 'update') { $c = self::compareVersions($eb['version'], $ea['version']); if ($c !== 0) { return $c; } }
      return $ia <=> $ib;
    });
    return array_map(function ($x) { return $x[1]; }, $indexed);
  }

  public static function typesMap($types, $overlay = []) {
    usort($types, function ($a, $b) { return $a['order'] <=> $b['order']; });
    $out = [];
    foreach ($types as $t) { $out[$t['uuid']] = self::present($t, $overlay); }
    return $out;
  }

  public static function listEntries($data, $running, $query = [], $overlay = []) {
    $items = self::servable($data['entries'], $running);
    if (!empty($query['filter[kind]'])) { $k = $query['filter[kind]']; $items = array_values(array_filter($items, function ($e) use ($k) { return $e['kind'] === $k; })); }
    if (!empty($query['filter[type]'])) { $t = self::typeUuid($data['types'], $query['filter[type]']); $items = array_values(array_filter($items, function ($e) use ($t) { return $e['type'] === $t; })); }
    if (!empty($query['filter[sinceVersion]'])) { $s = $query['filter[sinceVersion]']; $items = array_values(array_filter($items, function ($e) use ($s) { return $e['kind'] === 'update' && self::compareVersions($e['version'], $s) > 0; })); }
    $items = self::sortEntries($items);
    $total = count($items);
    $offset = max(0, (int) ($query['page.offset'] ?? 0));
    $limit = max(1, min(100, (int) ($query['page.limit'] ?? 50) ?: 50));
    return [
      'latestVersion' => self::latestVersion($data['entries'], $running),
      'total' => $total,
      'items' => array_map(function ($e) use ($overlay) { return self::present($e, $overlay); }, array_slice($items, $offset, $limit)),
      'types' => self::typesMap($data['types'], $overlay),
    ];
  }

  public static function latest($data, $running, $overlay = []) {
    $v = self::latestVersion($data['entries'], $running);
    $items = $v === null ? [] : array_values(array_filter(self::servable($data['entries'], $running), function ($e) use ($v) { return $e['kind'] === 'update' && self::compareVersions($e['version'], $v) === 0; }));
    return ['latestVersion' => $v, 'items' => array_map(function ($e) use ($overlay) { return self::present($e, $overlay); }, $items), 'types' => self::typesMap($data['types'], $overlay)];
  }

  // $date is a DateTimeInterface; the day is taken in UTC.
  public static function dailyTip($data, $running, $date, $exclude = [], $seed = '', $overlay = []) {
    $tips = array_values(array_filter(self::servable($data['entries'], $running), function ($e) use ($exclude) { return $e['kind'] === 'tip' && !in_array($e['uuid'], $exclude, true); }));
    if (!$tips) { return null; }
    $day = (new DateTime('@' . $date->getTimestamp()))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d');
    return self::present($tips[self::fnv1a($day . ':' . $seed) % count($tips)], $overlay);
  }

  public static function getEntry($data, $running, $uuid, $overlay = []) {
    foreach (self::servable($data['entries'], $running) as $e) { if ($e['uuid'] === $uuid) { return self::present($e, $overlay); } }
    return null;
  }

  public static function visualFile($data, $running, $uuid) {
    foreach (self::servable($data['entries'], $running) as $e) {
      if ($e['uuid'] === $uuid && ($e['visual']['mode'] ?? '') === 'screenshot') { return $e['visual']['file']; }
    }
    return null;
  }
}

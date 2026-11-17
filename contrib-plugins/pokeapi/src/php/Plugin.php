<?php
// PokeAPI (PHP). Mirrors src/nodejs/index.js and the search half of frontend/dist/pokeapi-data.js; both runtimes
// return identical results for the plugin's cases.
class PokeapiPlugin {
  const PUBLIC_HOST = 'pokeapi.co';
  const DEFAULT_BASE = 'https://pokeapi.co/api/v2';
  const LIST_QUERY = 'pokemon?limit=100000&offset=0';
  const ARTWORK_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/';
  const PER_PAGE = 20;

  // ---- ports of frontend/dist/pokeapi-data.js (search only; cards are shaped in the browser) ----

  public static function idFromUrl($url) {
    return preg_match('/\/(\d+)\/?$/', is_scalar($url) ? (string) $url : '', $m) ? (int) $m[1] : 0;
  }

  public static function titleCase($name) {
    $words = array_values(array_filter(explode('-', is_scalar($name) ? (string) $name : ''), function ($w) { return $w !== ''; }));
    return implode(' ', array_map(function ($w) { return strtoupper(substr($w, 0, 1)) . substr($w, 1); }, $words));
  }

  public static function artworkUrl($id) {
    return $id > 0 ? self::ARTWORK_BASE . $id . '.png' : '';
  }

  public static function normalizeQuery($q) {
    return preg_replace('/\s+/', '-', strtolower(trim(is_scalar($q) ? (string) $q : '')));
  }

  public static function toPage($value) {
    $n = preg_match('/^\s*(\d+)\s*$/', is_scalar($value) ? (string) $value : '', $m) ? (int) $m[1] : 1;
    return $n >= 1 ? $n : 1;
  }

  public static function searchIndex($list, $query, $page) {
    $results = is_array($list) && isset($list['results']) && is_array($list['results']) ? $list['results'] : [];
    $q = self::normalizeQuery($query);
    $all = [];
    foreach ($results as $r) {
      $name = is_array($r) && isset($r['name']) ? (string) $r['name'] : '';
      $id = self::idFromUrl(is_array($r) ? ($r['url'] ?? '') : '');
      if ($name === '' || $id === 0) { continue; }
      $all[] = ['id' => $id, 'name' => $name];
    }
    if ($q === '') { $hits = $all; }
    elseif (preg_match('/^\d+$/', $q)) { $hits = array_values(array_filter($all, function ($r) use ($q) { return $r['id'] === (int) $q; })); }
    else {
      $starts = array_values(array_filter($all, function ($r) use ($q) { return strpos($r['name'], $q) === 0; }));
      $inside = array_values(array_filter($all, function ($r) use ($q) { $at = strpos($r['name'], $q); return $at !== false && $at > 0; }));
      $hits = array_merge($starts, $inside);
    }
    $total = count($hits);
    $totalPages = $total === 0 ? 0 : (int) ceil($total / self::PER_PAGE);
    $p = self::toPage($page);
    $items = array_map(function ($r) {
      return ['id' => $r['id'], 'name' => $r['name'], 'title' => self::titleCase($r['name']), 'details' => '#' . $r['id'], 'image' => self::artworkUrl($r['id'])];
    }, array_slice($hits, ($p - 1) * self::PER_PAGE, self::PER_PAGE));
    return ['items' => $items, 'page' => $p, 'total_pages' => $totalPages, 'total' => $total];
  }

  // ---- plugin ----

  private static function hostOf($url) {
    $h = parse_url((string) $url, PHP_URL_HOST);
    return is_string($h) ? strtolower($h) : '';
  }

  private function baseOf($ctx) {
    $b = isset($ctx->settings['apiBase']) && $ctx->settings['apiBase'] !== '' ? (string) $ctx->settings['apiBase'] : self::DEFAULT_BASE;
    return rtrim(trim($b), '/');
  }

  /** The mirror key header, only for a mirror: the public API takes no key, so sending one there would only leak it. */
  private function headersFor($ctx, $base) {
    $key = isset($ctx->settings['apiKey']) ? (string) $ctx->settings['apiKey'] : '';
    if ($key === '' || self::hostOf($base) === self::PUBLIC_HOST) { return []; }
    $name = isset($ctx->settings['apiKeyHeader']) && $ctx->settings['apiKeyHeader'] !== '' ? (string) $ctx->settings['apiKeyHeader'] : 'x-api-key';
    return [strtolower(trim($name)) => $key];
  }

  private function loadIndex($ctx) {
    $base = $this->baseOf($ctx);
    $stored = $ctx->storage->read('index');
    $usable = is_array($stored) && ($stored['base'] ?? null) === $base && isset($stored['results']) && is_array($stored['results']);
    $maxAge = max(0, (float) ($ctx->settings['cacheHours'] ?? 0)) * 3600000;
    if ($usable && $ctx->now() - (float) ($stored['fetchedAt'] ?? 0) < $maxAge) { return $stored; }
    try {
      $res = $ctx->fetch($base . '/' . self::LIST_QUERY, ['headers' => (object) $this->headersFor($ctx, $base)]);
      if ($res['status'] >= 400) { throw new Exception('answered ' . $res['status']); }
      $data = $res['json'];
      if (!is_array($data) || !isset($data['results']) || !is_array($data['results'])) { throw new Exception('answered without a results list'); }
      $record = ['base' => $base, 'fetchedAt' => $ctx->now(), 'results' => array_map(function ($r) {
        return ['name' => is_array($r) && isset($r['name']) ? (string) $r['name'] : '', 'url' => is_array($r) && isset($r['url']) ? (string) $r['url'] : ''];
      }, array_values($data['results']))];
      $ctx->storage->write('index', $record);
      return $record;
    } catch (Exception $e) {
      if ($usable) {
        $ctx->log->warn('PokeAPI list refresh failed (' . $e->getMessage() . '); searching the stored list');
        return $stored;
      }
      $ctx->log->warn('PokeAPI list could not be loaded: ' . $e->getMessage());
      return null;
    }
  }

  /**
   * Implements operation pokeapiSearch.
   *
   * Answers the appstore's browse: one page of Pokémon whose name contains the query (or whose number is the query),
   * with artwork previews, from the stored PokeAPI list. Refreshes the list when it is older than cacheHours or the
   * PokeAPI address changed.
   *
   * @param object $ctx
   * @param array $req  query: { query, page }.
   * @return array  { items, page, total_pages, total }, or 502 when PokeAPI is unreachable and nothing is stored.
   */
  public function pokeapiSearch($ctx, $req) {
    $q = isset($req['query']) && is_array($req['query']) ? $req['query'] : [];
    $index = $this->loadIndex($ctx);
    if ($index === null) { return ['status' => 502, 'body' => ['error' => 'PokeAPI could not be reached']]; }
    return self::searchIndex($index, $q['query'] ?? null, $q['page'] ?? null);
  }

  /**
   * Implements hook config.before.save.
   *
   * Refuses an address that is not a web address, and a mirror key that would go to the public API (which needs none)
   * or over plain http.
   *
   * @param object $ctx  subject: { plugin, scope, values }.
   * @return mixed  the subject unchanged, or a veto (422).
   */
  public function configBeforeSave($ctx) {
    $v = is_array($ctx->subject) && isset($ctx->subject['values']) && is_array($ctx->subject['values']) ? $ctx->subject['values'] : [];
    $base = trim(isset($v['apiBase']) && is_scalar($v['apiBase']) ? (string) $v['apiBase'] : '');
    $scheme = strtolower((string) parse_url($base, PHP_URL_SCHEME));
    $host = self::hostOf($base);
    if ($host === '' || ($scheme !== 'https' && $scheme !== 'http')) { return $ctx->veto('The PokeAPI address must be a web address, such as https://pokeapi.co/api/v2', 422); }
    if ((isset($v['apiKey']) ? (string) $v['apiKey'] : '') === '') { return $ctx->subject; }
    if ($host === self::PUBLIC_HOST) { return $ctx->veto('PokeAPI itself needs no key. A key is only for your own mirror: set the mirror\'s address first.', 422); }
    if ($scheme !== 'https') { return $ctx->veto('A mirror key may only be sent over https', 422); }
    return $ctx->subject;
  }
}

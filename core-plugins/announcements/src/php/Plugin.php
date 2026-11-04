<?php
// Announcements plugin (PHP entry). Mirrors src/nodejs/index.js: one public method per operationId and per hook.
// $ctx is provided by the loader (spec/06): $ctx->storage->read($storeId), $ctx->package->read($path),
// $ctx->haxcms->version, $ctx->log. Security is enforced by the platform from the OpenAPI contract first.
require_once __DIR__ . '/Announcements.php';

class AnnouncementsPlugin {
  private $cache = null; // read-only package data, loaded once per process

  private function data($ctx) {
    if ($this->cache === null) {
      $this->cache = ['entries' => $ctx->storage->read('announcements'), 'types' => $ctx->storage->read('types')];
    }
    return $this->cache;
  }

  private function overlay($ctx, $lang) {
    if (!$lang || $lang === 'en' || !preg_match('/^[a-z]{2}(-[A-Z]{2})?$/', $lang)) { return []; }
    try {
      $json = json_decode($ctx->package->read("data/locales/$lang.json"), true);
      return is_array($json) ? $json : [];
    } catch (Exception $e) {
      return [];
    }
  }

  private function ok($body) { return ['status' => 200, 'body' => $body]; }
  private function notFound() { return ['status' => 404, 'body' => ['error' => 'not found']]; }

  /**
   * Implements operation announcementsListLatest.
   *
   * Returns the update entries of the newest version the running HAXcms serves, with latestVersion and the types
   * map, translated when a locale overlay exists.
   *
   * @param object $ctx  Platform context (spec/13); haxcms->version limits what is served.
   * @param array  $req  query.lang picks a locale overlay (English when missing).
   * @return array  [status => 200, body] with the latest entries.
   */
  public function announcementsListLatest($ctx, $req) {
    return $this->ok(Announcements::latest($this->data($ctx), $ctx->haxcms->version, $this->overlay($ctx, $req['query']['lang'] ?? null)));
  }
  /**
   * Implements operation announcementsListAll.
   *
   * Returns every served entry (no drafts, nothing newer than the running version), filtered and paged by the query;
   * the CLI uses filter[sinceVersion].
   *
   * @param object $ctx  Platform context (spec/13); haxcms->version limits what is served.
   * @param array  $req  query: filter[...], page.limit, page.offset and lang.
   * @return array  [status => 200, body] with the matching entries.
   */
  public function announcementsListAll($ctx, $req) {
    return $this->ok(Announcements::listEntries($this->data($ctx), $ctx->haxcms->version, $req['query'], $this->overlay($ctx, $req['query']['lang'] ?? null)));
  }
  /**
   * Implements operation announcementsListTips.
   *
   * Returns tips only: the same listing as announcementsListAll with filter[kind] fixed to tip.
   *
   * @param object $ctx  Platform context (spec/13); haxcms->version limits what is served.
   * @param array  $req  query: filter[...], page.limit, page.offset and lang.
   * @return array  [status => 200, body] with the matching tips.
   */
  public function announcementsListTips($ctx, $req) {
    return $this->ok(Announcements::listEntries($this->data($ctx), $ctx->haxcms->version, array_merge($req['query'], ['filter[kind]' => 'tip']), $this->overlay($ctx, $req['query']['lang'] ?? null)));
  }
  /**
   * Implements operation announcementsGetDailyTip.
   *
   * Returns the tip of the day, the same for every caller on a UTC date, skipping the uuids in exclude.
   *
   * @param object $ctx  Platform context (spec/13); haxcms->version limits what is served.
   * @param array  $req  query: exclude (comma-separated uuids), seed and lang.
   * @return array  [status => 200, body => tip], or 404 when no tip is left.
   */
  public function announcementsGetDailyTip($ctx, $req) {
    $exclude = !empty($req['query']['exclude']) ? explode(',', $req['query']['exclude']) : [];
    $tip = Announcements::dailyTip($this->data($ctx), $ctx->haxcms->version, (new DateTime('@' . intdiv($ctx->now(), 1000)))->setTimezone(new DateTimeZone('UTC')), $exclude, $req['query']['seed'] ?? '', $this->overlay($ctx, $req['query']['lang'] ?? null));
    return $tip ? $this->ok($tip) : $this->notFound();
  }
  /**
   * Implements operation announcementsGet.
   *
   * Returns one entry of either kind by uuid; drafts and entries for unreleased versions are 404.
   *
   * @param object $ctx  Platform context (spec/13); haxcms->version limits what is served.
   * @param array  $req  params.uuid; query.lang.
   * @return array  [status => 200, body => entry] or 404.
   */
  public function announcementsGet($ctx, $req) {
    $e = Announcements::getEntry($this->data($ctx), $ctx->haxcms->version, $req['params']['uuid'], $this->overlay($ctx, $req['query']['lang'] ?? null));
    return $e ? $this->ok($e) : $this->notFound();
  }
  /**
   * Implements operation announcementsGetVisual.
   *
   * Returns the image bytes of an entry's screenshot visual from data/visuals, cached privately for an hour.
   * Only plain file names are served.
   *
   * @param object $ctx  Platform context (spec/13); haxcms->version limits what is served.
   * @param array  $req  params.uuid.
   * @return array  [status => 200, headers, body => bytes] or 404.
   */
  public function announcementsGetVisual($ctx, $req) {
    $file = Announcements::visualFile($this->data($ctx), $ctx->haxcms->version, $req['params']['uuid']);
    if (!$file || !preg_match('/^[A-Za-z0-9._-]+$/', $file)) { return $this->notFound(); }
    $type = str_ends_with($file, '.svg') ? 'image/svg+xml' : (str_ends_with($file, '.png') ? 'image/png' : 'image/jpeg');
    return ['status' => 200, 'headers' => ['content-type' => $type, 'cache-control' => 'private, max-age=3600'], 'body' => $ctx->package->read("data/visuals/$file")];
  }
  /**
   * Implements operation announcementsListTypes.
   *
   * Returns the six announcement types, translated when a locale overlay exists.
   *
   * @param object $ctx  Platform context (spec/13); haxcms->version limits what is served.
   * @param array  $req  query.lang.
   * @return array  [status => 200, body => [items]].
   */
  public function announcementsListTypes($ctx, $req) {
    return $this->ok(['items' => array_values(Announcements::typesMap($this->data($ctx)['types'], $this->overlay($ctx, $req['query']['lang'] ?? null)))]);
  }
  /**
   * Implements operation announcementsGetType.
   *
   * Returns one announcement type by uuid.
   *
   * @param object $ctx  Platform context (spec/13); haxcms->version limits what is served.
   * @param array  $req  params.uuid; query.lang.
   * @return array  [status => 200, body => type] or 404.
   */
  public function announcementsGetType($ctx, $req) {
    $map = Announcements::typesMap($this->data($ctx)['types'], $this->overlay($ctx, $req['query']['lang'] ?? null));
    return isset($map[$req['params']['uuid']]) ? $this->ok($map[$req['params']['uuid']]) : $this->notFound();
  }

  /**
   * Implements hook plugin.before.enable.
   *
   * Refuses to enable when an entry points at a type that does not exist, so a bad release never shows a half-empty
   * dialog. It drops the cache first so the check reads the shipped data.
   *
   * @param object $ctx  subject: [id, version, scope, siteId] of this plugin.
   * @return null  nothing, or a veto naming the broken entry.
   */
  public function pluginBeforeEnable($ctx) {
    $this->cache = null;
    $d = $this->data($ctx);
    $ids = array_column($d['types'], 'uuid');
    foreach ($d['entries'] as $e) {
      if (!in_array($e['type'], $ids, true)) { return $ctx->veto("announcement {$e['slug']} points at an unknown type"); }
    }
  }

  /**
   * Implements hook plugin.after.upgrade.
   *
   * Drops the cached data so entries shipped with the new version are read on the next request, and logs the upgrade.
   *
   * @param object $ctx  subject: [id, version, scope, siteId] of this plugin; previous: the version upgraded from.
   * @return null
   */
  public function pluginAfterUpgrade($ctx) {
    $this->cache = null;
    $ctx->log->info("announcements upgraded from {$ctx->previous} to {$ctx->subject['version']}");
  }
}

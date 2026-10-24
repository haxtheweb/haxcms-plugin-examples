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

  public function announcementsListLatest($ctx, $req) {
    return $this->ok(Announcements::latest($this->data($ctx), $ctx->haxcms->version, $this->overlay($ctx, $req['query']['lang'] ?? null)));
  }
  public function announcementsListAll($ctx, $req) {
    return $this->ok(Announcements::listEntries($this->data($ctx), $ctx->haxcms->version, $req['query'], $this->overlay($ctx, $req['query']['lang'] ?? null)));
  }
  public function announcementsListTips($ctx, $req) {
    return $this->ok(Announcements::listEntries($this->data($ctx), $ctx->haxcms->version, array_merge($req['query'], ['filter[kind]' => 'tip']), $this->overlay($ctx, $req['query']['lang'] ?? null)));
  }
  public function announcementsGetDailyTip($ctx, $req) {
    $exclude = !empty($req['query']['exclude']) ? explode(',', $req['query']['exclude']) : [];
    $tip = Announcements::dailyTip($this->data($ctx), $ctx->haxcms->version, (new DateTime('@' . intdiv($ctx->now(), 1000)))->setTimezone(new DateTimeZone('UTC')), $exclude, $req['query']['seed'] ?? '', $this->overlay($ctx, $req['query']['lang'] ?? null));
    return $tip ? $this->ok($tip) : $this->notFound();
  }
  public function announcementsGet($ctx, $req) {
    $e = Announcements::getEntry($this->data($ctx), $ctx->haxcms->version, $req['params']['uuid'], $this->overlay($ctx, $req['query']['lang'] ?? null));
    return $e ? $this->ok($e) : $this->notFound();
  }
  public function announcementsGetVisual($ctx, $req) {
    $file = Announcements::visualFile($this->data($ctx), $ctx->haxcms->version, $req['params']['uuid']);
    if (!$file || !preg_match('/^[A-Za-z0-9._-]+$/', $file)) { return $this->notFound(); }
    $type = str_ends_with($file, '.svg') ? 'image/svg+xml' : (str_ends_with($file, '.png') ? 'image/png' : 'image/jpeg');
    return ['status' => 200, 'headers' => ['content-type' => $type, 'cache-control' => 'private, max-age=3600'], 'body' => $ctx->package->read("data/visuals/$file")];
  }
  public function announcementsListTypes($ctx, $req) {
    return $this->ok(['items' => array_values(Announcements::typesMap($this->data($ctx)['types'], $this->overlay($ctx, $req['query']['lang'] ?? null)))]);
  }
  public function announcementsGetType($ctx, $req) {
    $map = Announcements::typesMap($this->data($ctx)['types'], $this->overlay($ctx, $req['query']['lang'] ?? null));
    return isset($map[$req['params']['uuid']]) ? $this->ok($map[$req['params']['uuid']]) : $this->notFound();
  }

  // hook: plugin.before.enable
  public function pluginBeforeEnable($ctx) {
    $this->cache = null;
    $d = $this->data($ctx);
    $ids = array_column($d['types'], 'uuid');
    foreach ($d['entries'] as $e) {
      if (!in_array($e['type'], $ids, true)) { return $ctx->veto("announcement {$e['slug']} points at an unknown type"); }
    }
  }

  // hook: plugin.after.upgrade
  public function pluginAfterUpgrade($ctx) {
    $this->cache = null;
    $ctx->log->info("announcements upgraded from {$ctx->previous} to {$ctx->subject['version']}");
  }
}

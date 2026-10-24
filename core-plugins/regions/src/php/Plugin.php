<?php
// Regions (PHP). Mirrors src/nodejs/index.js.
class RegionsPlugin {
  const REGIONS = ['header', 'sidebarFirst', 'sidebarSecond', 'contentTop', 'contentBottom', 'footerPrimary', 'footerSecondary'];

  private function ids($v) {
    $out = [];
    foreach ((array) ($v ?? []) as $e) { $id = is_array($e) ? ($e['node'] ?? null) : $e; if (is_string($id) && $id !== '') { $out[] = $id; } }
    return $out;
  }
  private function toMap($values) {
    $map = [];
    foreach (self::REGIONS as $r) { $ids = $this->ids($values[$r] ?? null); if ($ids) { $map[$r] = $ids; } }
    return $map;
  }

  // hook: plugin.after.install
  public function pluginAfterInstall($ctx) {
    $site = $ctx->entities->get('site');
    $old = $site['metadata']['theme']['regions'] ?? null;
    if (!$old) { return null; }
    $values = [];
    foreach (self::REGIONS as $r) { $ids = $this->ids($old[$r] ?? null); if ($ids) { $values[$r] = array_map(function ($n) { return ['node' => $n]; }, $ids); } }
    $ctx->config->save($values);
    $fresh = $ctx->entities->get('site');
    unset($fresh['metadata']['theme']['regions']);
    $ctx->entities->save('site', $fresh);
    $ctx->log->info('moved ' . count($values) . ' regions out of site.json');
    return null;
  }

  // hook: config.before.save
  public function configBeforeSave($ctx) {
    $pages = array_map(function ($p) { return $p['id']; }, $ctx->entities->list('page'));
    foreach (self::REGIONS as $r) {
      foreach ($this->ids($ctx->subject['values'][$r] ?? null) as $id) {
        if (!in_array($id, $pages, true)) { return $ctx->veto("region $r: \"$id\" is not a page of this site"); }
      }
    }
    return $ctx->subject;
  }

  // hook: config.after.save
  public function configAfterSave($ctx) {
    $ctx->storage->write('map', $this->toMap($ctx->subject['values']));
    return null;
  }

  // hook: rebuild.before
  public function rebuildBefore($ctx) {
    $map = $ctx->storage->read('map') ?: [];
    $used = [];
    foreach ($map as $list) { foreach ($list as $id) { $used[] = $id; } }
    $out = $ctx->subject;
    $out['fragments'] = array_values(array_unique(array_merge($out['fragments'] ?? [], $used)));
    return $out;
  }

  // hook: page.before.delete
  public function pageBeforeDelete($ctx) {
    $map = $ctx->storage->read('map') ?: [];
    foreach ($map as $r => $list) {
      if (in_array($ctx->subject['id'], $list, true)) { $ctx->warn('"' . ($ctx->subject['title'] ?? $ctx->subject['id']) . "\" is shown in the $r region; it will disappear from it"); }
    }
    return null;
  }
}

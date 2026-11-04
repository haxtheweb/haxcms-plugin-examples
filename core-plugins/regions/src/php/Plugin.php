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


  /**
   * Implements hook config.before.save.
   *
   * Refuses a region entry that is not a page of this site, so a region never points at a missing page.
   *
   * @param object $ctx  subject: [plugin, scope, siteId, values] as submitted (each region as [[node => page id]]);
   *                    previous: the stored values.
   * @return array  the subject unchanged, or a veto.
   */
  public function configBeforeSave($ctx) {
    $pages = array_map(function ($p) { return $p['id']; }, $ctx->entities->list('page'));
    foreach (self::REGIONS as $r) {
      foreach ($this->ids($ctx->subject['values'][$r] ?? null) as $id) {
        if (!in_array($id, $pages, true)) { return $ctx->veto("region $r: \"$id\" is not a page of this site"); }
      }
    }
    return $ctx->subject;
  }

  /**
   * Implements hook config.after.save.
   *
   * Writes the region map (region -> page ids) to the manifest store, where the region element reads it.
   *
   * @param object $ctx  subject: [plugin, scope, siteId, values] as written; previous: the values before the save.
   * @return null
   */
  public function configAfterSave($ctx) {
    $ctx->storage->write('map', $this->toMap($ctx->subject['values']));
    return null;
  }

  /**
   * Implements hook rebuild.before.
   *
   * Adds every page used in a region to fragments, because region pages render inside every page and are not
   * pages of their own for llms.txt, the sitemap or search.
   *
   * @param object $ctx  subject: [scope, siteId, reason, fragments].
   * @return array  the subject with the region pages added to fragments.
   */
  public function rebuildBefore($ctx) {
    $map = $ctx->storage->read('map') ?: [];
    $used = [];
    foreach ($map as $list) { foreach ($list as $id) { $used[] = $id; } }
    $out = $ctx->subject;
    $out['fragments'] = array_values(array_unique(array_merge($out['fragments'] ?? [], $used)));
    return $out;
  }

  /**
   * Implements hook page.before.delete.
   *
   * Warns when the page being deleted is shown in a region, since it will disappear from that region.
   *
   * @param object $ctx  subject: the page as stored (id, title, ...).
   * @return null  (it warns, never vetoes).
   */
  public function pageBeforeDelete($ctx) {
    $map = $ctx->storage->read('map') ?: [];
    foreach ($map as $r => $list) {
      if (in_array($ctx->subject['id'], $list, true)) { $ctx->warn('"' . ($ctx->subject['title'] ?? $ctx->subject['id']) . "\" is shown in the $r region; it will disappear from it"); }
    }
    return null;
  }
}

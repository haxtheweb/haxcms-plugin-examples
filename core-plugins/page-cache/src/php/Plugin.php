<?php
// Page cache (PHP). Mirrors src/nodejs/index.js.
class PageCachePlugin {
  private function usable($ctx) { return ($ctx->subject['mode'] ?? '') === 'dynamic' && !$ctx->user && !empty($ctx->subject['page']['id']); }
  private function clear($ctx, $why) {
    $had = count($ctx->storage->read('pages') ?: []);
    $ctx->storage->write('pages', new stdClass());
    if ($had) { $ctx->log->info("cleared $had cached pages ($why)"); }
    return $had;
  }
  /**
   * Implements operation pageCacheClear.
   *
   * Empties the page cache on request and reports how many pages were dropped.
   *
   * @param object $ctx  Platform context (spec/13).
   * @return array  [cleared].
   */
  public function pageCacheClear($ctx) { return ['cleared' => $this->clear($ctx, 'by request')]; }
  /**
   * Implements hook render.before.
   *
   * Answers an anonymous dynamic page view straight from the cache when a copy exists and is younger than the ttl setting (0 means no expiry), skipping the rest of rendering.
   *
   * @param object $ctx  subject: the render context [site, page, theme, mode, ...]; user is empty for anonymous views.
   * @return mixed  null, or $ctx->respond(html) on a hit.
   */
  public function renderBefore($ctx) {
    if (!$this->usable($ctx)) { return null; }
    $hit = ($ctx->storage->read('pages') ?: [])[$ctx->subject['page']['id']] ?? null;
    $ttl = (int) ($ctx->settings['ttl'] ?? 0);
    if ($hit && (!$ttl || $ctx->now() - $hit['at'] < $ttl * 1000)) { return $ctx->respond($hit['html']); }
    return null;
  }
  /**
   * Implements hook render.after.
   *
   * Stores the final document of an anonymous dynamic page view, in the store stage so it runs after anything that changes or signs the document; renders marked cacheable: false are skipped.
   *
   * @param object $ctx  subject: the render context, with html as the final document.
   * @return null
   */
  public function renderAfter($ctx) {
    if (!$this->usable($ctx) || ($ctx->subject['cacheable'] ?? true) === false) { return null; }
    $pages = $ctx->storage->read('pages') ?: [];
    $pages[$ctx->subject['page']['id']] = ['html' => $ctx->subject['html'], 'at' => $ctx->now()];
    $ctx->storage->write('pages', $pages);
    return null;
  }
  /**
   * Implements hook page.after.save.
   *
   * Clears the whole cache when a page is saved, since menus and links on other pages may change too.
   *
   * @param object $ctx  subject: the page as written; previous: the page before the save.
   * @return void
   */
  public function pageAfterSave($ctx) { $this->clear($ctx, 'page saved'); }
  /**
   * Implements hook page.after.delete.
   *
   * Clears the whole cache when a page is deleted, so no cached page still links to it.
   *
   * @param object $ctx  subject: the page as it was before deletion.
   * @return void
   */
  public function pageAfterDelete($ctx) { $this->clear($ctx, 'page deleted'); }
  /**
   * Implements hook manifest.after.save.
   *
   * Clears the whole cache when site.json is saved, because the outline and site settings appear on every page.
   *
   * @param object $ctx  subject: site.json as written; previous: site.json before the save.
   * @return void
   */
  public function manifestAfterSave($ctx) { $this->clear($ctx, 'site saved'); }
  /**
   * Implements hook config.after.save.
   *
   * Clears the whole cache when any plugin's settings are saved (subscribed with config: ["*"]), since settings can change what pages look like.
   *
   * @param object $ctx  subject: [plugin, scope, siteId?, values]; previous: the values before the save.
   * @return void
   */
  public function configAfterSave($ctx) { $this->clear($ctx, $ctx->subject['plugin'] . ' settings saved'); }
  /**
   * Implements hook plugin.after.enable.
   *
   * Clears the whole cache when a plugin is enabled, since it may add to every rendered page.
   *
   * @param object $ctx  subject: [id, version, scope, siteId?] of the plugin enabled.
   * @return void
   */
  public function pluginAfterEnable($ctx) { $this->clear($ctx, $ctx->subject['id'] . ' enabled'); }
  /**
   * Implements hook plugin.after.disable.
   *
   * Clears the whole cache when a plugin is disabled, so pages it changed are rendered again without it.
   *
   * @param object $ctx  subject: [id, version, scope, siteId?] of the plugin disabled.
   * @return void
   */
  public function pluginAfterDisable($ctx) { $this->clear($ctx, $ctx->subject['id'] . ' disabled'); }
}

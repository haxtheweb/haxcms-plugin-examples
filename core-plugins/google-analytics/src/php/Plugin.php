<?php
// Google Analytics (PHP). Mirrors src/nodejs/index.js.
class GoogleAnalyticsPlugin {
  const ID = '/^(G-[A-Z0-9]{4,}|UA-\d{4,}-\d+)$/';

  /**
   * Implements hook config.before.save.
   *
   * Refuses a measurement id that is not G-XXXXXXXXXX or UA-XXXXX-Y, and trims it before it is stored. It sees only
   * this plugin's own config (no `config` filter in plugin.yaml).
   *
   * @param object $ctx  subject: [plugin, scope, siteId, values] as submitted; previous: the stored values.
   * @return array  the subject with the trimmed id, or a veto.
   */
  public function configBeforeSave($ctx) {
    $id = trim((string) ($ctx->subject['values']['measurementId'] ?? ''));
    if ($id !== '' && !preg_match(self::ID, $id)) { return $ctx->veto("\"$id\" is not a Google Analytics measurement id (G-XXXXXXXXXX or UA-XXXXX-Y)"); }
    $out = $ctx->subject;
    $out['values']['measurementId'] = $id;
    return $out;
  }

  /**
   * Implements hook render.before.head.
   *
   * Adds a loader that waits for analytics consent (cookie-consent's HAXConsent API), then loads gtag with the site's
   * measurement id baked in.
   *
   * @param object $ctx  subject: the render context (site, page, head, ...); settings: measurementId.
   * @return array|null  the context with the loader in head, or null when no valid id is set.
   */
  public function renderBeforeHead($ctx) {
    $id = $ctx->settings['measurementId'] ?? '';
    if (!$id || !preg_match(self::ID, $id)) { return null; }
    $ctx->subject['head'][] = '<script type="module">globalThis.dataLayer=globalThis.dataLayer||[];function gtag(){dataLayer.push(arguments);}'
      . 'const go=()=>{gtag("js",new Date());gtag("config","' . $id . '");const s=document.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id=' . $id . '";document.head.appendChild(s);};'
      . 'const c=globalThis.HAXConsent;if(c)c.onGrant("analytics",go);else addEventListener("load",()=>globalThis.HAXConsent&&globalThis.HAXConsent.onGrant("analytics",go));</script>';
    return $ctx->subject;
  }
}

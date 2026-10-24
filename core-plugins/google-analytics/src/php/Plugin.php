<?php
// Google Analytics (PHP). Mirrors src/nodejs/index.js.
class GoogleAnalyticsPlugin {
  const ID = '/^(G-[A-Z0-9]{4,}|UA-\d{4,}-\d+)$/';

  // hook: plugin.before.requirements
  public function pluginBeforeRequirements($ctx) {
    if (!empty($ctx->settings['measurementId'])) { return $ctx->subject; }
    $out = $ctx->subject;
    $out[] = ['key' => 'settings.measurementId', 'message' => 'Add your Google Analytics measurement id'];
    return $out;
  }

  // hook: config.before.save
  public function configBeforeSave($ctx) {
    $id = trim((string) ($ctx->subject['values']['measurementId'] ?? ''));
    if ($id !== '' && !preg_match(self::ID, $id)) { return $ctx->veto("\"$id\" is not a Google Analytics measurement id (G-XXXXXXXXXX or UA-XXXXX-Y)"); }
    $out = $ctx->subject;
    $out['values']['measurementId'] = $id;
    return $out;
  }

  // hook: plugin.after.install
  public function pluginAfterInstall($ctx) {
    $site = $ctx->entities->get('site');
    $old = $site['metadata']['site']['settings']['gaID'] ?? null;
    if (!$old) { return null; }
    if (empty($ctx->settings['measurementId'])) { $ctx->config->save(['measurementId' => trim((string) $old)]); }
    unset($site['metadata']['site']['settings']['gaID']);
    $ctx->entities->save('site', $site);
    $ctx->log->info('moved gaID out of site.json into google-analytics settings');
    return null;
  }

  // hook: render.before.head
  public function renderBeforeHead($ctx) {
    $id = $ctx->settings['measurementId'] ?? '';
    if (!$id || !preg_match(self::ID, $id)) { return null; }
    $ctx->subject['head'][] = '<script type="module">globalThis.dataLayer=globalThis.dataLayer||[];function gtag(){dataLayer.push(arguments);}'
      . 'const go=()=>{gtag("js",new Date());gtag("config","' . $id . '");const s=document.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id=' . $id . '";document.head.appendChild(s);};'
      . 'const c=globalThis.HAXConsent;if(c)c.onGrant("analytics",go);else addEventListener("load",()=>globalThis.HAXConsent&&globalThis.HAXConsent.onGrant("analytics",go));</script>';
    return $ctx->subject;
  }
}

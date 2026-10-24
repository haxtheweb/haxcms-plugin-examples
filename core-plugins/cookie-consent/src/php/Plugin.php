<?php
// Cookie consent (PHP). Mirrors src/nodejs/index.js.
class CookieConsentPlugin {
  private function esc($s) { return htmlspecialchars((string) $s, ENT_COMPAT); }

  private function categoriesNeedingConsent($ctx) {
    $cats = [];
    foreach ($ctx->plugins->list() as $p) {
      $priv = $p['privacy'] ?? null;
      if ($priv && !empty($priv['tracking'])) {
        foreach ($priv['requiresConsent'] ?? [] as $c) { $cats[$c] = true; }
      }
    }
    $cats = array_keys($cats);
    sort($cats);
    return $cats;
  }

  // hook: render.after.body
  public function renderAfterBody($ctx) {
    $cats = $this->categoriesNeedingConsent($ctx);
    if (!$cats) { return null; }
    $s = $ctx->settings;
    $ctx->subject['body']['end'][] = '<script type="module" src="' . $this->esc($ctx->assets->url('frontend/dist/cookie-consent-banner.js')) . '"></script>';
    $ctx->subject['body']['end'][] = '<cookie-consent-banner categories="' . $this->esc(implode(',', $cats)) . '" message="' . $this->esc($s['message'] ?? '') . '"'
      . (!empty($s['policyUrl']) ? ' policy-url="' . $this->esc($s['policyUrl']) . '"' : '') . '></cookie-consent-banner>';
    return $ctx->subject;
  }
}

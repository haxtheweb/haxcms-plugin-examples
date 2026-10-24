<?php
// Author profile (PHP). Mirrors src/nodejs/index.js.
class AuthorProfilePlugin {
  const FIELDS = ['phone', 'location', 'website2', 'socialLink', 'socialLink2'];
  const LINKS = ['website2', 'socialLink', 'socialLink2'];

  private function clean($values) {
    $out = [];
    foreach (self::FIELDS as $f) { if (!empty($values[$f])) { $out[$f] = trim((string) $values[$f]); } }
    return $out;
  }


  // hook: config.before.save
  public function configBeforeSave($ctx) {
    $values = array_merge($ctx->subject['values'], $this->clean($ctx->subject['values']));
    foreach (self::LINKS as $f) {
      if (!empty($values[$f]) && !preg_match('#^https?://[^\s"<>]+$#', $values[$f])) { return $ctx->veto("$f must be a web address starting with http:// or https://"); }
    }
    $out = $ctx->subject;
    $out['values'] = $values;
    return $out;
  }

  // hook: config.after.save
  public function configAfterSave($ctx) {
    $ctx->storage->write('profile', $this->clean($ctx->subject['values']));
    return null;
  }

  // hook: render.before.head
  public function renderBeforeHead($ctx) {
    $p = $this->clean($ctx->settings);
    $sameAs = [];
    foreach (self::LINKS as $f) { if (!empty($p[$f])) { $sameAs[] = $p[$f]; } }
    if (!$sameAs && empty($p['location'])) { return null; }
    $person = ['@context' => 'https://schema.org', '@type' => 'Person'];
    if (!empty($p['location'])) { $person['address'] = $p['location']; }
    if ($sameAs) { $person['sameAs'] = $sameAs; }
    $json = str_replace('<', '<', json_encode($person, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    $ctx->subject['head'][] = '<script type="application/ld+json">' . $json . '</script>';
    return $ctx->subject;
  }
}

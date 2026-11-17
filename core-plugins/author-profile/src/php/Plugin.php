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


  /**
   * Implements hook config.before.save.
   *
   * Trims the profile fields and refuses a website or social link that is not an http(s) address.
   *
   * @param object $ctx  subject: [plugin, scope, siteId, values] as submitted; previous: the stored values.
   * @return array  the subject with trimmed values, or a veto.
   */
  public function configBeforeSave($ctx) {
    $values = array_merge($ctx->subject['values'], $this->clean($ctx->subject['values']));
    foreach (self::LINKS as $f) {
      if (!empty($values[$f]) && !preg_match('#^https?://[^\s"<>]+$#', $values[$f])) { return $ctx->veto("$f must be a web address starting with http:// or https://"); }
    }
    $out = $ctx->subject;
    $out['values'] = $values;
    return $out;
  }

  /**
   * Implements hook config.after.save.
   *
   * Writes the cleaned profile to the manifest store, so themes such as resume-theme can show it client-side.
   *
   * @param object $ctx  subject: [plugin, scope, siteId, values] as written; previous: the values before the save.
   * @return null
   */
  public function configAfterSave($ctx) {
    $ctx->storage->write('profile', $this->clean($ctx->subject['values']));
    return null;
  }

  /**
   * Implements hook render.before.head.
   *
   * Adds a schema.org Person block with the author's location and links, so search engines can describe the author.
   *
   * @param object $ctx  subject: the render context (site, page, head, ...); settings: the profile fields.
   * @return array|null  the context with the JSON-LD in head, or null when there is no location or link.
   */
  public function renderBeforeHead($ctx) {
    $p = $this->clean($ctx->settings);
    $sameAs = [];
    foreach (self::LINKS as $f) { if (!empty($p[$f])) { $sameAs[] = $p[$f]; } }
    if (!$sameAs && empty($p['location'])) { return null; }
    $person = ['@context' => 'https://schema.org', '@type' => 'Person'];
    if (!empty($p['location'])) { $person['address'] = $p['location']; }
    if ($sameAs) { $person['sameAs'] = $sameAs; }
    $json = str_replace('<', '\u003c', json_encode($person, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    $ctx->subject['head'][] = '<script type="application/ld+json">' . $json . '</script>';
    return $ctx->subject;
  }
}

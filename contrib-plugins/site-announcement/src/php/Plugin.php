<?php
// Site announcement (PHP). Mirrors src/nodejs/index.js: same rules, same markup.
class SiteAnnouncementPlugin {
  const VARIANTS = ['brand', 'neutral', 'success', 'warning', 'danger'];

  private function esc($s) { return htmlspecialchars((string) $s, ENT_COMPAT); }

  // plain text: no markup characters or control characters, single spaces, at most $max code points
  private function plain($value, $max) {
    $s = trim(preg_replace('/ +/', ' ', preg_replace('/[\x00-\x1f\x7f<>]/', ' ', (string) ($value ?? ''))));
    return trim(mb_substr($s, 0, $max, 'UTF-8'));
  }

  // http(s), mailto, or a path on this site; anything else (javascript:, data:, //other-host) is dropped
  private function safeLink($value) {
    $s = preg_replace('/[\x00-\x20\x7f]/', '', (string) ($value ?? ''));
    if ($s === '') { return ''; }
    if (preg_match('/^(https?:\/\/|mailto:)/i', $s)) { return $s; }
    if (preg_match('/^[a-z][a-z0-9+.\-]*:/i', $s) || strpos($s, '//') === 0 || strpos($s, '\\') === 0) { return ''; }
    return $s;
  }

  // YYYY-MM-DD that is a real day, or ''
  private function day($value) {
    $s = trim((string) ($value ?? ''));
    if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $s, $m)) { return ''; }
    return checkdate((int) $m[2], (int) $m[3], (int) $m[1]) ? $s : '';
  }

  private function announcement($s, $today) {
    $s = is_array($s) ? $s : [];
    $a = [
      'title' => $this->plain($s['title'] ?? '', 120),
      'text' => $this->plain($s['text'] ?? '', 500),
      'link' => $this->safeLink($s['link'] ?? ''),
      'linkText' => $this->plain($s['linkText'] ?? '', 80),
      'variant' => in_array($s['variant'] ?? '', self::VARIANTS, true) ? $s['variant'] : 'brand',
      'ends' => $this->day($s['ends'] ?? ''),
    ];
    if ($a['title'] === '' && $a['text'] === '') { return null; }
    if ($a['ends'] !== '' && strcmp($a['ends'], $today) < 0) { return null; }
    return $a;
  }

  /**
   * Implements hook render.before.body.
   *
   * Adds the site-announcement-bar element and its script right after the opening body tag, with the announcement
   * baked in as attributes, so it sits above whatever the theme draws. Adds nothing when the announcement is empty
   * or its end date has passed.
   *
   * @param object $ctx  subject: the render context (site, body start/end, ...); settings: title, text, link, linkText,
   *                     variant, ends; now(): the clock.
   * @return array|null  the context with the bar added to body start, or null when there is nothing to show.
   */
  public function renderBeforeBody($ctx) {
    $a = $this->announcement($ctx->settings, gmdate('Y-m-d', intdiv((int) $ctx->now(), 1000)));
    if (!$a) { return null; }
    $site = $ctx->subject['site']['id'] ?? '';
    $attrs = '';
    foreach ([['site', $site], ['variant', $a['variant']], ['heading', $a['title']], ['text', $a['text']],
      ['link', $a['link']], ['link-text', $a['link'] !== '' ? $a['linkText'] : ''], ['ends', $a['ends']]] as $kv) {
      if ((string) $kv[1] !== '') { $attrs .= ' ' . $kv[0] . '="' . $this->esc($kv[1]) . '"'; }
    }
    $ctx->subject['body']['start'][] = '<script type="module" src="' . $this->esc($ctx->assets->url('frontend/dist/site-announcement-bar.js')) . '"></script>';
    $ctx->subject['body']['start'][] = '<site-announcement-bar' . $attrs . '></site-announcement-bar>';
    return $ctx->subject;
  }
}

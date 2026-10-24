<?php
// SEO meta (PHP). Mirrors src/nodejs/index.js.
class SeoMetaPlugin {
  const NS = 'seo-meta';
  private function esc($s) { return str_replace(['&', '<', '>', '"'], ['&amp;', '&lt;', '&gt;', '&quot;'], (string) $s); }
  private function mine($p) { return $p['metadata']['plugins'][self::NS] ?? []; }
  public function pageBeforeSave($ctx) {
    $m = $this->mine($ctx->subject);
    if (array_key_exists('description', $m)) {
      $d = trim(preg_replace('/\s+/', ' ', (string) $m['description']));
      $n = mb_strlen($d);
      if ($d !== '' && ($n < 50 || $n > 160)) { $ctx->warn("search description is $n characters; 50 to 160 reads best", 'notice'); }
      $ctx->subject['metadata']['plugins'][self::NS]['description'] = $d;
    }
    if (!empty($m['image']) && !preg_match('/^(files\/[^\s"<>]+|https:\/\/[^\s"<>]+)$/', $m['image'])) { return $ctx->veto('share image must be a path under files/ or an https URL', 422); }
    return $ctx->subject;
  }
  public function renderBeforeHead($ctx) {
    $page = $ctx->subject['page'] ?? [];
    $m = $this->mine($page);
    $base = $ctx->site['url'];
    $site = $ctx->entities->get('site') ?: [];
    $slug = (string) (($page['slug'] ?? '') !== '' ? $page['slug'] : ($page['id'] ?? ''));
    $url = $base . ltrim($slug, '/');
    $title = ($page['title'] ?? '') !== '' ? $page['title'] : ($site['title'] ?? '');
    $tags = ['<link rel="canonical" href="' . $this->esc($url) . '">', '<meta property="og:title" content="' . $this->esc($title) . '">', '<meta property="og:url" content="' . $this->esc($url) . '">'];
    if (!empty($m['description'])) { $tags[] = '<meta name="description" content="' . $this->esc($m['description']) . '">'; $tags[] = '<meta property="og:description" content="' . $this->esc($m['description']) . '">'; }
    if (!empty($m['image'])) { $tags[] = '<meta property="og:image" content="' . $this->esc(preg_match('/^https:/', $m['image']) ? $m['image'] : $base . $m['image']) . '">'; }
    if (!empty($m['noindex'])) { $tags[] = '<meta name="robots" content="noindex">'; }
    foreach ($tags as $t) { $ctx->subject['head'][] = $t; }
    return $ctx->subject;
  }
}

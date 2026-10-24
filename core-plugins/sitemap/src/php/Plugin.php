<?php
// Sitemap (PHP). Mirrors src/nodejs/index.js byte for byte.
class SitemapPlugin {
  private function esc($v) { return str_replace(['&', '<', '>', '"', "'"], ['&amp;', '&lt;', '&gt;', '&quot;', '&apos;'], (string) $v); }
  private function ms($v, $fallback) { if ($v === null || $v === '' || !is_numeric($v)) { return $fallback; } $n = $v + 0; return $n < 1e12 ? $n * 1000 : $n; }
  private function iso($t) { return gmdate('Y-m-d\TH:i:s', intdiv((int) $t, 1000)) . sprintf('.%03dZ', ((int) $t) % 1000); }

  public function rebuildAfter($ctx) {
    $base = $ctx->site['url'];
    $pages = $ctx->entities->list('page', ['listed' => true]);
    $byId = [];
    foreach ($pages as $p) { $byId[$p['id']] = $p; }
    $depth = function ($p, $seen = []) use (&$depth, $byId) {
      $parent = $p['parent'] ?? null;
      if (!$parent || !isset($byId[$parent]) || in_array($p['id'], $seen, true)) { return 0; }
      return 1 + $depth($byId[$parent], array_merge($seen, [$p['id']]));
    };
    usort($pages, function ($a, $b) { return ((int) ($a['order'] ?? 0) <=> (int) ($b['order'] ?? 0)) ?: strcmp((string) $a['id'], (string) $b['id']); });
    $urls = [];
    foreach ($pages as $p) {
      $d = $depth($p);
      $m = $p['metadata'] ?? [];
      $lastmod = $this->iso($this->ms($m['updated'] ?? null, $this->ms($m['created'] ?? null, $ctx->now())));
      $slug = ltrim((string) (($p['slug'] ?? '') !== '' ? $p['slug'] : $p['id']), '/');
      $urls[] = "  <url>\n    <loc>" . $this->esc($base . $slug) . "</loc>\n    <lastmod>" . $lastmod . "</lastmod>\n    <priority>" . ($d === 0 ? '1.0' : ($d === 1 ? '0.7' : '0.5')) . "</priority>\n  </url>";
    }
    $ctx->files->writeManaged('sitemap.xml', "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n" . implode("\n", $urls) . ($urls ? "\n" : '') . "</urlset>\n");
    $ctx->files->writeManaged('sitemap-index.xml', "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<sitemapindex xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n  <sitemap>\n    <loc>" . $this->esc($base . 'sitemap.xml') . "</loc>\n    <lastmod>" . $this->iso($ctx->now()) . "</lastmod>\n  </sitemap>\n</sitemapindex>\n");
  }
}

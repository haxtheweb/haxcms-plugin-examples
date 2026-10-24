<?php
// Feeds (PHP). Mirrors src/nodejs/index.js byte for byte.
class FeedsPlugin {
  private function esc($v) { return str_replace(['&', '<', '>', '"', "'"], ['&amp;', '&lt;', '&gt;', '&quot;', '&apos;'], (string) $v); }
  private function strip($v) { return trim(preg_replace('/\s+/', ' ', preg_replace('/<[^>]*>/', ' ', (string) $v))); }
  private function ms($v, $fallback) { if ($v === null || $v === '' || !is_numeric($v)) { return $fallback; } $n = $v + 0; return $n < 1e12 ? $n * 1000 : $n; }
  private function rfc822($t) { return gmdate('D, d M Y H:i:s', intdiv((int) $t, 1000)) . ' GMT'; }
  private function iso($t) { return gmdate('Y-m-d\TH:i:s', intdiv((int) $t, 1000)) . sprintf('.%03dZ', ((int) $t) % 1000); }

  private function newest($ctx) {
    $now = $ctx->now();
    $pages = $ctx->entities->list('page', ['listed' => true]);
    foreach ($pages as &$p) {
      $m = $p['metadata'] ?? [];
      $p['created'] = $this->ms($m['created'] ?? null, $now);
      $p['updated'] = $this->ms($m['updated'] ?? null, $this->ms($m['created'] ?? null, $now));
    }
    unset($p);
    usort($pages, function ($a, $b) { return ($b['created'] <=> $a['created']) ?: strcmp((string) $a['id'], (string) $b['id']); });
    return array_slice($pages, 0, max(1, (int) ($ctx->settings['limit'] ?? 25) ?: 25));
  }

  public function rebuildAfter($ctx) {
    $site = $ctx->entities->get('site') ?: [];
    $base = $ctx->site['url'];
    $updated = $this->ms($site['metadata']['site']['updated'] ?? null, $ctx->now());
    $items = $this->newest($ctx);
    $link = function ($p) use ($base) { return $base . ltrim((string) (($p['slug'] ?? '') !== '' ? $p['slug'] : $p['id']), '/'); };
    $rss = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0">',
      '  <channel>',
      '    <title>' . $this->esc($site['title'] ?? '') . '</title>',
      '    <link>' . $this->esc($base) . '</link>',
      '    <description>' . $this->esc($this->strip($site['description'] ?? '')) . '</description>',
      '    <lastBuildDate>' . $this->rfc822($updated) . '</lastBuildDate>',
      '    <generator>HAXcms</generator>',
      '    <atom:link href="' . $this->esc($base . 'rss.xml') . '" rel="self" type="application/rss+xml"/>',
    ];
    foreach ($items as $p) {
      $d = $this->strip($p['content'] ?? '');
      if (mb_strlen($d) > 500) { $d = mb_substr($d, 0, 497) . '...'; }
      $rss[] = "    <item>\n      <title>" . $this->esc($p['title'] ?? '') . "</title>\n      <link>" . $this->esc($link($p)) . "</link>\n      <description>" . $this->esc($d) . "</description>\n      <guid>" . $this->esc($link($p)) . "</guid>\n      <pubDate>" . $this->rfc822($p['created']) . "</pubDate>\n    </item>";
    }
    array_push($rss, '  </channel>', '</rss>', '');
    $author = $site['metadata']['author']['name'] ?? '';
    $atom = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<feed xmlns="http://www.w3.org/2005/Atom">',
      '  <title>' . $this->esc($site['title'] ?? '') . '</title>',
      '  <link href="' . $this->esc($base) . '" rel="self"/>',
      '  <subtitle>' . $this->esc($this->strip($site['description'] ?? '')) . '</subtitle>',
      '  <updated>' . $this->iso($updated) . '</updated>',
      '  <author><name>' . $this->esc($author) . '</name></author>',
      '  <id>' . $this->esc($base) . '</id>',
    ];
    foreach ($items as $p) {
      $body = !empty($ctx->settings['fullContent']) ? "\n    <content type=\"html\"><![CDATA[" . str_replace(']]>', ']]]]><![CDATA[>', (string) ($p['content'] ?? '')) . ']]></content>' : '';
      $atom[] = "  <entry>\n    <title>" . $this->esc($p['title'] ?? '') . "</title>\n    <id>" . $this->esc($p['id']) . "</id>\n    <updated>" . $this->iso($p['updated']) . "</updated>\n    <published>" . $this->iso($p['created']) . "</published>\n    <summary>" . $this->esc($p['description'] ?? '') . "</summary>\n    <link href=\"" . $this->esc($link($p)) . "\"/>" . $body . "\n  </entry>";
    }
    array_push($atom, '</feed>', '');
    $ctx->files->writeManaged('rss.xml', implode("\n", $rss));
    $ctx->files->writeManaged('atom.xml', implode("\n", $atom));
  }
}

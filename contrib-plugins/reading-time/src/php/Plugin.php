<?php
// Reading time (PHP). Mirrors src/nodejs/index.js.
class ReadingTimePlugin {
  const NS = 'reading-time';
  private function count($html) {
    $t = trim(preg_replace('/<[^>]*>/', ' ', preg_replace('/<(script|style)[\s\S]*?<\/\1>/i', ' ', (string) $html)));
    return $t === '' ? 0 : count(preg_split('/\s+/', $t));
  }
  public function pageBeforeSave($ctx) {
    $p = $ctx->subject;
    $words = $this->count($p['content'] ?? '');
    $wpm = (int) ($ctx->settings['wordsPerMinute'] ?? 200) ?: 200;
    $minutes = $words ? max(1, (int) round($words / $wpm)) : 0;
    $p['metadata'] = $p['metadata'] ?? [];
    $p['metadata']['plugins'] = $p['metadata']['plugins'] ?? [];
    $p['metadata']['plugins'][self::NS] = ['words' => $words, 'minutes' => $minutes];
    return $p;
  }
  public function renderBeforeContent($ctx) {
    $m = $ctx->subject['page']['metadata']['plugins'][self::NS] ?? null;
    if (!$m || empty($m['minutes'])) { return null; }
    $label = str_replace('{n}', (string) $m['minutes'], (string) ($ctx->settings['label'] ?? '{n} min read'));
    $ctx->subject['content'] = '<p class="reading-time">' . htmlspecialchars($label, ENT_QUOTES | ENT_HTML5, 'UTF-8') . '</p>' . $ctx->subject['content'];
    return $ctx->subject;
  }
}

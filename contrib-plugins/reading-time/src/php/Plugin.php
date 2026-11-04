<?php
// Reading time (PHP). Mirrors src/nodejs/index.js.
class ReadingTimePlugin {
  const NS = 'reading-time';
  private function count($html) {
    $t = trim(preg_replace('/<[^>]*>/', ' ', preg_replace('/<(script|style)[\s\S]*?<\/\1>/i', ' ', (string) $html)));
    return $t === '' ? 0 : count(preg_split('/\s+/', $t));
  }
  /**
   * Implements hook page.before.save.
   *
   * Counts the words of the page and stores the word count and reading time in metadata.plugins.reading-time, so
   * themes and the render hook can show it without counting again. Uses the wordsPerMinute setting (200 by default).
   *
   * @param object $ctx  subject: the page as submitted; previous: the stored page.
   * @return array  the page with the computed fields.
   */
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
  /**
   * Implements hook render.before.content.
   *
   * Puts a short reading-time line above the page content, using the minutes stored at save time and the label
   * setting.
   *
   * @param object $ctx  subject: the render state (page, content).
   * @return array|null  the render state with the line added, or nothing when the page has no reading time.
   */
  public function renderBeforeContent($ctx) {
    $m = $ctx->subject['page']['metadata']['plugins'][self::NS] ?? null;
    if (!$m || empty($m['minutes'])) { return null; }
    $label = str_replace('{n}', (string) $m['minutes'], (string) ($ctx->settings['label'] ?? '{n} min read'));
    $ctx->subject['content'] = '<p class="reading-time">' . htmlspecialchars($label, ENT_QUOTES | ENT_HTML5, 'UTF-8') . '</p>' . $ctx->subject['content'];
    return $ctx->subject;
  }
}

<?php
// HTML importer (PHP). Mirrors src/nodejs/index.js.
class ImporterHtmlPlugin {
  private function strip($html) { return preg_replace('/\son\w+="[^"]*"/i', '', preg_replace('/<(script|style)[\s\S]*?<\/\1>/i', '', (string) $html)); }
  private function text($html) { return trim(preg_replace('/\s+/', ' ', preg_replace('/<[^>]+>/', '', (string) $html))); }
  private function slug($t) { $s = trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($this->text($t))), '-'); return $s !== '' ? $s : 'page'; }

  private function convert($html) {
    $clean = $this->strip($html);
    $body = preg_match('/<body[^>]*>([\s\S]*)<\/body>/i', $clean, $m) ? $m[1] : $clean;
    if (preg_match('/<h1[^>]*>([\s\S]*?)<\/h1>/i', $body, $m) || preg_match('/<title[^>]*>([\s\S]*?)<\/title>/i', $clean, $m)) { $title = $this->text($m[1]); } else { $title = 'Imported site'; }
    $rest = preg_replace('/<h1[^>]*>[\s\S]*?<\/h1>/i', '', $body, 1);
    $parts = array_values(array_filter(array_map('trim', preg_split('/(?=<h2[^>]*>)/i', $rest)), 'strlen'));
    $items = [];
    foreach ($parts as $part) {
      if (preg_match('/^<h2[^>]*>([\s\S]*?)<\/h2>/i', $part, $h)) { $pageTitle = $this->text($h[1]); $content = trim(substr($part, strlen($h[0]))); }
      else { $pageTitle = 'Introduction'; $content = trim($part); }
      $s = $this->slug($pageTitle); $n = 2;
      while (in_array($s, array_column($items, 'slug'), true)) { $s = $this->slug($pageTitle) . '-' . ($n++); }
      $items[] = ['id' => 'item-' . (count($items) + 1), 'title' => $pageTitle, 'slug' => $s, 'parent' => null, 'order' => count($items), 'content' => $content];
    }
    return ['title' => $title, 'items' => $items];
  }

  /**
   * Implements contract import.platform, operation convert (dispatch: chosen).
   *
   * Splits an HTML document into pages at each h2, with the h1 (or title) as the site title and text before the first h2 as Introduction. Scripts, styles and event handlers are dropped; core sanitizes again on save.
   *
   * @param object $ctx    Platform context (spec/13); unused.
   * @param array  $input  [html].
   * @return array  [title, items] or [error].
   */
  public function importPlatformConvert($ctx, $input) {
    if (!is_array($input) || !is_string($input['html'] ?? null)) { return ['error' => 'html is required']; }
    return $this->convert($input['html']);
  }
}

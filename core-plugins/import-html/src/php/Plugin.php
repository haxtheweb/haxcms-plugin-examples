<?php
// HTML file import (PHP). Mirrors src/nodejs/index.js.
class ImportHtmlPlugin {
  private function strip($h) {
    $h = preg_replace('/<!--[\s\S]*?-->/', '', (string) $h);
    $h = preg_replace('/<(script|style|iframe|object|embed|noscript|template)\b[\s\S]*?<\/\1>/i', '', $h);
    $h = preg_replace('/<(script|style|link|meta|base)\b[^>]*>/i', '', $h);
    $h = preg_replace('/\son\w+\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+)/i', '', $h);
    return preg_replace('/(href|src)\s*=\s*(["\'])\s*javascript:[^"\']*\2/i', '$1="#"', $h);
  }

  /**
   * Implements contract import.file, operation convert (dispatch: accepts .html, .htm).
   *
   * Keeps the body, drops scripts, styles, embeds, comments, inline event handlers and javascript: links, and returns
   * the rest for core to split into pages (core sanitizes again when pages are saved).
   *
   * @param object $ctx    Platform context (spec/13).
   * @param array  $input  [name, data (base64), method, type, parentId].
   * @return array  [html, title?] or [error].
   */
  public function importFileConvert($ctx, $input) {
    $text = (string) base64_decode((string) ($input['data'] ?? ''), true);
    $title = preg_match('/<title[^>]*>([\s\S]*?)<\/title>/i', $text, $t) ? trim(preg_replace('/\s+/', ' ', $t[1])) : '';
    $body = preg_match('/<body[^>]*>([\s\S]*)<\/body>/i', $text, $b) ? $b[1] : $text;
    $html = trim(preg_replace('/>\s+</', '><', $this->strip($body)));
    if ($html === '') { return ['error' => 'the file has no content']; }
    $r = ['html' => $html];
    if ($title !== '') { $r['title'] = $title; }
    return $r;
  }
}

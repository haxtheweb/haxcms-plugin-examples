<?php
// Markdown import (PHP). The converter is in Markdown.php (mirrors src/nodejs/markdown.js).
require_once __DIR__ . '/Markdown.php';

class ImportMarkdownPlugin {
  /**
   * Implements contract import.file, operation convert (dispatch: accepts .md, .markdown).
   *
   * Converts the file to HTML (front matter title, if any, becomes the title) for core to split into pages.
   *
   * @param object $ctx    Platform context (spec/13).
   * @param array  $input  [name, data (base64), method, type, parentId].
   * @return array  [html, title?] or [error].
   */
  public function importFileConvert($ctx, $input) {
    $text = (string) base64_decode((string) ($input['data'] ?? ''), true);
    if (trim($text) === '') { return ['error' => 'the file is empty']; }
    $r = ImportMarkdownConverter::toHtml($text);
    $out = ['html' => $r['html']];
    if ($r['title'] !== '') { $out['title'] = $r['title']; }
    return $out;
  }
}

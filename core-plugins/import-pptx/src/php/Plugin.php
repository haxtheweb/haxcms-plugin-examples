<?php
// PowerPoint import (PHP). Mirrors src/nodejs/index.js.
class ImportPptxPlugin {
  const PARTS = '^(ppt/slides/slide\d+\.xml|docProps/core\.xml)$';

  private function texts($xml) { preg_match_all('/<a:t>([\s\S]*?)<\/a:t>/', $xml, $m); return implode('', $m[1]); }

  /** Nested lists from [[text, level]]. */
  private function lists($points) {
    $html = ''; $depth = -1;
    foreach ($points as $pt) {
      $level = $pt['level'];
      if ($level > $depth) { $html .= str_repeat('<ul>', $level - $depth); $depth = $level; }
      else { $html .= '</li>'; while ($depth > $level) { $html .= '</ul></li>'; $depth--; } }
      $html .= '<li>' . $pt['text'];
    }
    if ($depth >= 0) { $html .= '</li>'; while ($depth > 0) { $html .= '</ul></li>'; $depth--; } $html .= '</ul>'; }
    return $html;
  }

  private function slidesToHtml($parts) {
    $slides = array_values(array_filter(array_keys($parts), function ($k) { return strpos($k, 'ppt/slides/') === 0; }));
    if (!$slides) { return ['error' => 'this .pptx has no slides']; }
    usort($slides, function ($a, $b) { preg_match('/(\d+)\.xml$/', $a, $x); preg_match('/(\d+)\.xml$/', $b, $y); return (int) $x[1] <=> (int) $y[1]; });
    $out = [];
    foreach ($slides as $i => $name) {
      $title = ''; $points = [];
      preg_match_all('/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/', $parts[$name], $sps);
      foreach ($sps[1] as $sp) {
        $isTitle = (bool) preg_match('/<p:ph\b[^>]*type="(title|ctrTitle)"/', $sp);
        preg_match_all('/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/', $sp, $ps);
        foreach ($ps[1] as $p) {
          $text = trim($this->texts($p));
          if ($text === '') { continue; }
          if ($isTitle) { $title = $title !== '' ? "$title $text" : $text; }
          else { $points[] = ['text' => $text, 'level' => preg_match('/<a:pPr\b[^>]*lvl="(\d)"/', $p, $l) ? (int) $l[1] : 0]; }
        }
      }
      $out[] = '<h2>' . ($title !== '' ? $title : 'Slide ' . ($i + 1)) . '</h2>' . $this->lists($points);
    }
    $r = ['html' => implode('', $out)];
    if (preg_match('/<dc:title>([\s\S]*?)<\/dc:title>/', $parts['docProps/core.xml'] ?? '', $t) && trim($t[1]) !== '') { $r['title'] = trim($t[1]); }
    return $r;
  }

  /**
   * Implements contract import.file, operation convert (dispatch: accepts .pptx).
   *
   * Each slide becomes an h2 section: the title placeholder as the heading, other text as nested lists by indent
   * level. Core turns the sections into pages (one per slide with the site method).
   *
   * @param object $ctx    Platform context (spec/13); uses $ctx->archive->read().
   * @param array  $input  [name, data (base64), method, type, parentId].
   * @return array  [html, title?] or [error].
   */
  public function importFileConvert($ctx, $input) {
    try { $parts = $ctx->archive->read($input['data'] ?? '', ['match' => self::PARTS]); }
    catch (Exception $e) { return ['error' => 'not a .pptx file (' . $e->getMessage() . ')']; }
    return $this->slidesToHtml($parts);
  }
}

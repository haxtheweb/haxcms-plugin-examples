<?php
// Word import (PHP). Mirrors src/nodejs/index.js; same regular expressions, same HTML.
class ImportDocxPlugin {
  const PARTS = '^(word/document\.xml|word/numbering\.xml|word/_rels/document\.xml\.rels|docProps/core\.xml)$';

  private function attr($xml, $name) { return preg_match('/' . preg_quote($name, '/') . '="([^"]*)"/', $xml, $m) ? $m[1] : null; }

  /** numId => "ol" | "ul", from numbering.xml. */
  private function listKinds($xml) {
    $abstract = []; $out = [];
    preg_match_all('/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/', (string) $xml, $mm, PREG_SET_ORDER);
    foreach ($mm as $m) { $abstract[$m[1]] = (preg_match('/<w:lvl\b[^>]*w:ilvl="0"[^>]*>[\s\S]*?<w:numFmt w:val="([^"]+)"/', $m[2], $f) && preg_match('/decimal|letter|roman/i', $f[1])) ? 'ol' : 'ul'; }
    preg_match_all('/<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/', (string) $xml, $mm, PREG_SET_ORDER);
    foreach ($mm as $m) { $out[$m[1]] = $abstract[$m[2]] ?? 'ul'; }
    return $out;
  }

  /** Relationship id => target. */
  private function relTargets($xml) {
    $out = [];
    preg_match_all('/<Relationship\b([^>]*)\/?>/', (string) $xml, $mm, PREG_SET_ORDER);
    foreach ($mm as $m) { $id = $this->attr($m[1], 'Id'); if ($id) { $out[$id] = $this->attr($m[1], 'Target'); } }
    return $out;
  }

  /** The text of one run, wrapped for bold, italic, underline (as em) and strike. */
  private function run($xml) {
    $props = preg_match('/<w:rPr>([\s\S]*?)<\/w:rPr>/', $xml, $m) ? $m[1] : '';
    $text = '';
    preg_match_all('/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/', $xml, $mm, PREG_SET_ORDER);
    foreach ($mm as $t) { $text .= isset($t[1]) ? $t[1] : ($t[0] === '<w:tab/>' ? ' ' : '<br>'); }
    if ($text === '') { return ''; }
    if (preg_match('/<w:strike\/>/', $props)) { $text = "<del>$text</del>"; }
    if (preg_match('/<w:(i|u)\b(?![^>]*w:val="(false|0|none)")/', $props)) { $text = "<em>$text</em>"; }
    if (preg_match('/<w:b\b(?![^>]*w:val="(false|0)")/', $props)) { $text = "<strong>$text</strong>"; }
    return $text;
  }

  /** One paragraph: [tag, html, list]. */
  private function paragraph($xml, $rels) {
    $style = preg_match('/<w:pStyle\b[^>]*\/>/', $xml, $s) ? ($this->attr($s[0], 'w:val') ?? '') : '';
    $numId = preg_match('/<w:numId\b[^>]*\/>/', $xml, $n) ? $this->attr($n[0], 'w:val') : null;
    $html = '';
    preg_match_all('/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r\b[^>]*>([\s\S]*?)<\/w:r>/', $xml, $mm, PREG_SET_ORDER);
    foreach ($mm as $m) {
      if (!isset($m[3])) { // the hyperlink branch matched (the run group is absent)
        $href = $rels[$this->attr($m[1], 'r:id')] ?? '';
        preg_match_all('/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/', $m[2], $rr);
        $inner = implode('', array_map([$this, 'run'], $rr[1]));
        $html .= preg_match('/^(https?:|mailto:)/', $href) ? '<a href="' . $href . '">' . $inner . '</a>' : $inner;
      } else { $html .= $this->run($m[3]); }
    }
    if (preg_match('/^title$/i', $style)) { $tag = 'title'; }
    elseif (preg_match('/^heading\s?([1-6])$/i', $style, $h)) { $tag = 'h' . $h[1]; }
    elseif ($numId !== null && $numId !== '0') { $tag = 'li'; }
    else { $tag = 'p'; }
    return ['tag' => $tag, 'html' => trim($html), 'list' => $numId];
  }

  /** A table: first row as header cells. */
  private function table($xml, $rels) {
    preg_match_all('/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/', $xml, $rows);
    $out = '';
    foreach ($rows[1] as $i => $row) {
      preg_match_all('/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/', $row, $cells);
      $out .= '<tr>';
      foreach ($cells[1] as $c) {
        preg_match_all('/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/', $c, $ps);
        $text = implode(' ', array_map(function ($p) use ($rels) { return $this->paragraph($p, $rels)['html']; }, $ps[0]));
        $out .= $i === 0 ? "<th>$text</th>" : "<td>$text</td>";
      }
      $out .= '</tr>';
    }
    return "<table>$out</table>";
  }

  private function docxToHtml($parts) {
    $doc = $parts['word/document.xml'] ?? null;
    if (!$doc) { return ['error' => 'this .docx has no word/document.xml']; }
    $kinds = $this->listKinds($parts['word/numbering.xml'] ?? '');
    $rels = $this->relTargets($parts['word/_rels/document.xml.rels'] ?? '');
    $body = preg_match('/<w:body>([\s\S]*)<\/w:body>/', $doc, $b) ? $b[1] : '';
    $title = preg_match('/<dc:title>([\s\S]*?)<\/dc:title>/', $parts['docProps/core.xml'] ?? '', $t) ? trim($t[1]) : '';
    $out = []; $open = null;
    $close = function () use (&$out, &$open) { if ($open) { $out[] = '</' . $open['tag'] . '>'; $open = null; } };
    preg_match_all('/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/', $body, $mm);
    foreach ($mm[0] as $block) {
      if (strpos($block, '<w:tbl') === 0) { $close(); $out[] = $this->table($block, $rels); continue; }
      $p = $this->paragraph($block, $rels);
      if ($p['tag'] === 'title') { if ($title === '') { $title = preg_replace('/<[^>]+>/', '', $p['html']); } continue; }
      if ($p['tag'] === 'li') {
        $kind = $kinds[$p['list']] ?? 'ul';
        if (!$open || $open['id'] !== $p['list']) { $close(); $out[] = "<$kind>"; $open = ['tag' => $kind, 'id' => $p['list']]; }
        $out[] = '<li>' . $p['html'] . '</li>';
        continue;
      }
      $close();
      if ($p['html'] !== '') { $out[] = '<' . $p['tag'] . '>' . $p['html'] . '</' . $p['tag'] . '>'; }
    }
    $close();
    $r = ['html' => implode('', $out)];
    if ($title !== '') { $r['title'] = $title; }
    return $r;
  }

  /**
   * Implements contract import.file, operation convert (dispatch: accepts .docx).
   *
   * Reads the document parts from the uploaded zip and returns HTML; core splits it into pages by headings,
   * using the person's choice of site, branch or page. Never writes pages itself.
   *
   * @param object $ctx    Platform context (spec/13); uses $ctx->archive->read().
   * @param array  $input  [name, data (base64), method, type, parentId].
   * @return array  [html, title?] or [error].
   */
  public function importFileConvert($ctx, $input) {
    try { $parts = $ctx->archive->read($input['data'] ?? '', ['match' => self::PARTS]); }
    catch (Exception $e) { return ['error' => 'not a .docx file (' . $e->getMessage() . '); a .doc file must be saved as .docx first']; }
    return $this->docxToHtml($parts);
  }
}

<?php
// Spreadsheet import (PHP). Mirrors src/nodejs/index.js.
class ImportXlsxPlugin {
  const PARTS = '^(xl/workbook\.xml|xl/_rels/workbook\.xml\.rels|xl/sharedStrings\.xml|xl/worksheets/sheet\d+\.xml)$';

  private function unxml($s) { return str_replace(['&lt;', '&gt;', '&quot;', '&apos;', '&amp;'], ['<', '>', '"', "'", '&'], (string) $s); }
  private function col($ref) { $n = 0; foreach (str_split(preg_replace('/\d+$/', '', $ref)) as $ch) { $n = $n * 26 + ord($ch) - 64; } return $n - 1; }
  private function slugOf($s) { return trim(preg_replace('/-+/', '-', preg_replace('/[^a-z0-9\-_]+/', '-', strtolower(trim((string) $s)))), '-'); }

  /** The worksheet part for a sheet name (or the first sheet). */
  private function sheetPath($parts, $wanted) {
    preg_match_all('/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/', $parts['xl/workbook.xml'] ?? '', $mm, PREG_SET_ORDER);
    $sheets = array_map(function ($m) { return ['name' => $this->unxml($m[1]), 'rid' => $m[2]]; }, $mm);
    $i = 0;
    if ($wanted) { $i = -1; foreach ($sheets as $k => $s) { if ($s['name'] === $wanted) { $i = $k; break; } } if ($i < 0) { return null; } }
    if (isset($sheets[$i]) && preg_match('/<Relationship\b[^>]*Id="' . preg_quote($sheets[$i]['rid'], '/') . '"[^>]*Target="([^"]+)"/', $parts['xl/_rels/workbook.xml.rels'] ?? '', $rel)) { return 'xl/' . preg_replace('/^\/?xl\//', '', $rel[1]); }
    return 'xl/worksheets/sheet' . ($i + 1) . '.xml';
  }

  /** Rows as arrays of strings. */
  private function rows($parts, $path) {
    preg_match_all('/<si>([\s\S]*?)<\/si>/', $parts['xl/sharedStrings.xml'] ?? '', $si);
    $shared = array_map(function ($x) { preg_match_all('/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/', $x, $t); return $this->unxml(implode('', $t[1])); }, $si[1]);
    preg_match_all('/<row\b[^>]*>([\s\S]*?)<\/row>/', $parts[$path] ?? '', $rr);
    $out = [];
    foreach ($rr[1] as $r) {
      $row = [];
      preg_match_all('/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/', $r, $cc, PREG_SET_ORDER);
      foreach ($cc as $c) {
        $ref = preg_match('/r="([A-Z]+\d+)"/', $c[1], $m) ? $m[1] : null;
        $type = preg_match('/t="([^"]+)"/', $c[1], $m) ? $m[1] : null;
        $inner = $c[2] ?? '';
        $v = preg_match('/<v>([\s\S]*?)<\/v>/', $inner, $m) ? $m[1] : null;
        $inline = preg_match('/<is>[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/', $inner, $m) ? $m[1] : '';
        $val = $type === 's' ? ($shared[(int) $v] ?? '') : ($type === 'inlineStr' ? $this->unxml($inline) : $this->unxml($v ?? ''));
        $row[$ref ? $this->col($ref) : count($row)] = $val;
      }
      $dense = [];
      $max = $row ? max(array_keys($row)) : -1;
      for ($i = 0; $i <= $max; $i++) { $dense[] = $row[$i] ?? ''; }
      $out[] = $dense;
    }
    return $out;
  }

  private function sheetToItems($parts, $sheet) {
    $path = $this->sheetPath($parts, $sheet);
    if (!$path || !isset($parts[$path])) { return ['error' => $sheet ? "no sheet named \"$sheet\"" : 'no sheets found in this file']; }
    $all = array_values(array_filter($this->rows($parts, $path), function ($r) { foreach ($r as $c) { if (trim((string) $c) !== '') { return true; } } return false; }));
    if (!$all) { return ['error' => 'the spreadsheet is empty']; }
    $head = [];
    foreach ($all[0] as $i => $h) { $k = preg_replace('/\s+/', '', strtolower(trim((string) $h))); if (in_array($k, ['title', 'slug', 'parent', 'content'], true)) { $head[$k] = $i; } }
    if (!isset($head['title']) || !isset($head['slug'])) { return ['error' => 'the first row must name the columns title and slug (parent and content are optional)']; }
    $items = []; $bySlug = [];
    for ($i = 1; $i < count($all); $i++) {
      $r = $all[$i]; $n = $i + 1;
      $title = trim((string) ($r[$head['title']] ?? '')); $slug = $this->slugOf($r[$head['slug']] ?? '');
      if ($title === '') { return ['error' => "row $n: title is required"]; }
      if ($slug === '') { return ['error' => "row $n: slug is required"]; }
      if (isset($bySlug[$slug])) { return ['error' => "row $n: duplicate slug \"$slug\" (already used on row " . $bySlug[$slug]['row'] . ')']; }
      $items[] = ['id' => 'item-' . (count($items) + 1), 'title' => $title, 'slug' => $slug, 'parent' => null, 'order' => count($items), 'indent' => 0,
        'content' => isset($head['content']) ? (string) ($r[$head['content']] ?? '') : '', 'parentSlug' => $this->slugOf(isset($head['parent']) ? ($r[$head['parent']] ?? '') : '')];
      $bySlug[$slug] = ['index' => count($items) - 1, 'row' => $n];
    }
    foreach ($items as &$it) {
      if ($it['parentSlug'] !== '' && isset($bySlug[$it['parentSlug']])) { $it['parent'] = $items[$bySlug[$it['parentSlug']]['index']]['id']; $it['indent'] = 1; }
      unset($it['parentSlug']);
    }
    unset($it);
    return ['items' => $items];
  }

  /**
   * Implements contract import.file, operation convert (dispatch: accepts .xlsx).
   *
   * Reads one sheet (input sheet, else the first) whose header row names title and slug (parent and content are
   * optional) and returns the page tree as items; parents are matched by slug. Stops at the first bad row with its
   * row number, as core does today.
   *
   * @param object $ctx    Platform context (spec/13); uses $ctx->archive->read().
   * @param array  $input  [name, data (base64), sheet?].
   * @return array  [items] or [error].
   */
  public function importFileConvert($ctx, $input) {
    try { $parts = $ctx->archive->read($input['data'] ?? '', ['match' => self::PARTS]); }
    catch (Exception $e) { return ['error' => 'not an .xlsx file (' . $e->getMessage() . ')']; }
    return $this->sheetToItems($parts, $input['sheet'] ?? null);
  }
}

<?php
// A chosen importer: one page per uploaded text file, titled by the file name (mirrors src/nodejs/index.js).
class FxChooserPlugin {
  public function importPlatformConvert($ctx, $input) {
    $files = (is_array($input) && isset($input['files']) && is_array($input['files'])) ? $input['files'] : [];
    if (!$files) {
      return ['error' => 'upload a .txt file'];
    }
    $items = [];
    foreach (array_values($files) as $i => $f) {
      $items[] = ['id' => 'item-' . ($i + 1), 'title' => preg_replace('/\.txt$/', '', (string) $f['name']), 'slug' => 'page-' . ($i + 1), 'parent' => null, 'order' => $i, 'content' => '<p>' . base64_decode((string) $f['data']) . '</p>'];
    }
    return ['title' => 'Chosen', 'items' => $items];
  }
}

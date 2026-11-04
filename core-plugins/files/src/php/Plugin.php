<?php
// Files (PHP). Mirrors src/nodejs/index.js.
class FilesPlugin {
  const ALLOWED = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'webm', 'mp4', 'mp3', 'mov', 'csv', 'ppt', 'pptx', 'xlsx', 'xls', 'doc', 'docx', 'pdf', 'rtf', 'txt', 'vtt', 'xml'];
  const MIME = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp', 'svg' => 'image/svg+xml', 'pdf' => 'application/pdf', 'txt' => 'text/plain', 'mp4' => 'video/mp4', 'mp3' => 'audio/mpeg'];
  private function safeName($n) { return substr(ltrim(preg_replace('/[^a-z0-9._-]+/', '-', strtolower((string) $n)), '-.'), 0, 120); }

  /**
   * Implements operation filesList.
   *
   * Lists the site's files sorted by name, optionally filtered by part of the name, for the editor's Local files browser.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  query.name: optional filter (lower-case substring of the file name).
   * @return array  [items, total].
   */
  public function filesList($ctx, $req) {
    $q = strtolower((string) ($req['query']['name'] ?? ''));
    $items = array_values(array_filter($ctx->entities->list('file'), function ($f) use ($q) { return $q === '' || strpos($f['name'], $q) !== false; }));
    usort($items, function ($a, $b) { return strcmp($a['name'], $b['name']); });
    return ['items' => $items, 'total' => count($items)];
  }

  /**
   * Implements operation filesUpload.
   *
   * Stores an upload under files/ with the same rules as core today: allowed extensions only, a safe lower-case name and the maxUploadMb limit. The file record is saved through $ctx->entities, so file.before.save and file.after.save fire; a veto removes the stored bytes and returns 409.
   *
   * @param object $ctx  Platform context (spec/13); settings.maxUploadMb (default 50).
   * @param array  $req  body: [name, data (base64), alt].
   * @return array  the saved file record, or [status, body => [error]].
   */
  public function filesUpload($ctx, $req) {
    $name = $this->safeName($req['body']['name'] ?? '');
    $ext = strpos($name, '.') !== false ? substr($name, strrpos($name, '.') + 1) : '';
    if ($name === '' || !in_array($ext, self::ALLOWED, true)) { return ['status' => 400, 'body' => ['error' => 'files of type .' . ($ext ?: '?') . ' are not allowed']]; }
    $bytes = base64_decode((string) ($req['body']['data'] ?? ''), true) ?: '';
    if (strlen($bytes) > ((float) ($ctx->settings['maxUploadMb'] ?? 50) ?: 50) * 1024 * 1024) { return ['status' => 400, 'body' => ['error' => 'file is too large']]; }
    $uuid = 'file-' . (count($ctx->entities->list('file')) + 1);
    $record = ['uuid' => $uuid, 'id' => $uuid, 'name' => $name, 'path' => "files/$name", 'url' => "files/$name", 'mimeType' => self::MIME[$ext] ?? 'application/octet-stream', 'size' => strlen($bytes), 'alt' => $req['body']['alt'] ?? ''];
    $ctx->files->put($record['path'], base64_encode($bytes));
    $r = $ctx->entities->save('file', $record); // file.before.save / file.after.save fire here
    if (!empty($r['veto'])) { $ctx->files->remove($record['path']); return ['status' => 409, 'body' => ['error' => $r['veto']['message']]]; }
    return $r['record'];
  }

  /**
   * Implements operation filesDelete.
   *
   * Deletes a file record (file.before.delete can veto with 409) and then its bytes under files/.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  params.uuid: the file to delete.
   * @return array  [deleted => uuid], or [status, body => [error]] (404 when unknown).
   */
  public function filesDelete($ctx, $req) {
    $f = $ctx->entities->get('file', $req['params']['uuid']);
    if (!$f) { return ['status' => 404, 'body' => ['error' => 'not found']]; }
    $r = $ctx->entities->delete('file', $f['id']);
    if (!empty($r['veto'])) { return ['status' => 409, 'body' => ['error' => $r['veto']['message']]]; }
    $ctx->files->remove($f['path']);
    return ['deleted' => $f['uuid']];
  }
}

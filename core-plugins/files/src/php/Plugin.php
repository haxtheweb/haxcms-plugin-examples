<?php
// Files (PHP). Mirrors src/nodejs/index.js.
class FilesPlugin {
  const ALLOWED = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'webm', 'mp4', 'mp3', 'mov', 'csv', 'ppt', 'pptx', 'xlsx', 'xls', 'doc', 'docx', 'pdf', 'rtf', 'txt', 'vtt', 'xml'];
  const MIME = ['jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'webp' => 'image/webp', 'svg' => 'image/svg+xml', 'pdf' => 'application/pdf', 'txt' => 'text/plain', 'mp4' => 'video/mp4', 'mp3' => 'audio/mpeg'];
  private function safeName($n) { return substr(ltrim(preg_replace('/[^a-z0-9._-]+/', '-', strtolower((string) $n)), '-.'), 0, 120); }

  public function filesList($ctx, $req) {
    $q = strtolower((string) ($req['query']['name'] ?? ''));
    $items = array_values(array_filter($ctx->entities->list('file'), function ($f) use ($q) { return $q === '' || strpos($f['name'], $q) !== false; }));
    usort($items, function ($a, $b) { return strcmp($a['name'], $b['name']); });
    return ['items' => $items, 'total' => count($items)];
  }

  public function filesUpload($ctx, $req) {
    $name = $this->safeName($req['body']['name'] ?? '');
    $ext = strpos($name, '.') !== false ? substr($name, strrpos($name, '.') + 1) : '';
    if ($name === '' || !in_array($ext, self::ALLOWED, true)) { return ['status' => 400, 'body' => ['error' => 'files of type .' . ($ext ?: '?') . ' are not allowed']]; }
    $bytes = base64_decode((string) ($req['body']['data'] ?? ''), true) ?: '';
    if (strlen($bytes) > ((float) ($ctx->settings['maxUploadMb'] ?? 50) ?: 50) * 1024 * 1024) { return ['status' => 400, 'body' => ['error' => 'file is too large']]; }
    $uuid = 'file-' . (count($ctx->entities->list('file')) + 1);
    $record = ['uuid' => $uuid, 'id' => $uuid, 'name' => $name, 'path' => "files/$name", 'url' => "files/$name", 'mimeType' => self::MIME[$ext] ?? 'application/octet-stream', 'size' => strlen($bytes), 'alt' => $req['body']['alt'] ?? ''];
    $ctx->files->put($record['path'], base64_encode($bytes));
    $ctx->entities->save('file', $record);
    return $record;
  }

  public function filesDelete($ctx, $req) {
    $f = $ctx->entities->get('file', $req['params']['uuid']);
    if (!$f) { return ['status' => 404, 'body' => ['error' => 'not found']]; }
    $ctx->entities->delete('file', $f['id']);
    $ctx->files->remove($f['path']);
    return ['deleted' => $f['uuid']];
  }
}

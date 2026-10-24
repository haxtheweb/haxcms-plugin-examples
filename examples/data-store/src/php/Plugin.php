<?php
// Data store example (PHP). Mirrors src/nodejs/index.js.
class DataStorePlugin {
  private function legacyVotes($ctx) {
    $site = $ctx->entities->get('site');
    return $site['metadata']['plugins']['data-store']['votes'] ?? null;
  }

  public function dataStoreListVotes($ctx, $req) {
    return $ctx->storage->read('votes') ?: ($this->legacyVotes($ctx) ?: new stdClass());
  }

  public function dataStoreVote($ctx, $req) {
    $votes = $ctx->storage->read('votes') ?: [];
    $page = $req['params']['pageId'];
    $votes[$page] = ($votes[$page] ?? 0) + 1;
    $ctx->storage->write('votes', $votes);
    return ['pageId' => $page, 'votes' => $votes[$page]];
  }

  public function dataStoreCreateNote($ctx, $req) {
    if (!$ctx->user) { return ['status' => 401, 'body' => ['error' => 'sign in to write notes']]; }
    $notes = $ctx->storage->read('notes') ?: [];
    $note = ['uuid' => 'note-' . (count($notes) + 1), 'userId' => $ctx->user['id'], 'body' => (string) ($req['body']['body'] ?? '')];
    $notes[] = $note;
    $ctx->storage->write('notes', $notes);
    return $note;
  }

  public function dataStoreGetNote($ctx, $req) {
    foreach ($ctx->storage->read('notes') ?: [] as $note) {
      if ($note['uuid'] === $req['params']['uuid']) {
        if (!$ctx->user || $note['userId'] !== $ctx->user['id']) { return ['status' => 403, 'body' => ['error' => 'not your note']]; }
        return $note;
      }
    }
    return ['status' => 404, 'body' => ['error' => 'not found']];
  }

  public function dataStoreGetBadge($ctx, $req) {
    return $ctx->storage->read('badge') ?: ['label' => null];
  }

  public function dataStoreSetBadge($ctx, $req) {
    $badge = ['label' => (string) ($req['body']['label'] ?? '')];
    $ctx->storage->write('badge', $badge);
    return $badge;
  }

  // Upgrade step 0.2.0 (spec/13). Recipe: migrations/0002-move-votes.md
  public function upgrade_0_2_0($ctx) {
    $old = $this->legacyVotes($ctx);
    if (!$old) { return; }
    $current = $ctx->storage->read('votes') ?: [];
    foreach ($old as $page => $n) { $current[$page] = ($current[$page] ?? 0) + $n; }
    $ctx->storage->write('votes', $current);
    $site = $ctx->entities->get('site');
    unset($site['metadata']['plugins']['data-store']['votes']);
    $ctx->entities->save('site', $site);
    $ctx->log->info('moved votes for ' . count($old) . ' pages out of site.json');
  }
}

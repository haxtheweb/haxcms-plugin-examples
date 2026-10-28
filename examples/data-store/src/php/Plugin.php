<?php
// Data store example (PHP). Mirrors src/nodejs/index.js.
class DataStorePlugin {
  private function legacyVotes($ctx) {
    $site = $ctx->entities->get('site');
    return $site['metadata']['plugins']['data-store']['votes'] ?? null;
  }

  /**
   * Implements operation dataStoreListVotes.
   *
   * Returns the vote count per page from the votes site store, falling back to the 0.1.0 location in site.json so a
   * site whose upgrade has not run still shows its votes.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  unused.
   * @return array|object  [pageId => count].
   */
  public function dataStoreListVotes($ctx, $req) {
    return $ctx->storage->read('votes') ?: ($this->legacyVotes($ctx) ?: new stdClass());
  }

  /**
   * Implements operation dataStoreVote.
   *
   * Adds one vote for a page in the votes site store, which travels with the site.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  params.pageId.
   * @return array  [pageId, votes].
   */
  public function dataStoreVote($ctx, $req) {
    $votes = $ctx->storage->read('votes') ?: [];
    $page = $req['params']['pageId'];
    $votes[$page] = ($votes[$page] ?? 0) + 1;
    $ctx->storage->write('votes', $votes);
    return ['pageId' => $page, 'votes' => $votes[$page]];
  }

  /**
   * Implements operation dataStoreCreateNote.
   *
   * Saves a note owned by the signed-in user in the notes siteData store, which core exports and erases by userId.
   *
   * @param object $ctx  Platform context (spec/13); user is the caller.
   * @param array  $req  body.body: the note text.
   * @return array  the note [uuid, userId, body], or 401 when nobody is signed in.
   */
  public function dataStoreCreateNote($ctx, $req) {
    if (!$ctx->user) { return ['status' => 401, 'body' => ['error' => 'sign in to write notes']]; }
    $notes = $ctx->storage->read('notes') ?: [];
    $note = ['uuid' => 'note-' . (count($notes) + 1), 'userId' => $ctx->user['id'], 'body' => (string) ($req['body']['body'] ?? '')];
    $notes[] = $note;
    $ctx->storage->write('notes', $notes);
    return $note;
  }

  /**
   * Implements operation dataStoreGetNote.
   *
   * Returns one note, only to the user who owns it.
   *
   * @param object $ctx  Platform context (spec/13); user is the caller.
   * @param array  $req  params.uuid.
   * @return array  the note, 404 when it does not exist, or 403 when the caller does not own it.
   */
  public function dataStoreGetNote($ctx, $req) {
    foreach ($ctx->storage->read('notes') ?: [] as $note) {
      if ($note['uuid'] === $req['params']['uuid']) {
        if (!$ctx->user || $note['userId'] !== $ctx->user['id']) { return ['status' => 403, 'body' => ['error' => 'not your note']]; }
        return $note;
      }
    }
    return ['status' => 404, 'body' => ['error' => 'not found']];
  }

  /**
   * Implements operation dataStoreGetBadge.
   *
   * Returns the site's badge from the manifest store, which lives inside site.json.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  unused.
   * @return array  [label], label null when none is set.
   */
  public function dataStoreGetBadge($ctx, $req) {
    return $ctx->storage->read('badge') ?: ['label' => null];
  }

  /**
   * Implements operation dataStoreSetBadge.
   *
   * Sets the site's badge in the manifest store, so it is published inside site.json.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  body.label.
   * @return array  [label].
   */
  public function dataStoreSetBadge($ctx, $req) {
    $badge = ['label' => (string) ($req['body']['label'] ?? '')];
    $ctx->storage->write('badge', $badge);
    return $badge;
  }

  /**
   * Implements upgrade 0.2.0.
   *
   * Moves the votes 0.1.0 kept in site.json (metadata.plugins.data-store.votes) into the votes site store, adding them
   * to any votes already there. Recipe: migrations/0002-move-votes.md.
   *
   * @param object $ctx  Platform context (spec/13).
   * @return void
   */
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

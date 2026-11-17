<?php
// Counts in a store, to show what ctx.storage.update is for (mirrors src/nodejs/index.js). PHP runs one step at a
// time inside a request, so the burst is a loop; the lock matters between requests.
class FxTallyPlugin {
  /**
   * Implements operation fxTallyBurst.
   *
   * Adds one to the tally twenty times through $ctx->storage->update; every one counts.
   *
   * @param object $ctx
   * @return array  [n] after the burst.
   */
  public function fxTallyBurst($ctx) {
    for ($i = 0; $i < 20; $i++) {
      $ctx->storage->update('tally', function ($v) { return ['n' => (($v['n'] ?? 0) + 1)]; });
    }
    return $ctx->storage->read('tally');
  }
  /**
   * Implements operation fxTallyCareless.
   *
   * The same burst with a read followed by a write.
   *
   * @param object $ctx
   * @return array  [n] after the burst.
   */
  public function fxTallyCareless($ctx) {
    $ctx->storage->write('tally', ['n' => 0]);
    for ($i = 0; $i < 20; $i++) {
      $v = $ctx->storage->read('tally');
      $ctx->storage->write('tally', ['n' => $v['n'] + 1]);
    }
    return $ctx->storage->read('tally');
  }
  /**
   * Implements operation fxTallyVote.
   *
   * A public vote, limited to three a minute for one caller.
   *
   * @param object $ctx
   * @return array  [n] after the vote.
   */
  public function fxTallyVote($ctx) {
    return $ctx->storage->update('tally', function ($v) { return ['n' => (($v['n'] ?? 0) + 1)]; });
  }
}

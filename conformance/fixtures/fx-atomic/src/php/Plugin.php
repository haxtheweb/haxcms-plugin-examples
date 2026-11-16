<?php
// Atomic transaction probe (mirrors src/nodejs/index.js)
class FxAtomicPlugin {
  // Saves body.pages one by one (and a file when body.file is set); body.failAt throws and body.vetoAt vetoes
  // before that index. fxAtomicSaveAll is atomic, fxAtomicPlain is not, fxAtomicRun opens an atomic transaction.
  private function saveAll($ctx, $body) {
    if (!empty($body['file'])) { $ctx->files->put($body['file'], base64_encode('written')); }
    foreach (($body['pages'] ?? []) as $i => $page) {
      if (($body['failAt'] ?? null) === $i) { throw new Exception("fx-atomic failed at $i"); }
      if (($body['vetoAt'] ?? null) === $i) { return $ctx->veto("fx-atomic refused page $i", 422); }
      $ctx->entities->save('page', $page);
    }
    return ['saved' => count($body['pages'] ?? [])];
  }
  public function fxAtomicSaveAll($ctx, $req) { return $this->saveAll($ctx, $req['body']); }
  public function fxAtomicPlain($ctx, $req) { return $this->saveAll($ctx, $req['body']); }
  public function fxAtomicRun($ctx, $req) {
    try {
      return $ctx->runTransaction(function () use ($ctx, $req) { return $this->saveAll($ctx, $req['body']); }, ['bulk' => true, 'atomic' => true, 'origin' => 'fx-atomic']);
    } catch (\Throwable $e) { return ['status' => 409, 'body' => ['error' => $e->getMessage()]]; }
  }
}

<?php
// Runs the command named in the path, to show that only listed commands run (mirrors src/nodejs/index.js)
class FxExecPlugin {
  public function fxExecRun($ctx, $req) {
    try { $r = $ctx->exec($req['params']['cmd'], ['hi'], ['files' => ['secret' => ['content' => 's']]]); return ['code' => $r['code'], 'stdout' => $r['stdout']]; }
    catch (\Throwable $e) { return ['status' => 403, 'body' => ['error' => $e->getMessage()]]; }
  }
}

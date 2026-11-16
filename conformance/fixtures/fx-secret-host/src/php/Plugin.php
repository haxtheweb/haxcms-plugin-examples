<?php
// Sends a request to the named host, with the secret key in a header when withKey=1 (mirrors src/nodejs/index.js)
class FxSecretHostPlugin {
  /**
   * Implements operation fxSecretHostSend.
   *
   * Fetches https://<host>/x, carrying the key as a bearer token when asked.
   *
   * @param object $ctx
   * @param array $req  query { host, withKey }.
   * @return array  [answered => status] of the answer, or 502 with the refusal.
   */
  public function fxSecretHostSend($ctx, $req) {
    $headers = ($req['query']['withKey'] ?? '') === '1' ? ['authorization' => 'Bearer ' . $ctx->settings['key']] : [];
    try {
      $res = $ctx->fetch('https://' . $req['query']['host'] . '/x', ['headers' => $headers]);
      return ['answered' => $res['status']];
    } catch (\Throwable $e) {
      return ['status' => 502, 'body' => ['error' => $e->getMessage()]];
    }
  }
}

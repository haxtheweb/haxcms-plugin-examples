<?php
// Demo resource (test fixture, PHP). Mirrors src/nodejs/index.js.
class DemoResourcePlugin {
  /**
   * Implements contract oauth.resource, operation describe.
   *
   * Offers demo:read and demo:write for https://resource.example/api.
   *
   * @param object $ctx    Platform context (spec/13).
   * @param array  $input  Unused.
   * @return array  [resource, title, scopes].
   */
  public function oauthResourceDescribe($ctx, $input) {
    return ['resource' => 'https://resource.example/api', 'title' => 'Demo resource', 'scopes' => [['scope' => 'demo:read', 'title' => 'Read', 'description' => 'Read things', 'write' => false], ['scope' => 'demo:write', 'title' => 'Write', 'description' => 'Change things', 'write' => true]]];
  }

  /**
   * Implements contract oauth.resource, operation check.
   *
   * Allows GET with demo:read and anything else with demo:write.
   *
   * @param object $ctx    Platform context (spec/13).
   * @param array  $input  [grant, request].
   * @return array  [allow] and a message when refused.
   */
  public function oauthResourceCheck($ctx, $input) {
    $need = ($input['request']['method'] ?? '') === 'GET' ? 'demo:read' : 'demo:write';
    return in_array($need, $input['grant']['scopes'] ?? [], true) ? ['allow' => true] : ['allow' => false, 'message' => 'needs ' . $need];
  }

  /**
   * Implements operation demoResourceRead.
   *
   * Echoes the grant the oauth plugin passed on, so cases can see it.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  headers[x-hax-oauth-grant].
   * @return array  [grant].
   */
  public function demoResourceRead($ctx, $req) {
    return ['grant' => json_decode((string) ($req['headers']['x-hax-oauth-grant'] ?? 'null'), true)];
  }

  /**
   * Implements operation demoResourceWrite.
   *
   * Answers ok; reaching it at all is what cases check.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  Unused.
   * @return array  [ok].
   */
  public function demoResourceWrite($ctx, $req) {
    return ['ok' => true];
  }
}

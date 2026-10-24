<?php
// MCP access (PHP). Mirrors src/nodejs/index.js.
class McpPlugin {
  const HEADER = 'x-hax-mcp-token';
  private function hash($t) { return hash('sha256', (string) $t); }
  private function findToken($ctx, $raw) {
    if (!$raw) { return null; }
    foreach ($ctx->storage->read('tokens') ?: [] as $t) {
      if ($t['hash'] === $this->hash($raw)) {
        if (!empty($t['revoked']) || (!empty($t['expires']) && $t['expires'] < $ctx->now())) { return null; }
        return $t;
      }
    }
    return null;
  }
  private function allowed($t, $op) {
    return (empty($t['plugins']) || in_array($op['plugin'], $t['plugins'], true)) && (empty($t['readOnly']) || $op['method'] === 'GET') && !empty($op['mcp']);
  }

  /**
   * Implements operation mcpTokenCreate.
   *
   * Issues a new MCP token, scoped to a site, a list of plugins and read-only or not, and stores only its hash; the raw token is returned once.
   *
   * @param object $ctx  Platform context (spec/13); settings.readOnlyDefault.
   * @param array  $req  body: [label, site, readOnly, plugins, expiresInDays].
   * @return array  [id, token, readOnly, plugins, site].
   */
  public function mcpTokenCreate($ctx, $req) {
    $b = $req['body'] ?? [];
    $token = 'hax_mcp_' . bin2hex(random_bytes(24));
    $record = ['id' => 'tok-' . bin2hex(random_bytes(4)), 'label' => (string) ($b['label'] ?? ''), 'site' => $b['site'] ?? null, 'readOnly' => $b['readOnly'] ?? (($ctx->settings['readOnlyDefault'] ?? true) !== false), 'plugins' => $b['plugins'] ?? [], 'expires' => !empty($b['expiresInDays']) ? $ctx->now() + $b['expiresInDays'] * 86400000 : null, 'hash' => $this->hash($token)];
    $tokens = $ctx->storage->read('tokens') ?: [];
    $tokens[] = $record;
    $ctx->storage->write('tokens', $tokens);
    return ['id' => $record['id'], 'token' => $token, 'readOnly' => $record['readOnly'], 'plugins' => $record['plugins'], 'site' => $record['site']];
  }

  /**
   * Implements operation mcpTokenList.
   *
   * Lists the tokens that are not revoked, without their hashes.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  Unused.
   * @return array  [items].
   */
  public function mcpTokenList($ctx, $req) {
    $items = [];
    foreach ($ctx->storage->read('tokens') ?: [] as $t) { if (empty($t['revoked'])) { unset($t['hash']); $items[] = $t; } }
    return ['items' => $items];
  }

  /**
   * Implements operation mcpTokenRevoke.
   *
   * Marks a token revoked so later calls carrying it are refused.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  params.id: the token id.
   * @return array  [revoked => id], or [status => 404, body => [error]].
   */
  public function mcpTokenRevoke($ctx, $req) {
    $tokens = $ctx->storage->read('tokens') ?: [];
    foreach ($tokens as $i => $t) {
      if ($t['id'] === $req['params']['id'] && empty($t['revoked'])) { $tokens[$i]['revoked'] = true; $ctx->storage->write('tokens', $tokens); return ['revoked' => $t['id']]; }
    }
    return ['status' => 404, 'body' => ['error' => 'not found']];
  }

  /**
   * Implements operation mcpDiscovery.
   *
   * Tells an MCP client what its token may use: the MCP-enabled operations and prompts inside the token's plugin and read-only scope.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  headers[x-hax-mcp-token]: the raw token.
   * @return array  [site, readOnly, operations, prompts], or [status => 401, body => [error]].
   */
  public function mcpDiscovery($ctx, $req) {
    $t = $this->findToken($ctx, $req['headers'][self::HEADER] ?? null);
    if (!$t) { return ['status' => 401, 'body' => ['error' => 'missing, unknown, revoked or expired MCP token']]; }
    $ops = [];
    foreach ($ctx->plugins->operations(['mcp' => true]) as $op) { if ($this->allowed($t, $op)) { $ops[] = ['plugin' => $op['plugin'], 'operationId' => $op['operationId'], 'method' => $op['method'], 'path' => $op['path'], 'summary' => $op['summary']]; } }
    $prompts = [];
    foreach ($ctx->plugins->prompts() as $p) {
      if (($p['mcp'] ?? true) !== false && (empty($t['plugins']) || in_array($p['plugin'], $t['plugins'], true))) { $prompts[] = ['plugin' => $p['plugin'], 'id' => $p['id'], 'title' => $p['title'], 'prompt' => $p['prompt']]; }
    }
    return ['site' => $t['site'], 'readOnly' => $t['readOnly'], 'operations' => $ops, 'prompts' => $prompts];
  }

  /**
   * Implements hook rest.before.request.
   *
   * Every call carrying an MCP token must have a valid token and stay inside its scope; otherwise the call is vetoed with 401 or 403. Calls without the header, and mcpDiscovery itself, pass through.
   *
   * @param object $ctx  subject: the incoming request [headers, operationId].
   * @return mixed  null, or a veto.
   */
  public function restBeforeRequest($ctx) {
    $raw = $ctx->subject['headers'][self::HEADER] ?? null;
    if (!$raw || ($ctx->subject['operationId'] ?? '') === 'mcpDiscovery') { return null; }
    $t = $this->findToken($ctx, $raw);
    if (!$t) { return $ctx->veto('missing, unknown, revoked or expired MCP token', 401); }
    foreach ($ctx->plugins->operations([]) as $op) {
      if ($op['operationId'] === $ctx->subject['operationId']) { return $this->allowed($t, $op) ? null : $ctx->veto("this MCP token may not call {$ctx->subject['operationId']}", 403); }
    }
    return $ctx->veto("this MCP token may not call {$ctx->subject['operationId']}", 403);
  }

}

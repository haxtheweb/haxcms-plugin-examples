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

  public function mcpTokenCreate($ctx, $req) {
    $b = $req['body'] ?? [];
    $token = 'hax_mcp_' . bin2hex(random_bytes(24));
    $record = ['id' => 'tok-' . bin2hex(random_bytes(4)), 'label' => (string) ($b['label'] ?? ''), 'site' => $b['site'] ?? null, 'readOnly' => $b['readOnly'] ?? (($ctx->settings['readOnlyDefault'] ?? true) !== false), 'plugins' => $b['plugins'] ?? [], 'expires' => !empty($b['expiresInDays']) ? $ctx->now() + $b['expiresInDays'] * 86400000 : null, 'hash' => $this->hash($token)];
    $tokens = $ctx->storage->read('tokens') ?: [];
    $tokens[] = $record;
    $ctx->storage->write('tokens', $tokens);
    return ['id' => $record['id'], 'token' => $token, 'readOnly' => $record['readOnly'], 'plugins' => $record['plugins'], 'site' => $record['site']];
  }

  public function mcpTokenList($ctx, $req) {
    $items = [];
    foreach ($ctx->storage->read('tokens') ?: [] as $t) { if (empty($t['revoked'])) { unset($t['hash']); $items[] = $t; } }
    return ['items' => $items];
  }

  public function mcpTokenRevoke($ctx, $req) {
    $tokens = $ctx->storage->read('tokens') ?: [];
    foreach ($tokens as $i => $t) {
      if ($t['id'] === $req['params']['id'] && empty($t['revoked'])) { $tokens[$i]['revoked'] = true; $ctx->storage->write('tokens', $tokens); return ['revoked' => $t['id']]; }
    }
    return ['status' => 404, 'body' => ['error' => 'not found']];
  }

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

  // hook: rest.before.request
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

<?php
// MCP access (PHP). Mirrors src/nodejs/index.js.
// Tokens come from the oauth plugin: this plugin only says what an MCP token is for (describe) and what it may call
// (check). The oauth plugin verifies the token and passes the grant on in the x-hax-oauth-grant header.
class McpPlugin {
  const GRANT_HEADER = 'x-hax-oauth-grant';
  const READ = 'mcp:read';
  const WRITE = 'mcp:write';

  private function writesAllowed($ctx) { return ($ctx->settings['readOnly'] ?? true) === false; }
  private function isWrite($method) { return strtoupper((string) ($method ?: 'GET')) !== 'GET'; }

  /** The grant the oauth plugin verified for this request, or null (it removes any copy a client sends). */
  private function grantOf($ctx, $req) {
    $g = json_decode((string) ($req['headers'][self::GRANT_HEADER] ?? 'null'), true);
    if (!is_array($g) || ($g['resource'] ?? null) !== ($ctx->settings['serverUrl'] ?? null) || !in_array(self::READ, $g['scopes'] ?? [], true)) { return null; }
    return $g;
  }

  /**
   * Implements contract oauth.resource, operation describe.
   *
   * Names the haxcms-mcp server URL as the audience tokens are issued for, with mcp:read always and mcp:write only when this instance allows writes.
   *
   * @param object $ctx    Platform context (spec/13); settings.serverUrl, readOnly.
   * @param array  $input  Unused.
   * @return array  [resource, title, scopes], or [error] when the server URL is not set.
   */
  public function oauthResourceDescribe($ctx, $input) {
    if (empty($ctx->settings['serverUrl'])) { return ['error' => 'serverUrl is not set']; }
    $scopes = [['scope' => self::READ, 'title' => 'Read your sites', 'description' => 'See your sites, pages, files and settings, as you can', 'write' => false]];
    if ($this->writesAllowed($ctx)) { $scopes[] = ['scope' => self::WRITE, 'title' => 'Change your sites', 'description' => 'Create, edit and delete pages, files and sites, as you can', 'write' => true]; }
    return ['resource' => $ctx->settings['serverUrl'], 'title' => 'MCP (AI agents)', 'scopes' => $scopes];
  }

  /**
   * Implements contract oauth.resource, operation check.
   *
   * Decides what an MCP token may call: reads need mcp:read; writes need mcp:write and an instance that allows writes; a plugin operation must be marked x-hax-mcp; a token bound to a site stays on that site.
   *
   * @param object $ctx    Platform context (spec/13); settings.readOnly; site.
   * @param array  $input  [grant => [scopes, site], request => [operationId, method, path, plugin]].
   * @return array  [allow => true] or [allow => false, message].
   */
  public function oauthResourceCheck($ctx, $input) {
    $g = $input['grant'] ?? [];
    $r = $input['request'] ?? [];
    $scopes = $g['scopes'] ?? [];
    if (!in_array(self::READ, $scopes, true)) { return ['allow' => false, 'message' => 'this token has no mcp:read scope']; }
    if (($r['operationId'] ?? null) === 'mcpDiscovery') { return ['allow' => true]; }
    if ($this->isWrite($r['method'] ?? null) && !($this->writesAllowed($ctx) && in_array(self::WRITE, $scopes, true))) { return ['allow' => false, 'message' => 'this MCP token is read-only']; }
    if (!empty($r['plugin'])) {
      $op = null;
      foreach ($ctx->plugins->operations([]) as $o) { if ($o['operationId'] === ($r['operationId'] ?? null)) { $op = $o; } }
      if (!$op || empty($op['mcp'])) { return ['allow' => false, 'message' => ($r['operationId'] ?? '') . ' is not offered to MCP']; }
    }
    $site = $ctx->site;
    if (!empty($g['site']) && $site && strpos((string) ($r['path'] ?? ''), '/x/api/') === 0 && $g['site'] !== ($site['name'] ?? null) && $g['site'] !== ($site['id'] ?? null)) { return ['allow' => false, 'message' => 'this MCP token is for the site ' . $g['site']]; }
    return ['allow' => true];
  }

  /**
   * Implements operation mcpDiscovery.
   *
   * Tells the MCP server what the calling token may use: the operations marked x-hax-mcp within its read-only state, and every plugin's prompts.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  headers[x-hax-oauth-grant]: set by the oauth plugin for a valid MCP token.
   * @return array  [site, readOnly, scopes, operations, prompts], or [status => 401, body => [error]].
   */
  public function mcpDiscovery($ctx, $req) {
    $g = $this->grantOf($ctx, $req);
    if (!$g) { return ['status' => 401, 'body' => ['error' => 'an MCP token from the oauth plugin is required']]; }
    $readOnly = !($this->writesAllowed($ctx) && in_array(self::WRITE, $g['scopes'], true));
    $ops = [];
    foreach ($ctx->plugins->operations(['mcp' => true]) as $op) {
      if (!$readOnly || !$this->isWrite($op['method'])) { $ops[] = ['plugin' => $op['plugin'], 'operationId' => $op['operationId'], 'method' => $op['method'], 'path' => $op['path'], 'summary' => $op['summary']]; }
    }
    $prompts = [];
    foreach ($ctx->plugins->prompts() as $p) {
      if (($p['mcp'] ?? true) !== false) { $prompts[] = ['plugin' => $p['plugin'], 'id' => $p['id'], 'title' => $p['title'], 'prompt' => $p['prompt']]; }
    }
    return ['site' => $g['site'] ?? null, 'readOnly' => $readOnly, 'scopes' => $g['scopes'], 'operations' => $ops, 'prompts' => $prompts];
  }
}

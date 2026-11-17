<?php
// OAuth 2.1 authorization server (PHP). Mirrors src/nodejs/index.js.
// Tokens are opaque random strings; only their SHA-256 is stored. Prefixes say what a string is:
// hax_ac_ authorization code, hax_at_ access token, hax_rt_ refresh token, hax_pt_ personal token.
class OauthPlugin {
  const GRANT_HEADER = 'x-hax-oauth-grant';

  private function hash($t) { return hash('sha256', (string) $t); }
  private function s256($v) { return rtrim(strtr(base64_encode(hash('sha256', (string) $v, true)), '+/', '-_'), '='); }
  private function rand($prefix) { return $prefix . bin2hex(random_bytes(24)); }
  private function shortId($prefix) { return $prefix . bin2hex(random_bytes(4)); }
  private function fail($status, $error, $description) { return ['status' => $status, 'body' => ['error' => $error, 'error_description' => $description]]; }
  private function read($ctx, $id) { return $ctx->storage->read($id) ?: []; }
  private function words($s) { return array_values(array_filter(preg_split('/\s+/', (string) ($s ?? '')), 'strlen')); }
  private function issuerOf($ctx) { return rtrim((string) ($ctx->settings['issuer'] ?? ''), '/'); }
  private function userId($ctx) { return $ctx->user ? ($ctx->user['id'] ?? null) : null; }
  // what a resource and the grant header may see of a grant (never hashes, never other people's data)
  private function pub($g) { return ['id' => $g['id'], 'user' => $g['user'], 'client_id' => $g['client_id'], 'resource' => $g['resource'], 'scopes' => $g['scopes'], 'site' => $g['site']]; }
  // encodeURIComponent, so both runtimes build the same redirect
  private function encode($v) { return strtr(rawurlencode((string) $v), ['%21' => '!', '%2A' => '*', '%27' => "'", '%28' => '(', '%29' => ')']); }
  private function redirectWith($uri, $params) {
    $pairs = [];
    foreach ($params as $k => $v) { if ($v !== null && $v !== '') { $pairs[] = $k . '=' . $this->encode($v); } }
    return $uri . (strpos($uri, '?') !== false ? '&' : '?') . implode('&', $pairs);
  }
  // https anywhere, http only on this machine (native and CLI clients); custom schemes are a later decision
  private function redirectAllowed($u) {
    return is_string($u) && (preg_match('#^https://[^\s/?\#]+#i', $u) || preg_match('#^http://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(/|$)#i', $u));
  }

  /** Every active plugin that implements oauth.resource, with what it describes (unconfigured ones are left out). */
  private function resources($ctx) {
    $out = [];
    foreach ($ctx->plugins->list() as $p) {
      if (!in_array('oauth.resource', $p['implements'] ?? [], true)) { continue; }
      $r = $ctx->contracts->call('oauth.resource', 'describe', (object) [], ['plugin' => $p['id']]);
      if (is_array($r) && empty($r['error']) && !empty($r['resource'])) {
        $out[] = ['plugin' => $p['id'], 'resource' => $r['resource'], 'title' => $r['title'] ?? $p['id'], 'scopes' => $r['scopes'] ?? []];
      }
    }
    return $out;
  }
  private function findResource($ctx, $uri) {
    foreach ($this->resources($ctx) as $r) { if ($r['resource'] === $uri) { return $r; } }
    return null;
  }

  /** The scopes to grant: the ones asked for, all offered by the resource, or by default every read scope. */
  private function pickScopes($resource, $requested) {
    $offered = array_map(function ($s) { return $s['scope']; }, $resource['scopes']);
    $asked = $this->words($requested);
    foreach ($asked as $s) { if (!in_array($s, $offered, true)) { return null; } }
    if ($asked) { return $asked; }
    $reads = [];
    foreach ($resource['scopes'] as $s) { if (empty($s['write'])) { $reads[] = $s['scope']; } }
    return $reads;
  }
  private function scopeList($resource) { return implode(' ', array_map(function ($s) { return $s['scope']; }, $resource['scopes'])); }

  /** Validate an authorization request (RFC 6749 4.1.1 + PKCE + RFC 8707); returns an error response or what consent shows. */
  private function checkRequest($ctx, $q) {
    if (($q['response_type'] ?? null) !== 'code') { return $this->fail(400, 'unsupported_response_type', 'only response_type=code is supported'); }
    $client = null;
    foreach ($this->read($ctx, 'clients') as $c) { if ($c['client_id'] === ($q['client_id'] ?? null)) { $client = $c; } }
    if (!$client) { return $this->fail(400, 'invalid_client', 'unknown client_id'); }
    if (!in_array($q['redirect_uri'] ?? null, $client['redirect_uris'], true)) { return $this->fail(400, 'invalid_request', 'redirect_uri is not registered for this client'); }
    if (($q['code_challenge_method'] ?? null) !== 'S256' || empty($q['code_challenge'])) { return $this->fail(400, 'invalid_request', 'PKCE with code_challenge_method=S256 is required'); }
    $resource = $this->findResource($ctx, $q['resource'] ?? null);
    if (!$resource) { return $this->fail(400, 'invalid_target', 'resource is not something this server issues tokens for'); }
    $scopes = $this->pickScopes($resource, $q['scope'] ?? null);
    if ($scopes === null) { return $this->fail(400, 'invalid_scope', 'scope must be from: ' . $this->scopeList($resource)); }
    return ['client' => $client, 'resource' => $resource, 'scopes' => $scopes];
  }

  private function issueTokens($ctx, $grant) {
    $access = $this->rand('hax_at_');
    $refresh = $this->rand('hax_rt_');
    $minutes = (int) ($ctx->settings['accessTokenMinutes'] ?? 0) ?: 60;
    $days = (int) ($ctx->settings['refreshTokenDays'] ?? 0) ?: 30;
    $tokens = $this->read($ctx, 'tokens');
    $tokens[] = ['id' => $this->shortId('tok-'), 'hash' => $this->hash($access), 'kind' => 'access', 'grant' => $grant['id'], 'expires' => $ctx->now() + $minutes * 60000, 'revoked' => false];
    $tokens[] = ['id' => $this->shortId('tok-'), 'hash' => $this->hash($refresh), 'kind' => 'refresh', 'grant' => $grant['id'], 'expires' => $ctx->now() + $days * 86400000, 'revoked' => false];
    $ctx->storage->write('tokens', $tokens);
    return ['access_token' => $access, 'token_type' => 'Bearer', 'expires_in' => $minutes * 60, 'refresh_token' => $refresh, 'scope' => implode(' ', $grant['scopes'])];
  }

  /** Revoke a grant and every token issued under it. */
  private function revokeGrant($ctx, $grantId) {
    $grants = $this->read($ctx, 'grants');
    foreach ($grants as $i => $g) { if ($g['id'] === $grantId) { $grants[$i]['revoked'] = true; } }
    $ctx->storage->write('grants', $grants);
    $tokens = $this->read($ctx, 'tokens');
    foreach ($tokens as $i => $t) { if ($t['grant'] === $grantId) { $tokens[$i]['revoked'] = true; } }
    $ctx->storage->write('tokens', $tokens);
  }
  private function liveGrant($ctx, $id) {
    foreach ($this->read($ctx, 'grants') as $g) { if ($g['id'] === $id && empty($g['revoked'])) { return $g; } }
    return null;
  }

  /**
   * Implements operation oauthMetadata.
   *
   * Publishes the authorization server metadata (RFC 8414) MCP clients read first; core also serves it at /.well-known/oauth-authorization-server.
   *
   * @param object $ctx  Platform context (spec/13); settings.issuer, dynamicRegistration.
   * @param array  $req  Unused.
   * @return array  the metadata document.
   */
  public function oauthMetadata($ctx, $req) {
    $issuer = $this->issuerOf($ctx);
    $api = $issuer . '/system/api/v1/plugins/oauth';
    $scopes = [];
    foreach ($this->resources($ctx) as $r) { foreach ($r['scopes'] as $s) { if (!in_array($s['scope'], $scopes, true)) { $scopes[] = $s['scope']; } } }
    return [
      'issuer' => $issuer,
      'authorization_endpoint' => $issuer . '/admin/oauth/authorize',
      'token_endpoint' => $api . '/token',
      'revocation_endpoint' => $api . '/revoke',
      'registration_endpoint' => ($ctx->settings['dynamicRegistration'] ?? false) === true ? $api . '/register' : null,
      'response_types_supported' => ['code'],
      'grant_types_supported' => ['authorization_code', 'refresh_token'],
      'code_challenge_methods_supported' => ['S256'],
      'token_endpoint_auth_methods_supported' => ['none'],
      'scopes_supported' => $scopes,
    ];
  }

  /**
   * Implements operation oauthAuthorizeCheck.
   *
   * Validates an authorization request and describes it for the consent screen: which app, which resource, which scopes.
   *
   * @param object $ctx  Platform context (spec/13); user is the person signed in to the dashboard.
   * @param array  $req  query: the authorization request parameters.
   * @return array  [client, resource, scopes], or a 400 [error, error_description].
   */
  public function oauthAuthorizeCheck($ctx, $req) {
    $q = $req['query'] ?? [];
    $r = $this->checkRequest($ctx, $q);
    if (isset($r['status'])) { return $r; }
    $scopes = [];
    foreach ($r['resource']['scopes'] as $s) { if (in_array($s['scope'], $r['scopes'], true)) { $scopes[] = $s; } }
    return [
      'client' => ['client_id' => $r['client']['client_id'], 'client_name' => $r['client']['client_name'], 'redirect_uri' => $q['redirect_uri']],
      'resource' => ['resource' => $r['resource']['resource'], 'title' => $r['resource']['title']],
      'scopes' => $scopes,
    ];
  }

  /**
   * Implements operation oauthAuthorizeDecide.
   *
   * Records the person's answer: on approval it stores a grant and a single-use code bound to the PKCE challenge, then returns the redirect back to the app.
   *
   * @param object $ctx  Platform context (spec/13); user approves for themselves only.
   * @param array  $req  body: the same parameters as the check, plus approve and an optional site.
   * @return array  [redirect], or a 400 [error, error_description].
   */
  public function oauthAuthorizeDecide($ctx, $req) {
    $b = $req['body'] ?? [];
    $r = $this->checkRequest($ctx, $b);
    if (isset($r['status'])) { return $r; }
    if (($b['approve'] ?? null) !== true) { return ['redirect' => $this->redirectWith($b['redirect_uri'], ['error' => 'access_denied', 'state' => $b['state'] ?? null])]; }
    $grant = ['id' => $this->shortId('grant-'), 'user' => $this->userId($ctx), 'client_id' => $r['client']['client_id'], 'client_name' => $r['client']['client_name'], 'resource' => $r['resource']['resource'], 'resourcePlugin' => $r['resource']['plugin'], 'scopes' => $r['scopes'], 'site' => $b['site'] ?? null, 'created' => $ctx->now(), 'revoked' => false];
    $grants = $this->read($ctx, 'grants');
    $grants[] = $grant;
    $ctx->storage->write('grants', $grants);
    $code = $this->rand('hax_ac_');
    $codes = [];
    foreach ($this->read($ctx, 'codes') as $c) { if ($c['expires'] > $ctx->now()) { $codes[] = $c; } }
    $codes[] = ['hash' => $this->hash($code), 'grant' => $grant['id'], 'client_id' => $grant['client_id'], 'redirect_uri' => $b['redirect_uri'], 'challenge' => $b['code_challenge'], 'expires' => $ctx->now() + 60000];
    $ctx->storage->write('codes', $codes);
    return ['redirect' => $this->redirectWith($b['redirect_uri'], ['code' => $code, 'state' => $b['state'] ?? null])];
  }

  /**
   * Implements operation oauthToken.
   *
   * Exchanges a code and its PKCE verifier, or a refresh token, for an access token and a new refresh token; a refresh token used twice revokes its whole grant.
   *
   * @param object $ctx  Platform context (spec/13); settings.accessTokenMinutes, refreshTokenDays.
   * @param array  $req  body: grant_type and its parameters.
   * @return array  [access_token, token_type, expires_in, refresh_token, scope], or a 400 [error, error_description].
   */
  public function oauthToken($ctx, $req) {
    $b = $req['body'] ?? [];
    $type = $b['grant_type'] ?? null;
    if ($type === 'authorization_code') {
      $codes = $this->read($ctx, 'codes');
      $found = null;
      foreach ($codes as $i => $c) { if ($c['hash'] === $this->hash($b['code'] ?? '')) { $found = $i; } }
      if ($found === null || $codes[$found]['expires'] < $ctx->now()) { return $this->fail(400, 'invalid_grant', 'unknown or expired code'); }
      $c = $codes[$found];
      array_splice($codes, $found, 1);
      $ctx->storage->write('codes', $codes); // single use, even when the rest fails
      if ($c['client_id'] !== ($b['client_id'] ?? null) || $c['redirect_uri'] !== ($b['redirect_uri'] ?? null)) { return $this->fail(400, 'invalid_grant', 'client_id or redirect_uri does not match the code'); }
      if ($this->s256($b['code_verifier'] ?? '') !== $c['challenge']) { return $this->fail(400, 'invalid_grant', 'code_verifier does not match the code_challenge'); }
      $grant = $this->liveGrant($ctx, $c['grant']);
      if (!$grant) { return $this->fail(400, 'invalid_grant', 'the approval was revoked'); }
      if (!empty($b['resource']) && $b['resource'] !== $grant['resource']) { return $this->fail(400, 'invalid_target', 'resource does not match the approval'); }
      return $this->issueTokens($ctx, $grant);
    }
    if ($type === 'refresh_token') {
      $tokens = $this->read($ctx, 'tokens');
      $found = null;
      foreach ($tokens as $i => $t) { if ($t['kind'] === 'refresh' && $t['hash'] === $this->hash($b['refresh_token'] ?? '')) { $found = $i; } }
      if ($found === null) { return $this->fail(400, 'invalid_grant', 'unknown refresh token'); }
      $t = $tokens[$found];
      if (!empty($t['revoked'])) {
        $this->revokeGrant($ctx, $t['grant']); // reuse of a rotated refresh token: assume it leaked
        return $this->fail(400, 'invalid_grant', 'refresh token already used; the approval has been revoked');
      }
      $grant = $this->liveGrant($ctx, $t['grant']);
      if (!$grant || $t['expires'] < $ctx->now()) { return $this->fail(400, 'invalid_grant', 'expired or revoked'); }
      if (!empty($b['client_id']) && $b['client_id'] !== $grant['client_id']) { return $this->fail(400, 'invalid_grant', 'client_id does not match'); }
      $tokens[$found]['revoked'] = true;
      $ctx->storage->write('tokens', $tokens);
      return $this->issueTokens($ctx, $grant);
    }
    return $this->fail(400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
  }

  /**
   * Implements operation oauthRegister.
   *
   * Registers a public client (no secret) when dynamic registration is turned on; redirect URIs must be https, or http on this machine.
   *
   * @param object $ctx  Platform context (spec/13); settings.dynamicRegistration.
   * @param array  $req  body: [client_name, redirect_uris].
   * @return array  201 with the client, 400, or 403 when registration is off.
   */
  public function oauthRegister($ctx, $req) {
    if (($ctx->settings['dynamicRegistration'] ?? false) !== true) { return $this->fail(403, 'access_denied', 'dynamic client registration is turned off on this server'); }
    $b = $req['body'] ?? [];
    $uris = is_array($b['redirect_uris'] ?? null) ? array_values($b['redirect_uris']) : [];
    $ok = count($uris) > 0;
    foreach ($uris as $u) { if (!$this->redirectAllowed($u)) { $ok = false; } }
    if (!$ok) { return $this->fail(400, 'invalid_redirect_uri', 'redirect_uris must be https, or http on localhost'); }
    $client = ['client_id' => 'hax_client_' . bin2hex(random_bytes(8)), 'client_name' => (string) ($b['client_name'] ?? '') ?: 'Unnamed app', 'redirect_uris' => $uris, 'registered' => 'dynamic', 'created' => $ctx->now()];
    $clients = $this->read($ctx, 'clients');
    $clients[] = $client;
    $ctx->storage->write('clients', $clients);
    return ['status' => 201, 'body' => ['client_id' => $client['client_id'], 'client_name' => $client['client_name'], 'redirect_uris' => $uris, 'token_endpoint_auth_method' => 'none', 'grant_types' => ['authorization_code', 'refresh_token'], 'response_types' => ['code']]];
  }

  /**
   * Implements operation oauthRevoke.
   *
   * Revokes a token; a refresh or personal token takes its whole grant with it. Always answers 200 so it reveals nothing about the token.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  body.token: the token to revoke.
   * @return array  [].
   */
  public function oauthRevoke($ctx, $req) {
    $tokens = $this->read($ctx, 'tokens');
    $raw = $req['body']['token'] ?? '';
    foreach ($tokens as $i => $t) {
      if ($t['hash'] !== $this->hash($raw)) { continue; }
      if ($t['kind'] === 'access') { $tokens[$i]['revoked'] = true; $ctx->storage->write('tokens', $tokens); }
      else { $this->revokeGrant($ctx, $t['grant']); }
      break;
    }
    return (object) [];
  }

  /**
   * Implements operation oauthGrantList.
   *
   * Lists the approvals the signed-in person has given and not revoked: which app, which resource, which scopes.
   *
   * @param object $ctx  Platform context (spec/13); user.
   * @param array  $req  Unused.
   * @return array  [items].
   */
  public function oauthGrantList($ctx, $req) {
    $me = $this->userId($ctx);
    $items = [];
    foreach ($this->read($ctx, 'grants') as $g) {
      if ($g['user'] === $me && empty($g['revoked'])) { $items[] = ['id' => $g['id'], 'client_id' => $g['client_id'], 'client_name' => $g['client_name'], 'resource' => $g['resource'], 'scopes' => $g['scopes'], 'site' => $g['site'], 'created' => $g['created']]; }
    }
    return ['items' => $items];
  }

  /**
   * Implements operation oauthGrantRevoke.
   *
   * Takes an app's access away: the grant and every token issued under it stop working at once.
   *
   * @param object $ctx  Platform context (spec/13); user may revoke only their own grants.
   * @param array  $req  params.id: the grant id.
   * @return array  [revoked => id], or 404.
   */
  public function oauthGrantRevoke($ctx, $req) {
    $me = $this->userId($ctx);
    foreach ($this->read($ctx, 'grants') as $g) {
      if ($g['id'] === ($req['params']['id'] ?? null) && $g['user'] === $me && empty($g['revoked'])) { $this->revokeGrant($ctx, $g['id']); return ['revoked' => $g['id']]; }
    }
    return ['status' => 404, 'body' => ['error' => 'not found']];
  }

  /**
   * Implements operation oauthPersonalTokenCreate.
   *
   * Issues a token for a headless client (stdio MCP, a script) without the browser flow, for one resource and its scopes; the raw token is returned once.
   *
   * @param object $ctx  Platform context (spec/13); user.
   * @param array  $req  body: [label, resource, scope, site, expiresInDays].
   * @return array  [id, token, scope, resource, expires], or a 400 [error, error_description].
   */
  public function oauthPersonalTokenCreate($ctx, $req) {
    $b = $req['body'] ?? [];
    $resource = $this->findResource($ctx, $b['resource'] ?? null);
    if (!$resource) { return $this->fail(400, 'invalid_target', 'resource is not something this server issues tokens for'); }
    $scopes = $this->pickScopes($resource, $b['scope'] ?? null);
    if ($scopes === null) { return $this->fail(400, 'invalid_scope', 'scope must be from: ' . $this->scopeList($resource)); }
    $grant = ['id' => $this->shortId('grant-'), 'user' => $this->userId($ctx), 'client_id' => 'personal', 'client_name' => (string) ($b['label'] ?? '') ?: 'Personal token', 'resource' => $resource['resource'], 'resourcePlugin' => $resource['plugin'], 'scopes' => $scopes, 'site' => $b['site'] ?? null, 'created' => $ctx->now(), 'revoked' => false];
    $grants = $this->read($ctx, 'grants');
    $grants[] = $grant;
    $ctx->storage->write('grants', $grants);
    $token = $this->rand('hax_pt_');
    $expires = !empty($b['expiresInDays']) ? $ctx->now() + $b['expiresInDays'] * 86400000 : null;
    $tokens = $this->read($ctx, 'tokens');
    $tokens[] = ['id' => $this->shortId('tok-'), 'hash' => $this->hash($token), 'kind' => 'personal', 'grant' => $grant['id'], 'expires' => $expires, 'revoked' => false];
    $ctx->storage->write('tokens', $tokens);
    return ['id' => $grant['id'], 'token' => $token, 'scope' => implode(' ', $scopes), 'resource' => $resource['resource'], 'expires' => $expires];
  }

  /**
   * Implements operation oauthResourceList.
   *
   * Lists what tokens can be issued for (every configured oauth.resource implementer) and the scopes each accepts.
   *
   * @param object $ctx  Platform context (spec/13).
   * @param array  $req  Unused.
   * @return array  [items].
   */
  public function oauthResourceList($ctx, $req) {
    return ['items' => $this->resources($ctx)];
  }

  /**
   * Implements hook rest.before.request.
   *
   * Drops any x-hax-oauth-grant header a client sent; for a request carrying one of this plugin's tokens, refuses it unless the token is live and the resource it was issued for allows the call, then passes the grant on in that header.
   *
   * @param object $ctx  subject: the incoming request [method, path, operationId, plugin, headers].
   * @return mixed  the request with the grant header set or removed, or a veto (401 bad token, 403 not allowed).
   */
  public function restBeforeRequest($ctx) {
    $s = $ctx->subject;
    $headers = $s['headers'] ?? [];
    unset($headers[self::GRANT_HEADER]);
    $s['headers'] = $headers;
    if (!preg_match('/^Bearer\s+(hax_(?:at|pt)_[0-9a-f]+)$/i', (string) ($headers['authorization'] ?? ''), $m)) { return $s; }
    $grant = null;
    foreach ($this->read($ctx, 'tokens') as $t) {
      if (($t['kind'] === 'access' || $t['kind'] === 'personal') && $t['hash'] === $this->hash($m[1])) {
        if (empty($t['revoked']) && (empty($t['expires']) || $t['expires'] > $ctx->now())) { $grant = $this->liveGrant($ctx, $t['grant']); }
        break;
      }
    }
    if (!$grant) { return $ctx->veto('invalid, expired or revoked token', 401); }
    $verdict = $ctx->contracts->call('oauth.resource', 'check', ['grant' => $this->pub($grant), 'request' => ['operationId' => $s['operationId'] ?? null, 'method' => $s['method'] ?? null, 'path' => $s['path'] ?? null, 'plugin' => $s['plugin'] ?? null]], ['plugin' => $grant['resourcePlugin']]);
    if (!is_array($verdict) || ($verdict['allow'] ?? null) !== true) { return $ctx->veto((is_array($verdict) && !empty($verdict['message'])) ? $verdict['message'] : 'this token may not call ' . ($s['operationId'] ?? ''), 403); }
    $s['headers'][self::GRANT_HEADER] = json_encode($this->pub($grant), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    return $s;
  }
}

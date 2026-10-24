<?php
// YouTube (PHP). Mirrors src/nodejs/index.js.
class YoutubePlugin {
  public function youtubeSearch($ctx, $req) {
    $params = ['part' => 'snippet', 'type' => 'video', 'maxResults' => '20', 'q' => (string) ($req['query']['q'] ?? ''), 'key' => $ctx->settings['apiKey'] ?? ''];
    if (!empty($req['query']['pageToken'])) { $params['pageToken'] = (string) $req['query']['pageToken']; }
    try {
      $res = $ctx->fetch('https://www.googleapis.com/youtube/v3/search?' . http_build_query($params));
      return ['status' => $res['status'], 'body' => $res['json']];
    } catch (Exception $e) {
      $ctx->log->warn('YouTube search failed: ' . $e->getMessage());
      return ['status' => 502, 'body' => ['error' => 'YouTube could not be reached']];
    }
  }

  // hook: plugin.before.requirements
  public function pluginBeforeRequirements($ctx) {
    if (!empty($ctx->settings['apiKey'])) { return $ctx->subject; }
    $out = $ctx->subject;
    $out[] = ['key' => 'settings.apiKey', 'message' => 'Add a YouTube Data API key'];
    return $out;
  }

  // hook: plugin.after.install
  public function pluginAfterInstall($ctx) {
    $core = $ctx->entities->get('config', 'core');
    $key = $core['appStore']['apiKeys']['youtube'] ?? null;
    if (!$key) { return null; }
    if (empty($ctx->settings['apiKey'])) { $ctx->config->save(['apiKey' => $key]); }
    $fresh = $ctx->entities->get('config', 'core');
    unset($fresh['appStore']['apiKeys']['youtube']);
    $ctx->entities->save('config', $fresh);
    $ctx->log->info('moved the YouTube API key out of the core config');
    return null;
  }
}

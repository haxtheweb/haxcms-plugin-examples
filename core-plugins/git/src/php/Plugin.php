<?php
// Version control (PHP). Mirrors src/nodejs/index.js and git.js. The only command it runs is `git`.
class GitPlugin {
  private function git($dir, $args) {
    $cmd = 'git ' . implode(' ', array_map('escapeshellarg', $args)) . ' 2>&1';
    $env = 'GIT_AUTHOR_NAME=HAXcms GIT_AUTHOR_EMAIL=haxcms@localhost GIT_COMMITTER_NAME=HAXcms GIT_COMMITTER_EMAIL=haxcms@localhost';
    exec('cd ' . escapeshellarg($dir) . ' && ' . $env . ' ' . $cmd, $out, $code);
    if ($code !== 0) { throw new Exception(implode("\n", $out)); }
    return implode("\n", $out);
  }
  private function safeMessage($m) {
    $m = substr(preg_replace('#[^A-Za-z0-9 _.,:;()/\#@+=-]#', '', (string) ($m ?: 'Committed changes')), 0, 200);
    return trim($m) !== '' ? trim($m) : 'Committed changes';
  }
  private function commit($dir, $message) {
    if (!file_exists("$dir/.git")) { $this->git($dir, ['init', '-q']); }
    $this->git($dir, ['add', '-A']);
    if (trim($this->git($dir, ['status', '--porcelain'])) === '') { return null; }
    $this->git($dir, ['commit', '-q', '-m', $this->safeMessage($message)]);
    return trim($this->git($dir, ['rev-parse', 'HEAD']));
  }
  private function describe($kind, $s) {
    $label = is_array($s) ? ($s['title'] ?? $s['name'] ?? $s['id'] ?? '') : '';
    return trim("$kind: $label");
  }
  private function commitWithHooks($ctx, $message) {
    $before = $ctx->hooks->fire('git.before.commit', ['siteId' => $ctx->site['id'], 'message' => $message, 'files' => [], 'author' => $ctx->user['name'] ?? 'HAXcms']);
    if (!empty($before['veto'])) { $ctx->log->info('commit vetoed: ' . $before['veto']['message']); return null; }
    $hash = $this->commit($ctx->site['path'], $before['subject']['message']);
    if (!$hash) { return null; }
    $ctx->hooks->fire('git.after.commit', array_merge($before['subject'], ['hash' => $hash]));
    $branch = (string) ($ctx->settings['branch'] ?? '');
    if (!empty($ctx->settings['autoPush']) && preg_match('#^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$#', $branch)) {
      try { $this->git($ctx->site['path'], ['push', 'origin', "HEAD:$branch"]); } catch (Exception $e) { $ctx->log->warn('push failed: ' . $e->getMessage()); }
    }
    return $hash;
  }
  private function changed($ctx, $kind) {
    $msg = $this->describe($kind, $ctx->subject);
    if (!empty($ctx->transaction['bulk'])) {
      $ctx->transaction['marks']['git.commit'] = array_merge($ctx->transaction['marks']['git.commit'] ?? [], [$msg]);
      return null;
    }
    $this->commitWithHooks($ctx, $msg);
    return null;
  }

  /**
   * Implements operation gitHistory.
   *
   * Lists the site's most recent commits (hash and message), newest first; limit is clamped to 1-100, default 20.
   *
   * @param object $ctx  Platform context (spec/13); site path is the repository.
   * @param array  $req  query.limit.
   * @return array  [items => [[hash, message]]], empty when the site has no repository.
   */
  public function gitHistory($ctx, $req) {
    $dir = $ctx->site['path'];
    if (!file_exists("$dir/.git")) { return ['items' => []]; }
    $limit = min(100, max(1, (int) ($req['query']['limit'] ?? 20) ?: 20));
    try { $out = $this->git($dir, ['log', "-n$limit", '--pretty=format:%H%x09%s']); } catch (Exception $e) { $out = ''; }
    $items = [];
    foreach (array_filter(explode("\n", $out)) as $l) { [$hash, $message] = explode("\t", $l, 2); $items[] = ['hash' => $hash, 'message' => $message]; }
    return ['items' => $items];
  }

  /**
   * Implements hook page.after.save.
   *
   * Commits the site after a page is saved, or marks the change for one commit at the end of a bulk transaction.
   * The commit fires git.before.commit and git.after.commit, and pushes when autoPush is on.
   *
   * @param object $ctx  subject: the page as saved; previous: the page before the save.
   *                    transaction tells a bulk change apart.
   * @return null
   */
  public function pageAfterSave($ctx) { return $this->changed($ctx, 'Page saved'); }
  /**
   * Implements hook page.after.delete.
   *
   * Commits the site after a page is deleted, or marks the change for one commit at the end of a bulk transaction.
   * The commit fires git.before.commit and git.after.commit, and pushes when autoPush is on.
   *
   * @param object $ctx  subject: the page that was deleted.
   *                    transaction tells a bulk change apart.
   * @return null
   */
  public function pageAfterDelete($ctx) { return $this->changed($ctx, 'Page deleted'); }
  /**
   * Implements hook manifest.after.save.
   *
   * Commits the site after site.json is saved, or marks the change for one commit at the end of a bulk transaction.
   * The commit fires git.before.commit and git.after.commit, and pushes when autoPush is on.
   *
   * @param object $ctx  subject: the manifest as saved; previous: the manifest before the save.
   *                    transaction tells a bulk change apart.
   * @return null
   */
  public function manifestAfterSave($ctx) { return $this->changed($ctx, 'Site updated'); }
  /**
   * Implements hook file.after.save.
   *
   * Commits the site after a file is saved, or marks the change for one commit at the end of a bulk transaction.
   * The commit fires git.before.commit and git.after.commit, and pushes when autoPush is on.
   *
   * @param object $ctx  subject: the file record as stored; previous: the record before the update, on update.
   *                    transaction tells a bulk change apart.
   * @return null
   */
  public function fileAfterSave($ctx) { return $this->changed($ctx, 'File saved'); }
  /**
   * Implements hook file.after.delete.
   *
   * Commits the site after a file is deleted, or marks the change for one commit at the end of a bulk transaction.
   * The commit fires git.before.commit and git.after.commit, and pushes when autoPush is on.
   *
   * @param object $ctx  subject: the file that was deleted.
   *                    transaction tells a bulk change apart.
   * @return null
   */
  public function fileAfterDelete($ctx) { return $this->changed($ctx, 'File deleted'); }

  /**
   * Implements hook transaction.before.end.
   *
   * Makes one commit for everything a bulk transaction changed, with a message that lists the first few changes.
   *
   * @param object $ctx  subject: the transaction, with marks['git.commit']
   *                    holding the messages queued by the other hooks.
   * @return null
   */
  public function transactionBeforeEnd($ctx) {
    $msgs = $ctx->subject['marks']['git.commit'] ?? [];
    if (!$msgs) { return null; }
    $msg = count($msgs) === 1 ? $msgs[0] : count($msgs) . ' changes: ' . implode('; ', array_slice($msgs, 0, 3)) . (count($msgs) > 3 ? '; ...' : '');
    $this->commitWithHooks($ctx, $msg);
    return null;
  }
}

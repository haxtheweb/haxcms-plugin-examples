<?php
// Comments (PHP). Mirrors src/nodejs/index.js.
class CommentsPlugin {
  const MODERATORS = ['admin', 'editor'];
  private function esc($s) { return htmlspecialchars((string) $s, ENT_QUOTES | ENT_HTML5, 'UTF-8'); }
  private function isMod($user) { return is_array($user) && count(array_intersect($user['roles'] ?? [], self::MODERATORS)) > 0; }
  private function all($ctx) { return $ctx->storage->read('comments') ?: []; }
  private function find($list, $id) { foreach ($list as $i => $c) { if ($c['id'] === $id) { return $i; } } return null; }

  public function commentsList($ctx, $req) {
    if (!$ctx->user && empty($ctx->settings['anonymousRead'])) { return ['status' => 401, 'body' => ['error' => 'sign in to read comments']]; }
    $mod = $this->isMod($ctx->user);
    $uid = $ctx->user['id'] ?? null;
    return array_values(array_filter($this->all($ctx), function ($c) use ($req, $mod, $uid) {
      return $c['pageId'] === $req['params']['pageId'] && ($c['status'] === 'approved' || $mod || ($uid !== null && $c['authorId'] === $uid));
    }));
  }

  public function commentsCreate($ctx, $req) {
    if (!$ctx->entities->get('page', $req['params']['pageId'])) { return ['status' => 404, 'body' => ['error' => 'no such page']]; }
    $body = trim((string) ($req['body']['body'] ?? ''));
    if ($body === '' || mb_strlen($body) > 2000) { return ['status' => 422, 'body' => ['error' => 'a comment needs 1 to 2000 characters']]; }
    $list = $this->all($ctx);
    $comment = [
      'id' => 'c' . (count($list) + 1), 'pageId' => $req['params']['pageId'], 'authorId' => $ctx->user['id'],
      'authorName' => ($ctx->user['displayName'] ?? '') !== '' ? $ctx->user['displayName'] : $ctx->user['name'],
      'body' => $body, 'status' => (!empty($ctx->settings['moderation']) && !$this->isMod($ctx->user)) ? 'pending' : 'approved',
    ];
    $list[] = $comment;
    $ctx->storage->write('comments', $list);
    return $comment;
  }

  public function commentsModerate($ctx, $req) {
    if (!$this->isMod($ctx->user)) { return ['status' => 403, 'body' => ['error' => 'only editors can moderate']]; }
    $list = $this->all($ctx);
    $i = $this->find($list, $req['params']['id']);
    if ($i === null) { return ['status' => 404, 'body' => ['error' => 'not found']]; }
    if (!in_array($req['body']['status'] ?? null, ['approved', 'rejected'], true)) { return ['status' => 422, 'body' => ['error' => 'status is approved or rejected']]; }
    $list[$i]['status'] = $req['body']['status'];
    $ctx->storage->write('comments', $list);
    return $list[$i];
  }

  public function commentsDelete($ctx, $req) {
    $list = $this->all($ctx);
    $i = $this->find($list, $req['params']['id']);
    if ($i === null) { return ['status' => 404, 'body' => ['error' => 'not found']]; }
    if ($list[$i]['authorId'] !== $ctx->user['id'] && !$this->isMod($ctx->user)) { return ['status' => 403, 'body' => ['error' => 'not your comment']]; }
    $id = $list[$i]['id'];
    array_splice($list, $i, 1);
    $ctx->storage->write('comments', $list);
    return ['deleted' => $id];
  }

  public function commentsRepublish($ctx) { return $ctx->storage->read('republish') ?: []; }

  public function pageAfterDelete($ctx) {
    $list = $this->all($ctx);
    $keep = array_values(array_filter($list, function ($c) use ($ctx) { return $c['pageId'] !== $ctx->subject['id']; }));
    if (count($keep) !== count($list)) {
      $ctx->storage->write('comments', $keep);
      $ctx->log->info('removed ' . (count($list) - count($keep)) . ' comments with page ' . $ctx->subject['id']);
    }
  }

  public function renderAfterContent($ctx) {
    if (empty($ctx->settings['snapshot']) || empty($ctx->subject['page'])) { return null; }
    $pid = $ctx->subject['page']['id'];
    $shown = array_filter($this->all($ctx), function ($c) use ($pid) { return $c['pageId'] === $pid && $c['status'] === 'approved'; });
    if (!$shown) { return null; }
    $items = '';
    foreach ($shown as $c) { $items .= '<li><strong>' . $this->esc($c['authorName']) . '</strong> ' . $this->esc($c['body']) . '</li>'; }
    $ctx->subject['content'] .= '<section class="hax-comments" aria-label="Comments"><h2>Comments</h2><ul>' . $items . '</ul></section>';
    return $ctx->subject;
  }

  public function userBeforeErase($ctx) {
    $uid = $ctx->subject['userId'];
    $pages = [];
    foreach ($this->all($ctx) as $c) { if ($c['authorId'] === $uid && $c['status'] === 'approved') { $pages[$c['pageId']] = true; } }
    $ctx->transaction['marks']['commentsPages'] = array_keys($pages);
  }

  public function userAfterErase($ctx) {
    $marked = $ctx->transaction['marks']['commentsPages'] ?? [];
    if (empty($ctx->subject['removed']['comments.comments']) || !$marked) { return; }
    $pages = array_values(array_unique(array_merge($ctx->storage->read('republish') ?: [], $marked)));
    sort($pages);
    $ctx->storage->write('republish', $pages);
    $ctx->log->warn('an erased user had comments; republish the listed pages so the published copies drop them');
  }
}

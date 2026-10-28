<?php
// Comments (PHP). Mirrors src/nodejs/index.js.
class CommentsPlugin {
  const MODERATORS = ['admin', 'editor'];
  private function esc($s) { return htmlspecialchars((string) $s, ENT_QUOTES | ENT_HTML5, 'UTF-8'); }
  private function isMod($user) { return is_array($user) && count(array_intersect($user['roles'] ?? [], self::MODERATORS)) > 0; }
  private function all($ctx) { return $ctx->storage->read('comments') ?: []; }
  private function find($list, $id) { foreach ($list as $i => $c) { if ($c['id'] === $id) { return $i; } } return null; }

  /**
   * Implements operation commentsList.
   *
   * Lists the comments on a page: approved ones for everyone, plus pending ones for moderators and for their own
   * authors. Anonymous visitors are refused unless the anonymousRead setting is on, because the operation allows
   * optional auth and leaves the filter to this handler.
   *
   * @param object $ctx
   * @param array $req  params and body of the request.
   * @return array  the visible comments, or a 401 response.
   */
  public function commentsList($ctx, $req) {
    if (!$ctx->user && empty($ctx->settings['anonymousRead'])) { return ['status' => 401, 'body' => ['error' => 'sign in to read comments']]; }
    $mod = $this->isMod($ctx->user);
    $uid = $ctx->user['id'] ?? null;
    return array_values(array_filter($this->all($ctx), function ($c) use ($req, $mod, $uid) {
      return $c['pageId'] === $req['params']['pageId'] && ($c['status'] === 'approved' || $mod || ($uid !== null && $c['authorId'] === $uid));
    }));
  }

  /**
   * Implements operation commentsCreate.
   *
   * Adds a comment to a page after firing comments.before.create, so other plugins (such as spam-guard) can hold it as
   * pending, edit it or refuse it. Comments start pending when moderation is on and the author is not a moderator;
   * comments.after.create fires once it is stored.
   *
   * @param object $ctx
   * @param array $req  params and body of the request.
   * @return array  the stored comment, or a 404/422 response.
   */
  public function commentsCreate($ctx, $req) {
    if (!$ctx->entities->get('page', $req['params']['pageId'])) { return ['status' => 404, 'body' => ['error' => 'no such page']]; }
    $body = trim((string) ($req['body']['body'] ?? ''));
    if ($body === '' || mb_strlen($body) > 2000) { return ['status' => 422, 'body' => ['error' => 'a comment needs 1 to 2000 characters']]; }
    $draft = ['pageId' => $req['params']['pageId'], 'authorId' => $ctx->user['id'],
      'authorName' => ($ctx->user['displayName'] ?? '') !== '' ? $ctx->user['displayName'] : $ctx->user['name'],
      'body' => $body, 'status' => (!empty($ctx->settings['moderation']) && !$this->isMod($ctx->user)) ? 'pending' : 'approved'];
    $before = $ctx->hooks->fire('comments.before.create', $draft);
    if (!empty($before['veto'])) { return ['status' => $before['veto']['status'] ?? 422, 'body' => ['error' => $before['veto']['message']]]; }
    $s = $before['subject'];
    $list = $this->all($ctx);
    $comment = ['id' => 'c' . (count($list) + 1), 'pageId' => $draft['pageId'], 'authorId' => $draft['authorId'], 'authorName' => $draft['authorName'],
      'body' => (string) ($s['body'] ?? $draft['body']), 'status' => ($s['status'] ?? '') === 'pending' ? 'pending' : $draft['status']];
    $list[] = $comment;
    $ctx->storage->write('comments', $list);
    $ctx->hooks->fire('comments.after.create', $comment);
    return $comment;
  }

  /**
   * Implements operation commentsModerate.
   *
   * Sets a comment to approved or rejected; only admins and editors may do this.
   *
   * @param object $ctx
   * @param array $req  params and body of the request.
   * @return array  the updated comment, or a 403/404/422 response.
   */
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

  /**
   * Implements operation commentsDelete.
   *
   * Deletes a comment when the caller wrote it or is a moderator.
   *
   * @param object $ctx
   * @param array $req  params and body of the request.
   * @return array  { deleted: id }, or a 403/404 response.
   */
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

  /**
   * Implements operation commentsRepublish.
   *
   * Lists the pages that still show an erased user's comments in their published copy, so an editor knows what to
   * republish.
   *
   * @param object $ctx
   * @return array  page ids.
   */
  public function commentsRepublish($ctx) { return $ctx->storage->read('republish') ?: []; }

  /**
   * Implements hook page.after.delete.
   *
   * Removes the comments of a deleted page so none are left pointing at nothing.
   *
   * @param object $ctx  subject: the deleted page.
   * @return void
   */
  public function pageAfterDelete($ctx) {
    $list = $this->all($ctx);
    $keep = array_values(array_filter($list, function ($c) use ($ctx) { return $c['pageId'] !== $ctx->subject['id']; }));
    if (count($keep) !== count($list)) {
      $ctx->storage->write('comments', $keep);
      $ctx->log->info('removed ' . (count($list) - count($keep)) . ' comments with page ' . $ctx->subject['id']);
    }
  }

  /**
   * Implements hook render.after.content.
   *
   * Appends the page's approved comments as static HTML when the snapshot setting is on, so published and static
   * copies show them without the API.
   *
   * @param object $ctx  subject: the render state (page, content).
   * @return array|null  the render state with the comments section, or nothing to leave it alone.
   */
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

  /**
   * Implements hook user.before.erase.
   *
   * Records, as a transaction mark, the pages that carry the user's approved comments, while the records still exist.
   *
   * @param object $ctx  subject: { userId } of the user being erased.
   * @return void
   */
  public function userBeforeErase($ctx) {
    $uid = $ctx->subject['userId'];
    $pages = [];
    foreach ($this->all($ctx) as $c) { if ($c['authorId'] === $uid && $c['status'] === 'approved') { $pages[$c['pageId']] = true; } }
    $ctx->transaction['marks']['commentsPages'] = array_keys($pages);
  }

  /**
   * Implements hook user.after.erase.
   *
   * Adds the marked pages to the republish list, because core already removed the user's comments from the store but
   * the published copies still name them.
   *
   * @param object $ctx  subject: { userId, removed } with the records core removed; ctx.transaction.marks from user.before.erase.
   * @return void
   */
  public function userAfterErase($ctx) {
    $marked = $ctx->transaction['marks']['commentsPages'] ?? [];
    if (empty($ctx->subject['removed']['comments.comments']) || !$marked) { return; }
    $pages = array_values(array_unique(array_merge($ctx->storage->read('republish') ?: [], $marked)));
    sort($pages);
    $ctx->storage->write('republish', $pages);
    $ctx->log->warn('an erased user had comments; republish the listed pages so the published copies drop them');
  }
}

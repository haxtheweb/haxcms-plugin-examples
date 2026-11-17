<?php
// Page feedback (PHP). Mirrors src/nodejs/index.js; both return identical results.
// Identity comes only from the platform ($ctx->user), never from the request, and is stored only when the site turned
// the anonymous setting off. No IP address is read or stored anywhere in this file.
class PageFeedbackPlugin {
  const EDITORS = ['admin', 'editor'];
  const HOUR = 3600000;
  const DAY = 86400000;
  const ROUTE = 'x/api/v1/plugins/page-feedback/';
  const ID_RE = '/^[a-z0-9]+(-[a-z0-9]+)*$/D';
  const DAY_RE = '/^(\d{4})-(\d{2})-(\d{2})$/D';
  const PRINTABLE_RE = '/^[\x21-\x7E]+$/D';
  const WEBHOOK_RE = '/^https:\/\/([^\/?#@:]+)(:\d{1,5})?([\/?#].*)?$/D';
  const HOST_RE = '/^[a-z0-9.-]+$/D';
  const HEADER_RE = '/^[A-Za-z0-9-]+$/D';
  const PRIVATE_RE = '/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/D';
  const FORBIDDEN_HEADERS = ['host', 'content-length', 'content-type', 'connection', 'transfer-encoding', 'cookie'];
  const NOTIFY = ['all', 'negative', 'comments'];
  const TAG_RE = '/<page-feedback(?=[\s>\/])/';
  const WEBHOOK_HELP = 'The webhook address must be an https address with a host, such as https://example.edu/hooks/feedback';
  const JSON_FLAGS = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_LINE_TERMINATORS;

  private static function isObj($v) { return is_array($v) && (count($v) === 0 || !array_is_list($v)); }
  private static function isList($v) { return is_array($v) && array_is_list($v); }
  private static function bad($status, $error) { return ['status' => $status, 'body' => ['error' => $error]]; }
  private static function isEditor($user) { return is_array($user) && count(array_intersect($user['roles'] ?? [], self::EDITORS)) > 0; }
  private static function esc($s) { return str_replace(['&', '<', '>', '"', "'"], ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'], (string) $s); }
  private static function chars($s) { return mb_strlen($s, 'UTF-8'); }

  /** A whole number from a setting or query value (a number or a string of digits); otherwise the fallback. */
  private static function int($v, $fallback) {
    if (is_int($v)) { return $v; }
    if (is_float($v) && floor($v) === $v) { return (int) $v; }
    if (is_string($v) && $v !== '' && strlen($v) <= 9 && ctype_digit($v)) { return (int) $v; }
    return $fallback;
  }

  private static function trimAscii($s) { return trim((string) $s, " \t\n"); }

  /** Plain text: one kind of line break, no control characters, trimmed. Markup is kept as the text it is. */
  private static function cleanText($s) {
    $s = preg_replace('/\r\n?/', "\n", (string) $s);
    return self::trimAscii(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $s));
  }

  /** The host of an acceptable webhook address (https, a host, no sign-in part), or ''. */
  private static function webhookHost($url) {
    $u = (string) $url;
    if (strlen($u) > 2000 || !preg_match(self::PRINTABLE_RE, $u)) { return ''; }
    if (!preg_match(self::WEBHOOK_RE, $u, $m)) { return ''; }
    $host = strtolower($m[1]);
    if (!preg_match(self::HOST_RE, $host) || $host[0] === '.' || substr($host, -1) === '.' || $host[0] === '-') { return ''; }
    return $host;
  }
  private static function isPrivateHost($host) {
    return preg_match(self::PRIVATE_RE, $host) === 1 || substr($host, -9) === '.internal' || substr($host, -6) === '.local';
  }

  /** The host part of an Origin header or of the site address, lower case, or ''. */
  private static function originHost($url) {
    return preg_match('/^[a-z][a-z0-9+.-]*:\/\/([^\/?#]*)/i', (string) $url, $m) ? strtolower($m[1]) : '';
  }

  /** The configured reasons as [{ id, label }], leaving out anything malformed. */
  private static function reasonsOf($settings) {
    $list = isset($settings['reasons']) && is_array($settings['reasons']) ? $settings['reasons'] : [];
    $out = [];
    foreach ($list as $r) {
      if (is_array($r) && isset($r['id'], $r['label']) && is_string($r['id']) && preg_match(self::ID_RE, $r['id']) && is_string($r['label']) && $r['label'] !== '') {
        $out[] = ['id' => $r['id'], 'label' => $r['label']];
      }
    }
    return $out;
  }
  private static function labelOf($reasons, $id) {
    foreach ($reasons as $r) { if ($r['id'] === $id) { return $r['label']; } }
    return $id;
  }
  private static function maxLength($settings) { return min(5000, max(1, self::int($settings['commentMaxLength'] ?? null, 1000))); }
  private static function isoOf($ms) { return gmdate('Y-m-d\TH:i:s', intdiv($ms, 1000)) . sprintf('.%03dZ', $ms % 1000); }
  private static function seqOf($item) { return self::int(substr((string) $item['id'], 1), 0); }

  private static function allFeedback($ctx) {
    $list = $ctx->storage->read('feedback');
    return is_array($list) ? array_values($list) : [];
  }

  /** Drops feedback older than retentionDays (0 keeps everything). */
  private static function fresh($list, $settings, $now) {
    $days = self::int($settings['retentionDays'] ?? null, 0);
    if ($days <= 0) { return $list; }
    $cutoff = $now - $days * self::DAY;
    return array_values(array_filter($list, function ($x) use ($cutoff) { return self::int($x['ts'] ?? null, 0) >= $cutoff; }));
  }

  /** What editors see for one response: the stored row plus the words a card shows. */
  private static function view($item, $reasons) {
    $label = count($item['reasons']) ? self::labelOf($reasons, $item['reasons'][0]) : ($item['helpful'] ? 'Helpful' : 'Not helpful');
    return array_merge($item, [
      'title' => $item['pageTitle'],
      'label' => $label,
      'summary' => $item['comment'] !== '' ? $item['comment'] : '(no comment)',
      'chip' => ['label' => $label, 'icon' => $item['helpful'] ? 'icons:thumb-up' : 'icons:thumb-down', 'color' => $item['helpful'] ? 'green' : 'orange'],
    ]);
  }

  /** A filter value from either spelling of the list conventions: filter[key]=v or a nested filter object. */
  private static function param($query, $group, $key) {
    $flat = $query[$group . '[' . $key . ']'] ?? null;
    if ($flat !== null) { return $flat; }
    $nested = $query[$group] ?? null;
    return is_array($nested) && isset($nested[$key]) ? $nested[$key] : null;
  }
  /** true, false, null (not given) or 'invalid'. */
  private static function boolParam($v) {
    if ($v === null) { return null; }
    if ($v === true || $v === 'true') { return true; }
    if ($v === false || $v === 'false') { return false; }
    return 'invalid';
  }
  /** Milliseconds at the start of a YYYY-MM-DD day (UTC), null when not given, 'invalid' otherwise. */
  private static function dayParam($v) {
    if ($v === null) { return null; }
    if (!is_scalar($v) || !preg_match(self::DAY_RE, (string) $v, $m) || (int) $m[1] < 1970) { return 'invalid'; }
    return gmmktime(0, 0, 0, (int) $m[2], (int) $m[3], (int) $m[1]) * 1000;
  }

  private static function percent($yes, $n) { return $n > 0 ? intdiv($yes * 200 + $n, 2 * $n) : 0; }
  private static function matchesNotify($settings, $item) {
    $on = $settings['notifyOn'] ?? 'all';
    return $on === 'negative' ? !$item['helpful'] : ($on === 'comments' ? $item['comment'] !== '' : true);
  }
  private static function pageUrl($ctx, $page) {
    return isset($page['slug']) && is_string($page['slug']) && $page['slug'] !== '' ? $ctx->site['url'] . $page['slug'] : null;
  }
  private static function rolesOf($settings) {
    $v = $settings['notifyRoles'] ?? '';
    $out = [];
    foreach (explode(',', is_scalar($v) ? (string) $v : '') as $r) { $r = self::trimAscii($r); if ($r !== '') { $out[] = $r; } }
    return $out;
  }

  /** Posts the summary to the site's webhook. The secret travels only in its header, only to that address. */
  private static function deliver($ctx, $summary) {
    $s = $ctx->settings;
    $url = self::trimAscii(isset($s['webhookUrl']) && is_scalar($s['webhookUrl']) ? (string) $s['webhookUrl'] : '');
    if (($s['webhookEnabled'] ?? false) !== true || $url === '') { return; }
    $body = json_encode([
      'event' => 'page-feedback.submitted',
      'site' => ['id' => $ctx->site['id'], 'name' => $ctx->site['name'], 'url' => $ctx->site['url']],
      'page' => ['id' => $summary['pageId'], 'title' => $summary['pageTitle'], 'url' => $summary['pageUrl']],
      'helpful' => $summary['helpful'],
      'reasons' => $summary['reasons'],
      'comment' => ($s['webhookIncludeComment'] ?? true) === false ? null : $summary['comment'],
      'hasComment' => $summary['comment'] !== '',
      'at' => $summary['at'],
    ], self::JSON_FLAGS);
    $headers = ['content-type' => 'application/json'];
    $secret = isset($s['webhookSecret']) && is_scalar($s['webhookSecret']) ? (string) $s['webhookSecret'] : '';
    if ($secret !== '') {
      $name = isset($s['webhookSecretHeader']) && is_string($s['webhookSecretHeader']) && $s['webhookSecretHeader'] !== '' ? $s['webhookSecretHeader'] : 'x-page-feedback-secret';
      $headers[strtolower($name)] = $secret;
    }
    try {
      $res = $ctx->fetch($url, ['method' => 'POST', 'headers' => (object) $headers, 'body' => $body]);
      if ($res['status'] >= 400) { $ctx->log->warn('the feedback webhook answered ' . $res['status']); }
    } catch (\Throwable $e) {
      $ctx->log->warn('the feedback webhook could not be reached: ' . $e->getMessage());
    }
  }

  /**
   * Implements operation pageFeedbackSubmit.
   *
   * Takes one visitor's answer for a page: checks the rating, the reasons against the site's list and the comment as
   * plain text, refuses cross-site posts and floods, then stores it for editors and passes a summary to the webhook
   * and to page-feedback.after.submit. Nothing about the sender is read from the request, and the signed-in user is
   * stored only when the anonymous setting is off.
   *
   * @param object $ctx
   * @param array $req  body: { pageId, helpful, reasons, comment }; headers.origin when a browser sent it.
   * @return array  { received: true }, or a 403/404/422/429 response.
   */
  public function pageFeedbackSubmit($ctx, $req) {
    $s = $ctx->settings;
    $b = $req['body'] ?? null;
    if (!self::isObj($b)) { return self::bad(422, 'Send pageId and helpful'); }
    // a browser on another site may not post here with this site's sign-in
    $origin = isset($req['headers']['origin']) && is_string($req['headers']['origin']) ? $req['headers']['origin'] : '';
    if ($origin !== '' && self::originHost($origin) !== self::originHost($ctx->site['url'])) { return self::bad(403, 'Feedback can only be sent from this site'); }
    if (!is_bool($b['helpful'] ?? null)) { return self::bad(422, 'helpful must be true or false'); }
    $pageId = $b['pageId'] ?? null;
    if (!is_string($pageId) || $pageId === '' || strlen($pageId) > 200) { return self::bad(422, 'pageId must name a page'); }
    $page = $ctx->entities->get('page', $pageId);
    if (!$page) { return self::bad(404, 'No such page'); }
    $reasons = self::reasonsOf($s);
    $given = $b['reasons'] ?? [];
    if (!self::isList($given) || count($given) > 12) { return self::bad(422, 'reasons must be a short list'); }
    $picked = [];
    foreach ($given as $id) {
      $known = false;
      foreach ($reasons as $r) { if ($r['id'] === $id) { $known = true; } }
      if (!is_string($id) || !$known) { return self::bad(422, 'That reason is not one this site offers'); }
      if (!in_array($id, $picked, true)) { $picked[] = $id; }
    }
    $raw = $b['comment'] ?? '';
    if (!is_string($raw) || strlen($raw) > 80000 || self::chars($raw) > 20000) { return self::bad(422, 'comment must be text'); }
    $max = self::maxLength($s);
    $comment = ($s['allowComments'] ?? true) === false ? '' : self::cleanText($raw);
    if (self::chars($comment) > $max) { return self::bad(422, 'A comment can be up to ' . $max . ' characters'); }
    // flood guard: a count per hour for the whole site, with nothing recorded about who sent what
    $now = $ctx->now();
    $stored = $ctx->storage->read('meta');
    $stored = is_array($stored) ? $stored : [];
    $meta = ['seq' => self::int($stored['seq'] ?? null, 0), 'windowStart' => self::int($stored['windowStart'] ?? null, 0), 'count' => self::int($stored['count'] ?? null, 0)];
    if ($now - $meta['windowStart'] >= self::HOUR) { $meta['windowStart'] = $now; $meta['count'] = 0; }
    $cap = self::int($s['maxPerHour'] ?? null, 0);
    if ($cap > 0 && $meta['count'] >= $cap) { return self::bad(429, 'Too much feedback was sent in the last hour. Please try again later.'); }
    $pageTitle = isset($page['title']) && is_string($page['title']) && $page['title'] !== '' ? $page['title'] : $pageId;
    $draft = ['pageId' => $pageId, 'pageTitle' => $pageTitle, 'helpful' => $b['helpful'], 'reasons' => $b['helpful'] ? [] : $picked, 'comment' => $comment];
    // other plugins may refuse it or change the comment (a spam filter, a redactor)
    $before = $ctx->hooks->fire('page-feedback.before.submit', $draft);
    if (!empty($before['veto'])) { return self::bad($before['veto']['status'] ?? 422, $before['veto']['message']); }
    if (isset($before['subject']) && is_array($before['subject']) && isset($before['subject']['comment']) && is_string($before['subject']['comment'])) {
      $changed = self::cleanText($before['subject']['comment']);
      if (self::chars($changed) <= $max) { $comment = $changed; }
    }
    $meta['seq'] += 1;
    $meta['count'] += 1;
    $ctx->storage->write('meta', $meta);
    $item = ['id' => 'f' . $meta['seq'], 'pageId' => $draft['pageId'], 'pageTitle' => $pageTitle, 'helpful' => $draft['helpful'], 'reasons' => $draft['reasons'], 'comment' => $comment, 'at' => self::isoOf($now), 'ts' => $now, 'handled' => false];
    if (($s['anonymous'] ?? true) === false && is_array($ctx->user)) {
      $item['userId'] = $ctx->user['id'];
      $item['userName'] = ($ctx->user['displayName'] ?? '') !== '' ? $ctx->user['displayName'] : $ctx->user['name'];
    }
    if (($s['inbox'] ?? true) !== false) {
      $list = self::fresh(self::allFeedback($ctx), $s, $now);
      $list[] = $item;
      $ctx->storage->write('feedback', $list);
    }
    $labelled = [];
    foreach ($item['reasons'] as $id) { $labelled[] = ['id' => $id, 'label' => self::labelOf($reasons, $id)]; }
    $summary = ['id' => $item['id'], 'pageId' => $item['pageId'], 'pageTitle' => $pageTitle, 'pageUrl' => self::pageUrl($ctx, $page), 'helpful' => $item['helpful'], 'reasons' => $labelled, 'comment' => $comment, 'at' => $item['at'], 'notifyRoles' => self::rolesOf($s)];
    if (self::matchesNotify($s, $item)) {
      self::deliver($ctx, $summary);
      $ctx->hooks->fire('page-feedback.after.submit', $summary);
    }
    return ['received' => true];
  }

  /**
   * Implements operation pageFeedbackList.
   *
   * Lists feedback for site editors, newest first, filtered by page, rating, handled state, whether a comment was left
   * and a range of days, one page at a time.
   *
   * @param object $ctx
   * @param array $req  query: filter[pageId|helpful|handled|hasComment|from|to], page[limit|offset].
   * @return array  { items, total, limit, offset }, or a 403/422 response.
   */
  public function pageFeedbackList($ctx, $req) {
    if (!self::isEditor($ctx->user)) { return self::bad(403, 'Only site editors can read feedback'); }
    $q = isset($req['query']) && is_array($req['query']) ? $req['query'] : [];
    $pageId = self::param($q, 'filter', 'pageId');
    $helpful = self::boolParam(self::param($q, 'filter', 'helpful'));
    $handled = self::boolParam(self::param($q, 'filter', 'handled'));
    $hasComment = self::boolParam(self::param($q, 'filter', 'hasComment'));
    $from = self::dayParam(self::param($q, 'filter', 'from'));
    $to = self::dayParam(self::param($q, 'filter', 'to'));
    if ($helpful === 'invalid' || $handled === 'invalid' || $hasComment === 'invalid') { return self::bad(422, 'A true or false filter must be true or false'); }
    if ($from === 'invalid' || $to === 'invalid') { return self::bad(422, 'Dates are written YYYY-MM-DD'); }
    $limit = min(200, max(1, self::int(self::param($q, 'page', 'limit'), 25)));
    $offset = max(0, self::int(self::param($q, 'page', 'offset'), 0));
    $reasons = self::reasonsOf($ctx->settings);
    $found = array_values(array_filter(self::allFeedback($ctx), function ($x) use ($pageId, $helpful, $handled, $hasComment, $from, $to) {
      return ($pageId === null || (is_scalar($pageId) && $x['pageId'] === (string) $pageId))
        && ($helpful === null || $x['helpful'] === $helpful)
        && ($handled === null || $x['handled'] === $handled)
        && ($hasComment === null || ($x['comment'] !== '') === $hasComment)
        && ($from === null || $x['ts'] >= $from)
        && ($to === null || $x['ts'] < $to + self::DAY);
    }));
    usort($found, function ($a, $b) { return ($b['ts'] <=> $a['ts']) ?: (self::seqOf($b) <=> self::seqOf($a)); });
    $items = [];
    foreach (array_slice($found, $offset, $limit) as $x) { $items[] = self::view($x, $reasons); }
    return ['items' => $items, 'total' => count($found), 'limit' => $limit, 'offset' => $offset];
  }

  /**
   * Implements operation pageFeedbackHandle.
   *
   * Marks one response handled (or not handled again) so the team can tell what still needs attention.
   *
   * @param object $ctx
   * @param array $req  params.id; body: { handled }.
   * @return array  { id, handled }, or a 403/404/422 response.
   */
  public function pageFeedbackHandle($ctx, $req) {
    if (!self::isEditor($ctx->user)) { return self::bad(403, 'Only site editors can change feedback'); }
    if (!is_array($req['body'] ?? null) || !is_bool($req['body']['handled'] ?? null)) { return self::bad(422, 'handled must be true or false'); }
    $list = self::allFeedback($ctx);
    foreach ($list as $i => $x) {
      if ($x['id'] === ($req['params']['id'] ?? null)) {
        $list[$i]['handled'] = $req['body']['handled'];
        $ctx->storage->write('feedback', $list);
        return ['id' => $x['id'], 'handled' => $list[$i]['handled']];
      }
    }
    return self::bad(404, 'Not found');
  }

  /**
   * Implements operation pageFeedbackDelete.
   *
   * Deletes one response for good.
   *
   * @param object $ctx
   * @param array $req  params.id.
   * @return array  { deleted: id }, or a 403/404 response.
   */
  public function pageFeedbackDelete($ctx, $req) {
    if (!self::isEditor($ctx->user)) { return self::bad(403, 'Only site editors can delete feedback'); }
    $list = self::allFeedback($ctx);
    foreach ($list as $i => $x) {
      if ($x['id'] === ($req['params']['id'] ?? null)) {
        array_splice($list, $i, 1);
        $ctx->storage->write('feedback', $list);
        return ['deleted' => $x['id']];
      }
    }
    return self::bad(404, 'Not found');
  }

  /**
   * Implements operation pageFeedbackSummary.
   *
   * Adds feedback up per page for site editors: the share of helpful answers, the number of responses and the most
   * picked reason, with the pages that helped least first.
   *
   * @param object $ctx
   * @return array  { items, totals }, or a 403 response.
   */
  public function pageFeedbackSummary($ctx) {
    if (!self::isEditor($ctx->user)) { return self::bad(403, 'Only site editors can read feedback'); }
    $reasons = self::reasonsOf($ctx->settings);
    $list = self::allFeedback($ctx);
    $pages = [];
    $yes = 0;
    $open = 0;
    foreach ($list as $x) {
      $key = 'p:' . $x['pageId'];
      if (!isset($pages[$key])) { $pages[$key] = ['pageId' => $x['pageId'], 'title' => $x['pageTitle'], 'ts' => $x['ts'], 'responses' => 0, 'helpful' => 0, 'comments' => 0, 'counts' => []]; }
      $pages[$key]['responses'] += 1;
      if ($x['helpful']) { $pages[$key]['helpful'] += 1; $yes += 1; }
      if ($x['comment'] !== '') { $pages[$key]['comments'] += 1; }
      if (!$x['handled']) { $open += 1; }
      if ($x['ts'] >= $pages[$key]['ts']) { $pages[$key]['ts'] = $x['ts']; $pages[$key]['title'] = $x['pageTitle']; }
      foreach ($x['reasons'] as $id) { $pages[$key]['counts']['r:' . $id] = ($pages[$key]['counts']['r:' . $id] ?? 0) + 1; }
    }
    $rank = function ($rid) use ($reasons) {
      foreach ($reasons as $i => $r) { if ($r['id'] === $rid) { return $i; } }
      return count($reasons);
    };
    $items = [];
    foreach ($pages as $p) {
      // the most picked reason; a tie goes to the one listed first in settings, then to the id
      $counts = [];
      foreach ($p['counts'] as $k => $n) { $counts[] = ['id' => substr($k, 2), 'n' => $n]; }
      usort($counts, function ($a, $b) use ($rank) { return ($b['n'] <=> $a['n']) ?: (($rank($a['id']) <=> $rank($b['id'])) ?: strcmp($a['id'], $b['id'])); });
      $top = count($counts) ? $counts[0]['id'] : null;
      $helpfulPercent = self::percent($p['helpful'], $p['responses']);
      $topReason = $top === null ? null : self::labelOf($reasons, $top);
      $items[] = [
        'pageId' => $p['pageId'], 'title' => $p['title'], 'responses' => $p['responses'], 'helpful' => $p['helpful'], 'helpfulPercent' => $helpfulPercent, 'comments' => $p['comments'], 'topReasonId' => $top, 'topReason' => $topReason,
        'description' => $helpfulPercent . '% helpful, ' . $p['responses'] . ' ' . ($p['responses'] === 1 ? 'response' : 'responses') . ', top reason: ' . ($topReason === null ? 'none' : $topReason),
      ];
    }
    usort($items, function ($a, $b) { return ($a['helpfulPercent'] <=> $b['helpfulPercent']) ?: (($b['responses'] <=> $a['responses']) ?: strcmp($a['pageId'], $b['pageId'])); });
    return ['items' => $items, 'totals' => ['responses' => count($list), 'helpful' => $yes, 'helpfulPercent' => self::percent($yes, count($list)), 'unhandled' => $open]];
  }

  /**
   * Implements hook config.before.save.
   *
   * Refuses settings that would break the prompt or send feedback somewhere unsafe: empty labels, malformed or
   * repeated reason ids, out-of-range numbers, and a webhook address that is not https, has no host, carries a sign-in
   * or points at a private address. Warns when no destination is left on.
   *
   * @param object $ctx  subject: { plugin, scope, values }.
   * @return mixed  the subject unchanged, or a veto (422).
   */
  public function configBeforeSave($ctx) {
    $v = is_array($ctx->subject) && isset($ctx->subject['values']) && is_array($ctx->subject['values']) ? $ctx->subject['values'] : [];
    foreach ([['question', 'The question', 200], ['yesLabel', 'The Yes label', 40], ['noLabel', 'The No label', 40]] as [$key, $name, $max]) {
      $t = $v[$key] ?? null;
      if (!is_string($t) || self::trimAscii($t) === '' || self::chars($t) > $max) { return $ctx->veto($name . ' needs 1 to ' . $max . ' characters', 422); }
    }
    $list = $v['reasons'] ?? null;
    if (!self::isList($list) || count($list) > 12) { return $ctx->veto('Reasons must be a list of up to 12', 422); }
    $seen = [];
    foreach ($list as $r) {
      if (!is_array($r) || !is_string($r['id'] ?? null) || strlen($r['id']) > 40 || !preg_match(self::ID_RE, $r['id'])) { return $ctx->veto('A reason id uses lower-case letters, numbers and dashes, up to 40 characters', 422); }
      if (!is_string($r['label'] ?? null) || self::trimAscii($r['label']) === '' || self::chars($r['label']) > 80) { return $ctx->veto('The reason "' . $r['id'] . '" needs a label of 1 to 80 characters', 422); }
      if (in_array($r['id'], $seen, true)) { return $ctx->veto('The reason id "' . $r['id'] . '" is used twice', 422); }
      $seen[] = $r['id'];
    }
    foreach ([['commentMaxLength', 'The longest comment', 1, 5000], ['retentionDays', 'Days to keep feedback', 0, 3650], ['maxPerHour', 'Responses per hour', 0, 100000]] as [$key, $name, $min, $max]) {
      $n = self::int($v[$key] ?? null, -1);
      if ($n < $min || $n > $max) { return $ctx->veto($name . ' must be a whole number from ' . $min . ' to ' . $max, 422); }
    }
    if (!in_array($v['notifyOn'] ?? null, self::NOTIFY, true)) { return $ctx->veto('Choose which responses are sent on: all, negative or comments', 422); }
    foreach (self::rolesOf($v) as $role) {
      if (strlen($role) > 40 || !preg_match(self::ID_RE, $role)) { return $ctx->veto('Roles to notify are names such as admin or editor, separated by commas', 422); }
    }
    $url = self::trimAscii(isset($v['webhookUrl']) && is_string($v['webhookUrl']) ? $v['webhookUrl'] : '');
    $secret = isset($v['webhookSecret']) && is_string($v['webhookSecret']) ? $v['webhookSecret'] : '';
    if ($url !== '') {
      $host = self::webhookHost($url);
      if ($host === '') { return $ctx->veto(self::WEBHOOK_HELP, 422); }
      if (self::isPrivateHost($host)) { return $ctx->veto('The webhook address cannot be a private or local address', 422); }
    } elseif (($v['webhookEnabled'] ?? false) === true) {
      return $ctx->veto('The webhook is on but has no address. ' . self::WEBHOOK_HELP, 422);
    } elseif ($secret !== '') {
      return $ctx->veto('A webhook secret needs a webhook address to belong to', 422);
    }
    $header = isset($v['webhookSecretHeader']) && is_string($v['webhookSecretHeader']) ? $v['webhookSecretHeader'] : '';
    if (strlen($header) > 64 || !preg_match(self::HEADER_RE, $header) || in_array(strtolower($header), self::FORBIDDEN_HEADERS, true)) { return $ctx->veto('The webhook secret header must be a header name of your own, such as x-page-feedback-secret', 422); }
    if (($v['inbox'] ?? true) === false && ($v['webhookEnabled'] ?? false) !== true) { $ctx->warn('No destination is on: feedback is only passed to other plugins and is not kept'); }
    return $ctx->subject;
  }

  /**
   * Implements hook render.after.content.
   *
   * Hands the site's question, labels, reasons and the address to post to every placed page-feedback block, and adds
   * the block at the end of the page when the site shows it everywhere and the page did not opt out. Published static
   * copies get no address, so the block thanks the reader and only fires its events.
   *
   * @param object $ctx  subject: the render context (page, mode, content).
   * @return array|null  the context with the block configured, or nothing to leave it alone.
   */
  public function renderAfterContent($ctx) {
    $c = $ctx->subject;
    if (!is_array($c) || !is_array($c['page'] ?? null) || !is_string($c['page']['id'] ?? null)) { return null; }
    $s = $ctx->settings;
    $content = (string) ($c['content'] ?? '');
    $placed = preg_match(self::TAG_RE, $content) === 1;
    $own = $c['page']['metadata']['plugins']['page-feedback'] ?? [];
    $everywhere = ($s['showOnEveryPage'] ?? false) === true && (is_array($own) ? ($own['hide'] ?? null) : null) !== true;
    if (!$placed && !$everywhere) { return null; }
    $config = [
      'endpoint' => ($c['mode'] ?? null) === 'publish' ? null : self::ROUTE . 'feedback',
      'pageId' => $c['page']['id'],
      'question' => (string) ($s['question'] ?? ''),
      'yesLabel' => (string) ($s['yesLabel'] ?? ''),
      'noLabel' => (string) ($s['noLabel'] ?? ''),
      'reasons' => self::reasonsOf($s),
      'allowComments' => ($s['allowComments'] ?? true) !== false,
      'commentMaxLength' => self::maxLength($s),
      'anonymous' => ($s['anonymous'] ?? true) !== false,
    ];
    $attr = ' data-config="' . self::esc(json_encode($config, self::JSON_FLAGS)) . '"';
    $c['content'] = $placed
      ? preg_replace_callback(self::TAG_RE, function () use ($attr) { return '<page-feedback' . $attr; }, $content)
      : $content . '<page-feedback' . $attr . '></page-feedback>';
    return $c;
  }

  /**
   * Implements hook page.after.delete.
   *
   * Removes the feedback of a deleted page so nothing is left pointing at a page that no longer exists.
   *
   * @param object $ctx  subject: the deleted page.
   * @return void
   */
  public function pageAfterDelete($ctx) {
    $list = self::allFeedback($ctx);
    $id = $ctx->subject['id'] ?? null;
    $keep = array_values(array_filter($list, function ($x) use ($id) { return $x['pageId'] !== $id; }));
    if (count($keep) !== count($list)) {
      $ctx->storage->write('feedback', $keep);
      $ctx->log->info('removed ' . (count($list) - count($keep)) . ' feedback responses with page ' . $id);
    }
  }

  /**
   * Implements schedule prune.
   *
   * Deletes feedback older than the retentionDays setting; does nothing while it is 0.
   *
   * @param object $ctx
   * @return array  { removed } with the number of responses deleted.
   */
  public function prune($ctx) {
    $list = self::allFeedback($ctx);
    $keep = self::fresh($list, $ctx->settings, $ctx->now());
    if (count($keep) !== count($list)) { $ctx->storage->write('feedback', $keep); }
    return ['removed' => count($list) - count($keep)];
  }
}

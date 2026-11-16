<?php
// Quick poll (PHP). Mirrors src/nodejs/index.js; both return identical results.
// The server never trusts the browser about a poll: it reads the poll (question, options, when results show, when it
// closes, whether a vote may change) from the page's saved content. Identity comes only from $ctx->user. A visitor who
// is not signed in is told apart by a random key the poll keeps in that browser, stored only as a hash. No IP address
// or user agent is read or stored anywhere in this file.
class QuickPollPlugin {
  const EDITORS = ['admin', 'editor'];
  const HOUR = 3600000;
  const LATEST_ZONE = 43200000; // a closing time with no zone has passed everywhere 12 hours after it passed in UTC
  const ROUTE = 'x/api/v1/plugins/quick-poll/votes';
  const MODES = ['after', 'closed', 'never'];
  const POLL_RE = '/<quick-poll\b([^>]*)>([\s\S]*?)<\/quick-poll\s*>/i';
  const OPEN_RE = '/<quick-poll\b([^>]*)>/i';
  const ATTR_RE = '/([^\s="\'<>\/]+)(?:\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'=<>`]+)))?/';
  const INPUT_RE = '/<input\b([^>]*)>/i';
  const ENTITY_RE = '/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|amp|lt|gt|quot|apos|nbsp);/';
  const SPACE_RE = '/[\t\n\x{0B}\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+/u';
  const CLOSES_RE = '/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/D';
  const VOTER_RE = '/^[0-9a-f]{32}$/D';
  const CHOICE_RE = '/^c-[0-9a-f]{8}(-[0-9]{1,3})?$/D';

  private static function isObj($v) { return is_array($v) && (count($v) === 0 || !array_is_list($v)); }
  private static function bad($status, $error) { return ['status' => $status, 'body' => ['error' => $error]]; }
  private static function isEditor($user) { return is_array($user) && count(array_intersect($user['roles'] ?? [], self::EDITORS)) > 0; }
  private static function esc($s) { return str_replace(['&', '<', '>', '"', "'"], ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'], (string) $s); }

  /** A whole number from a setting (a number or a string of digits); otherwise the fallback. */
  private static function int($v, $fallback) {
    if (is_int($v)) { return $v; }
    if (is_float($v) && floor($v) === $v) { return (int) $v; }
    if (is_string($v) && $v !== '' && strlen($v) <= 9 && ctype_digit($v)) { return (int) $v; }
    return $fallback;
  }

  /** The host part of an Origin header or of the site address, lower case, or ''. */
  private static function originHost($url) {
    return preg_match('/^[a-z][a-z0-9+.-]*:\/\/([^\/?#]*)/i', (string) $url, $m) ? strtolower($m[1]) : '';
  }

  /** Text of an attribute value: the character references HAX writes, decoded. */
  private static function decode($s) {
    return preg_replace_callback(self::ENTITY_RE, function ($m) {
      $name = $m[1];
      $named = ['amp' => '&', 'lt' => '<', 'gt' => '>', 'quot' => '"', 'apos' => "'", 'nbsp' => "\u{A0}"];
      if (isset($named[$name])) { return $named[$name]; }
      $code = ($name[1] === 'x' || $name[1] === 'X') ? hexdec(substr($name, 2)) : (int) substr($name, 1);
      return $code > 0 && $code <= 0x10FFFF && !($code >= 0xD800 && $code <= 0xDFFF) ? mb_chr($code, 'UTF-8') : $m[0];
    }, (string) $s);
  }

  /** The attributes of an opening tag: lower-case names, decoded values; a bare attribute is ''. The first wins. */
  private static function attributes($text) {
    $out = [];
    preg_match_all(self::ATTR_RE, (string) $text, $all, PREG_SET_ORDER | PREG_UNMATCHED_AS_NULL);
    foreach ($all as $m) {
      $name = strtolower($m[1]);
      $raw = $m[2] ?? $m[3] ?? $m[4] ?? '';
      if (!array_key_exists($name, $out)) { $out[$name] = self::decode($raw); }
    }
    return $out;
  }

  /** 32-bit FNV-1a over UTF-16 code units, as hex: the hash the element uses for ids (user-action xapi.js). */
  private static function fnv($s) {
    $h = 0x811C9DC5;
    $units = mb_convert_encoding((string) $s, 'UTF-16BE', 'UTF-8');
    $n = strlen($units);
    for ($i = 0; $i < $n; $i += 2) {
      $h ^= (ord($units[$i]) << 8) | ord($units[$i + 1]);
      $h = ($h * 0x01000193) & 0xFFFFFFFF;
    }
    return dechex($h);
  }

  /** Option text the way the element compares it: NFC, runs of white space as one space, trimmed. */
  private static function optionText($s) {
    $s = (string) $s;
    if (class_exists('Normalizer')) {
      $n = \Normalizer::normalize($s, \Normalizer::FORM_C);
      if (is_string($n)) { $s = $n; }
    }
    $s = preg_replace(self::SPACE_RE, ' ', $s);
    if (substr($s, 0, 1) === ' ') { $s = substr($s, 1); }
    if (substr($s, -1) === ' ') { $s = substr($s, 0, -1); }
    return $s;
  }

  /** UTF-16 code unit order, as JavaScript compares strings. */
  private static function jsCompare($a, $b) {
    return strcmp(mb_convert_encoding($a, 'UTF-16BE', 'UTF-8'), mb_convert_encoding($b, 'UTF-16BE', 'UTF-8'));
  }

  /** Option ids in order, unique within the poll (the element's componentIds). */
  private static function optionIds($texts) {
    $ids = array_map(function ($t) { return 'c-' . str_pad(self::fnv($t), 8, '0', STR_PAD_LEFT); }, $texts);
    $groups = [];
    foreach ($ids as $i => $id) { $groups[$id][] = $i; }
    foreach ($groups as $id => $g) {
      if (count($g) < 2) { continue; }
      usort($g, function ($a, $b) use ($texts) { $c = self::jsCompare($texts[$a], $texts[$b]); return $c !== 0 ? ($c < 0 ? -1 : 1) : $a - $b; });
      foreach ($g as $n => $index) { $ids[$index] = $n === 0 ? $id : $id . '-' . ($n + 1); }
    }
    return $ids;
  }

  /** encodeURIComponent, which the element applies to the key in its activity id. */
  private static function encodeKey($k) {
    return strtr(rawurlencode($k), ['%21' => '!', '%2A' => '*', '%27' => "'", '%28' => '(', '%29' => ')']);
  }

  /** Milliseconds when a closing time has passed everywhere, or null for none (or one that cannot be read). */
  private static function closesAt($value) {
    if (!preg_match(self::CLOSES_RE, trim((string) $value), $m, PREG_UNMATCHED_AS_NULL)) { return null; }
    $at = gmmktime((int) ($m[4] ?? 0), (int) ($m[5] ?? 0), (int) ($m[6] ?? 0), (int) $m[2], (int) $m[3], (int) $m[1]) * 1000;
    if ($m[4] === null) { return $at; } // a date alone is read as UTC midnight, as the browser does
    if ($m[7] === null) { return $at + self::LATEST_ZONE; }
    if ($m[7] === 'Z') { return $at; }
    $sign = $m[7][0] === '-' ? -1 : 1;
    return $at - $sign * ((int) substr($m[7], 1, 2) * 60 + (int) substr($m[7], 4, 2)) * 60000;
  }

  /**
   * Every poll in a page's saved content, in order: { key, question, mode, closes, allowChange, options: [{ id, label }] }.
   * key is the element's activity key, URI-encoded as in its activity id: the author's id, else its tag plus a hash of
   * the question, with "-1", "-2" for repeats. (The poll does not key on a resource attribute, so neither does this.)
   */
  private static function pollsIn($content) {
    $found = [];
    preg_match_all(self::POLL_RE, (string) $content, $all, PREG_SET_ORDER);
    foreach ($all as $m) {
      $a = self::attributes($m[1]);
      $labels = [];
      preg_match_all(self::INPUT_RE, $m[2], $inputs, PREG_SET_ORDER);
      foreach ($inputs as $im) {
        $ia = self::attributes($im[1]);
        if (array_key_exists('slot', $ia)) { continue; }
        $labels[] = self::optionText($ia['value'] ?? '');
      }
      $question = $a['question'] ?? '';
      $mode = $a['show-results'] ?? null;
      $found[] = [
        'id' => $a['id'] ?? '',
        'base' => 'quick-poll-' . self::fnv("quick-poll\u{1}quick-poll\u{1}" . $question),
        'question' => $question,
        'mode' => in_array($mode, self::MODES, true) ? $mode : 'after',
        'closes' => $a['closes'] ?? '',
        'allowChange' => array_key_exists('allow-change', $a), // a boolean attribute: present means on
        'labels' => $labels,
      ];
    }
    $seen = [];
    $out = [];
    foreach ($found as $p) {
      if ($p['id'] !== '') { $key = $p['id']; }
      else {
        $n = $seen[$p['base']] ?? 0;
        $seen[$p['base']] = $n + 1;
        $key = $n > 0 ? $p['base'] . '-' . $n : $p['base'];
      }
      $ids = self::optionIds($p['labels']);
      $options = [];
      foreach ($p['labels'] as $i => $label) { $options[] = ['id' => $ids[$i], 'label' => $label]; }
      $out[] = ['key' => self::encodeKey($key), 'question' => $p['question'], 'mode' => $p['mode'], 'closes' => $p['closes'], 'allowChange' => $p['allowChange'], 'options' => $options];
    }
    return $out;
  }

  /** The poll an activity id names on a page, or null. */
  private static function findPoll($page, $activity) {
    $at = strpos($activity, '#');
    if ($at === false) { return null; }
    $key = substr($activity, $at + 1);
    foreach (self::pollsIn($page['content'] ?? '') as $p) { if ($p['key'] === $key) { return $p; } }
    return null;
  }

  private static function isClosed($poll, $now) { $at = self::closesAt($poll['closes']); return $at !== null && $now >= $at; }

  /** Whether this caller may see the counts: editors always; otherwise as the poll says. */
  private static function visible($poll, $user, $now) {
    if (self::isEditor($user)) { return true; }
    if ($poll['mode'] === 'never') { return false; }
    if ($poll['mode'] === 'closed') { return self::isClosed($poll, $now); }
    return true;
  }

  private static function allBallots($ctx) {
    $list = $ctx->storage->read('ballots');
    return is_array($list) && array_is_list($list) ? $list : [];
  }

  /** Counts for every option of a poll, in the poll's order, zeros included. */
  private static function countsOf($poll, $ballots, $pageId) {
    $counts = [];
    foreach ($poll['options'] as $o) { $counts[$o['id']] = 0; }
    foreach ($ballots as $b) {
      if ($b['pageId'] === $pageId && $b['poll'] === $poll['key'] && array_key_exists($b['choice'], $counts)) { $counts[$b['choice']] += 1; }
    }
    return (object) $counts;
  }

  private static function percent($n, $total) { return $total > 0 ? intdiv($n * 200 + $total, 2 * $total) : 0; }

  /** The page and poll a request names, or a response explaining why not. */
  private static function locate($ctx, $pageId, $activity) {
    if (!is_string($pageId) || $pageId === '' || strlen($pageId) > 200) { return ['error' => self::bad(422, 'pageId must name a page')]; }
    if (!is_string($activity) || $activity === '' || strlen($activity) > 2000) { return ['error' => self::bad(422, 'activityId must name a poll')]; }
    $page = $ctx->entities->get('page', $pageId);
    if (!$page) { return ['error' => self::bad(404, 'No such page')]; }
    $poll = self::findPoll($page, $activity);
    if (!$poll) { return ['error' => self::bad(404, 'That poll is not on this page')]; }
    return ['page' => $page, 'poll' => $poll];
  }

  /**
   * Implements operation quickPollVote.
   *
   * Counts one vote: finds the poll in the page's saved content, checks the option is one of its own, refuses votes
   * after it closes, keeps one vote per person (a signed-in user, or a visitor's browser key stored only as a hash)
   * and changes a vote only when the poll allows it. Answers with the counts when this caller may see them.
   *
   * @param object $ctx
   * @param array $req  query.pageId; body: { activityId, choice, voter }; headers.origin when a browser sent it.
   * @return array  { vote, counts } or { vote, counts: {}, hidden: true }, or a 403/404/409/422/429 response.
   */
  public function quickPollVote($ctx, $req) {
    $s = $ctx->settings;
    $b = $req['body'] ?? null;
    if (!self::isObj($b)) { return self::bad(422, 'Send activityId and choice'); }
    $origin = isset($req['headers']['origin']) && is_string($req['headers']['origin']) ? $req['headers']['origin'] : '';
    if ($origin !== '' && self::originHost($origin) !== self::originHost($ctx->site['url'])) { return self::bad(403, 'Votes can only be sent from this site'); }
    $q = self::isObj($req['query'] ?? null) ? $req['query'] : [];
    $pageId = $q['pageId'] ?? null;
    $found = self::locate($ctx, $pageId, $b['activityId'] ?? null);
    if (isset($found['error'])) { return $found['error']; }
    $poll = $found['poll'];
    $choice = $b['choice'] ?? null;
    $known = is_string($choice) && preg_match(self::CHOICE_RE, $choice) === 1 && count(array_filter($poll['options'], function ($o) use ($choice) { return $o['id'] === $choice; })) > 0;
    if (!$known) { return self::bad(422, "That is not one of this poll's options"); }
    $now = $ctx->now();
    if (self::isClosed($poll, $now)) { return self::bad(409, 'This poll is closed'); }
    if ($ctx->user) { $voter = 'u:' . $ctx->user['id']; }
    else {
      if (($s['anonymousVoting'] ?? true) === false) { return self::bad(403, 'Sign in to vote in this poll'); }
      $token = $b['voter'] ?? null;
      if (!is_string($token) || !preg_match(self::VOTER_RE, $token)) { return self::bad(422, 'Send the voter key the poll made'); }
      $voter = 'v:' . substr(hash('sha256', $pageId . "\u{1}" . $poll['key'] . "\u{1}" . $token), 0, 32);
    }
    $list = self::allBallots($ctx);
    $mine = null;
    foreach ($list as $i => $x) { if ($x['pageId'] === $pageId && $x['poll'] === $poll['key'] && $x['voter'] === $voter) { $mine = $i; break; } }
    if ($mine !== null && $list[$mine]['choice'] !== $choice && !$poll['allowChange']) { return self::bad(409, 'Your vote is already in'); }
    if ($mine === null || $list[$mine]['choice'] !== $choice) {
      // flood guard: a count per hour for the whole site, with nothing recorded about who sent what
      $stored = $ctx->storage->read('meta');
      $meta = ['windowStart' => self::int(self::isObj($stored) ? ($stored['windowStart'] ?? 0) : 0, 0), 'count' => self::int(self::isObj($stored) ? ($stored['count'] ?? 0) : 0, 0)];
      if ($now - $meta['windowStart'] >= self::HOUR) { $meta['windowStart'] = $now; $meta['count'] = 0; }
      $cap = self::int($s['maxPerHour'] ?? 0, 0);
      if ($cap > 0 && $meta['count'] >= $cap) { return self::bad(429, 'Too many votes in the last hour. Please try again later.'); }
      $meta['count'] += 1;
      $ctx->storage->write('meta', $meta);
      if ($mine !== null) {
        $list[$mine]['choice'] = $choice;
        $list[$mine]['ts'] = $now;
      } else {
        $row = ['pageId' => $pageId, 'poll' => $poll['key'], 'voter' => $voter, 'choice' => $choice, 'ts' => $now];
        if ($ctx->user) { $row['userId'] = $ctx->user['id']; }
        $list[] = $row;
      }
      $ctx->storage->write('ballots', $list);
    }
    if (!self::visible($poll, $ctx->user, $now)) { return ['vote' => $choice, 'counts' => (object) [], 'hidden' => true]; }
    return ['vote' => $choice, 'counts' => self::countsOf($poll, $list, $pageId)];
  }

  /**
   * Implements operation quickPollResults.
   *
   * The counts for one poll, when this caller may see them: everyone for "after", everyone once the poll has closed
   * for "closed", editors only for "never".
   *
   * @param object $ctx
   * @param array $req  query: { pageId, activityId }.
   * @return array  { counts } or { counts: {}, hidden: true }, or a 404/422 response.
   */
  public function quickPollResults($ctx, $req) {
    $q = self::isObj($req['query'] ?? null) ? $req['query'] : [];
    $found = self::locate($ctx, $q['pageId'] ?? null, $q['activityId'] ?? null);
    if (isset($found['error'])) { return $found['error']; }
    if (!self::visible($found['poll'], $ctx->user, $ctx->now())) { return ['counts' => (object) [], 'hidden' => true]; }
    return ['counts' => self::countsOf($found['poll'], self::allBallots($ctx), $q['pageId'])];
  }

  /**
   * Implements operation quickPollList.
   *
   * Every poll that has votes, for site editors: its page, question, total and each option's count and share, the
   * most recently voted first. A poll that is no longer on its page is listed with its stored option ids so it can
   * still be cleared.
   *
   * @param object $ctx
   * @return array  { items, total }, or a 403 response.
   */
  public function quickPollList($ctx) {
    if (!self::isEditor($ctx->user)) { return self::bad(403, 'Only site editors can read poll results'); }
    $groups = [];
    foreach (self::allBallots($ctx) as $b) {
      $k = $b['pageId'] . "\u{1}" . $b['poll'];
      if (!isset($groups[$k])) { $groups[$k] = ['pageId' => $b['pageId'], 'poll' => $b['poll'], 'ts' => $b['ts'], 'ballots' => []]; }
      $groups[$k]['ballots'][] = $b;
      if ($b['ts'] > $groups[$k]['ts']) { $groups[$k]['ts'] = $b['ts']; }
    }
    $pages = [];
    $items = [];
    foreach ($groups as $g) {
      if (!array_key_exists($g['pageId'], $pages)) { $pages[$g['pageId']] = $ctx->entities->get('page', $g['pageId']); }
      $page = $pages[$g['pageId']];
      $poll = null;
      if ($page) { foreach (self::pollsIn($page['content'] ?? '') as $p) { if ($p['key'] === $g['poll']) { $poll = $p; break; } } }
      $options = [];
      if ($poll) { foreach ($poll['options'] as $o) { $options[] = ['id' => $o['id'], 'label' => $o['label'], 'count' => 0]; } }
      foreach ($g['ballots'] as $b) {
        $at = null;
        foreach ($options as $i => $o) { if ($o['id'] === $b['choice']) { $at = $i; break; } }
        if ($at === null) { $options[] = ['id' => $b['choice'], 'label' => $b['choice'], 'count' => 0]; $at = count($options) - 1; }
        $options[$at]['count'] += 1;
      }
      $total = count($g['ballots']);
      $top = null;
      foreach ($options as $i => $o) {
        $options[$i]['percent'] = self::percent($o['count'], $total);
        if ($top === null || $o['count'] > $options[$top]['count']) { $top = $i; }
      }
      $question = $poll ? ($poll['question'] !== '' ? $poll['question'] : '(no question)') : '(no longer on its page)';
      $items[] = [
        'pageId' => $g['pageId'],
        'pageTitle' => $page && is_string($page['title'] ?? null) && $page['title'] !== '' ? $page['title'] : $g['pageId'],
        'poll' => $g['poll'],
        'question' => $question,
        'onPage' => $poll !== null,
        'showResults' => $poll ? $poll['mode'] : null,
        'total' => $total,
        'options' => $options,
        'ts' => $g['ts'],
        'description' => $total . ' ' . ($total === 1 ? 'vote' : 'votes') . '; most picked: ' . $options[$top]['label'] . ' (' . $options[$top]['percent'] . '%)',
      ];
    }
    usort($items, function ($a, $b) {
      if ($a['ts'] !== $b['ts']) { return $b['ts'] <=> $a['ts']; }
      if ($a['pageId'] !== $b['pageId']) { return strcmp($a['pageId'], $b['pageId']) < 0 ? -1 : 1; }
      return strcmp($a['poll'], $b['poll']) <=> 0;
    });
    return ['items' => $items, 'total' => count($items)];
  }

  /**
   * Implements operation quickPollClear.
   *
   * Clears votes for site editors: every poll on one page, or one poll when poll (its key from quickPollList) is
   * given. People can vote again afterwards.
   *
   * @param object $ctx
   * @param array $req  body: { pageId, poll }.
   * @return array  { cleared } with the number of votes removed, or a 403/422 response.
   */
  public function quickPollClear($ctx, $req) {
    if (!self::isEditor($ctx->user)) { return self::bad(403, 'Only site editors can clear votes'); }
    $b = self::isObj($req['body'] ?? null) ? $req['body'] : [];
    $pageId = $b['pageId'] ?? null;
    if (!is_string($pageId) || $pageId === '' || strlen($pageId) > 200) { return self::bad(422, 'Open Insights for one page, or send the pageId of the page whose polls to clear'); }
    $one = $b['poll'] ?? null;
    if ($one !== null && (!is_string($one) || $one === '' || strlen($one) > 2000)) { return self::bad(422, 'poll must be a poll key from the list'); }
    $list = self::allBallots($ctx);
    $keep = array_values(array_filter($list, function ($x) use ($pageId, $one) { return !($x['pageId'] === $pageId && ($one === null || $x['poll'] === $one)); }));
    $cleared = count($list) - count($keep);
    if ($cleared > 0) {
      $ctx->storage->write('ballots', $keep);
      $ctx->log->info('cleared ' . $cleared . ' poll votes on page ' . $pageId);
    }
    return ['cleared' => $cleared];
  }

  /**
   * Implements hook config.before.save.
   *
   * Refuses settings the poll cannot work with: a flood guard that is not a whole number from 0 to 100000, or
   * visitor voting that is not on or off.
   *
   * @param object $ctx  subject: { plugin, scope, values }.
   * @return mixed  the subject unchanged, or a veto (422).
   */
  public function configBeforeSave($ctx) {
    $v = is_array($ctx->subject['values'] ?? null) ? $ctx->subject['values'] : [];
    $n = self::int($v['maxPerHour'] ?? null, -1);
    if ($n < 0 || $n > 100000) { return $ctx->veto('Votes per hour must be a whole number from 0 to 100000', 422); }
    if (!is_bool($v['anonymousVoting'] ?? null)) { return $ctx->veto('Voting without signing in must be on or off', 422); }
    return $ctx->subject;
  }

  /**
   * Implements hook render.after.content.
   *
   * Gives every placed poll that has no address of its own the address that counts its votes, with the page it is on.
   * Published static copies get no address, so the poll keeps the vote in the browser and shows no results.
   *
   * @param object $ctx  subject: the render context (page, mode, content).
   * @return array|null  the context with the polls configured, or nothing to leave it alone.
   */
  public function renderAfterContent($ctx) {
    $c = $ctx->subject;
    if (!is_array($c) || !is_array($c['page'] ?? null) || !is_string($c['page']['id'] ?? null) || ($c['mode'] ?? null) === 'publish') { return null; }
    $content = (string) ($c['content'] ?? '');
    if (!preg_match(self::OPEN_RE, $content)) { return null; }
    $endpoint = ' endpoint="' . self::esc(self::ROUTE . '?pageId=' . self::encodeKey($c['page']['id'])) . '"';
    $c['content'] = preg_replace_callback(self::OPEN_RE, function ($m) use ($endpoint) {
      return array_key_exists('endpoint', self::attributes($m[1])) ? $m[0] : '<quick-poll' . $endpoint . $m[1] . '>';
    }, $content);
    return $c;
  }

  /**
   * Implements hook page.after.delete.
   *
   * Removes the votes of a deleted page's polls.
   *
   * @param object $ctx  subject: the deleted page.
   * @return void
   */
  public function pageAfterDelete($ctx) {
    $list = self::allBallots($ctx);
    $id = $ctx->subject['id'] ?? null;
    $keep = array_values(array_filter($list, function ($x) use ($id) { return $x['pageId'] !== $id; }));
    if (count($keep) !== count($list)) {
      $ctx->storage->write('ballots', $keep);
      $ctx->log->info('removed ' . (count($list) - count($keep)) . ' poll votes with page ' . $id);
    }
  }
}

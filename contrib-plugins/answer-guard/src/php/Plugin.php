<?php
// Answer guard (PHP). Mirrors src/nodejs/index.js.
class AnswerGuardPlugin {
  const NS = 'answer-guard';
  const EDITORS = ['admin', 'editor'];
  const OPEN_LICENSE = '/^(cc0|cc[- ]?by|by(-|$)|public[- ]?domain|pd$)/i';
  const TAG = '/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/';
  const VALUE = '(?:"[^"]*"|\'[^\']*\'|[^\s"\'>]+)';

  private function esc($s) { return htmlspecialchars((string) $s, ENT_QUOTES | ENT_HTML5, 'UTF-8'); }
  private function escAttr($s) { return str_replace(['&', '<', '>', '"', "'"], ['&amp;', '&lt;', '&gt;', '&quot;', '&#39;'], (string) $s); }
  private function decode($s) { return str_replace(['&quot;', '&#39;', '&lt;', '&gt;', '&amp;'], ['"', "'", '<', '>', '&'], (string) $s); }
  private function norm($s) { return trim(preg_replace('/\s+/u', ' ', (string) $s)); }
  private function isEditor($user) { return is_array($user) && count(array_intersect($user['roles'] ?? [], self::EDITORS)) > 0; }
  private function asMap($v) { return is_array($v) ? $v : []; }
  private function asList($v) { return is_array($v) ? array_values($v) : []; }

  private function attr($attrs, $name) {
    if (!preg_match('/(?:^|\s)' . preg_quote($name, '/') . '\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'>]+))/i', $attrs, $m)) { return null; }
    foreach ([1, 2, 3] as $i) { if (isset($m[$i]) && $m[$i] !== '') { return $this->decode($m[$i]); } }
    return '';
  }
  private function inputCorrect($attrs) {
    $dc = $this->attr($attrs, 'data-correct');
    if ($dc !== null) { return strtolower($dc) !== 'false'; }
    return preg_match('/(?:^|\s)correct(?=[\s=\/>]|$)/i', $attrs) === 1;
  }
  private function stripInput($tag) {
    $tag = preg_replace('/\s+data-correct(?:\s*=\s*' . self::VALUE . ')?/i', '', $tag);
    $tag = preg_replace('/\s+data-(?:un)?selected(?:\s*=\s*' . self::VALUE . ')?/i', '', $tag);
    return preg_replace('/\s+correct(?:\s*=\s*' . self::VALUE . ')?(?=[\s\/>])/i', '', $tag);
  }
  private function tagsFrom($settings) {
    $out = [];
    foreach (explode(',', (string) ($settings['elements'] ?? 'multiple-choice')) as $t) {
      $t = strtolower(trim($t));
      if (preg_match(self::TAG, $t)) { $out[] = $t; }
    }
    return $out;
  }

  // Same rules as scan() in src/nodejs/index.js: returns ['content' => ..., 'keys' => [key => ['tag', 'choices']]].
  public function scan($html, $tags, $strip) {
    $keys = [];
    $html = (string) $html;
    if (!$tags) { return ['content' => $html, 'keys' => $keys]; }
    $re = '/<(' . implode('|', $tags) . ')\b([^>]*)>([\s\S]*?)<\/\1\s*>/i';
    $content = preg_replace_callback($re, function ($mm) use (&$keys, $strip) {
      list($whole, $tag, $attrs, $inner) = $mm;
      preg_match_all('/<input\b([^>]*)>/i', $inner, $inputs, PREG_SET_ORDER);
      if (!$inputs) { return $whole; }
      $choices = [];
      foreach ($inputs as $in) {
        $value = $this->attr($in[1], 'value');
        $c = ['label' => $this->norm($value === null ? '' : $value), 'correct' => $this->inputCorrect($in[1])];
        $sel = $this->attr($in[1], 'data-selected');
        $unsel = $this->attr($in[1], 'data-unselected');
        if ($sel !== null) { $c['selected'] = $sel; }
        if ($unsel !== null) { $c['unselected'] = $unsel; }
        $choices[] = $c;
      }
      $text = $this->norm($this->decode(preg_replace('/<[^>]*>/', ' ', preg_replace('/<input\b[^>]*>/i', ' ', $inner))));
      $authored = $this->attr($attrs, 'id');
      if ($authored === null || $authored === '') { $authored = $this->attr($attrs, 'resource'); }
      $key = ($authored !== null && $authored !== '') ? substr(preg_replace('/[^A-Za-z0-9_.:-]/', '', $authored), 0, 200) : '';
      if ($key === '') {
        $labels = implode("\n", array_map(function ($c) { return $c['label']; }, $choices));
        $key = 'fp-' . substr(hash('sha256', strtolower($tag) . "\n" . $text . "\n" . $labels), 0, 16);
      }
      $base = $key;
      for ($n = 2; isset($keys[$key]); $n++) { $key = $base . '-' . $n; }
      $keys[$key] = ['tag' => strtolower($tag), 'choices' => $choices];
      if (!$strip) { return $whole; }
      $cleaned = preg_replace_callback('/<input\b[^>]*>/i', function ($t) { return $this->stripInput($t[0]); }, $inner);
      return '<' . $tag . $attrs . ' data-answer-guard-key="' . $this->escAttr($key) . '">' . $cleaned . '</' . $tag . '>';
    }, $html);
    return ['content' => $content, 'keys' => $keys];
  }

  private function isProtected($ctx) {
    $mode = $ctx->settings['protect'] ?? 'auto';
    if ($mode === 'never') { return false; }
    if ($mode === 'always') { return true; }
    $site = $ctx->entities->get('site') ?: [];
    $license = (string) ($site['license'] ?? '');
    return !($license !== '' && preg_match(self::OPEN_LICENSE, $license));
  }
  private function redact($ctx, $record) {
    if (is_array($record) && isset($record['content']) && is_string($record['content'])) {
      $record['content'] = $this->scan($record['content'], $this->tagsFrom($ctx->settings), true)['content'];
    }
    return $record;
  }

  /**
   * Implements hook page.after.save.
   *
   * Indexes the answer keys of the guarded questions on the saved page into the server-only keys store, whatever the
   * protect setting, so turning protection on later needs no re-save.
   *
   * @param object $ctx  subject: the page as written.
   * @return null
   */
  public function pageAfterSave($ctx) {
    $all = $this->asMap($ctx->storage->read('keys'));
    $keys = $this->scan($ctx->subject['content'] ?? '', $this->tagsFrom($ctx->settings), false)['keys'];
    if ($keys) { $all[$ctx->subject['id']] = $keys; } else { unset($all[$ctx->subject['id']]); }
    $ctx->storage->write('keys', (object) $all);
    return null;
  }

  /**
   * Implements hook page.after.delete.
   *
   * Drops the deleted page's answer keys. Learners' attempts and flags stay until core erases them with the user.
   *
   * @param object $ctx  subject: the deleted page.
   * @return null
   */
  public function pageAfterDelete($ctx) {
    $all = $this->asMap($ctx->storage->read('keys'));
    if (!isset($all[$ctx->subject['id']])) { return null; }
    unset($all[$ctx->subject['id']]);
    $ctx->storage->write('keys', (object) $all);
    return null;
  }

  /**
   * Implements hook plugin.after.enable.
   *
   * When this plugin is the one enabled, indexes every existing page, so questions written before it was enabled are
   * guarded straight away.
   *
   * @param object $ctx  subject: the plugin that was enabled.
   * @return null
   */
  public function pluginAfterEnable($ctx) {
    if (($ctx->subject['id'] ?? null) !== self::NS) { return null; }
    $tags = $this->tagsFrom($ctx->settings);
    $all = [];
    foreach ($ctx->entities->list('page') as $page) {
      $keys = $this->scan($page['content'] ?? '', $tags, false)['keys'];
      if ($keys) { $all[$page['id']] = $keys; }
    }
    $ctx->storage->write('keys', (object) $all);
    $ctx->log->info('indexed guarded questions on ' . count($all) . ' pages');
    return null;
  }

  /**
   * Implements hook entity.after.read.
   *
   * Removes answers from page content a learner loads through the API on a protected site. Editors and admins get
   * the page unchanged, because the editor needs the answers to edit the question.
   *
   * @param object $ctx  subject: the page, or ['items', 'total'] for a list.
   * @return array|null  the redacted page or list, or nothing when it is left alone.
   */
  public function entityAfterRead($ctx) {
    if ($this->isEditor($ctx->user) || !$ctx->subject || !$this->isProtected($ctx)) { return null; }
    $s = $ctx->subject;
    if (isset($s['items']) && is_array($s['items'])) {
      $s['items'] = array_map(function ($r) use ($ctx) { return $this->redact($ctx, $r); }, $s['items']);
      return $s;
    }
    return $this->redact($ctx, $s);
  }

  /**
   * Implements hook render.before.content.
   *
   * On a protected site, removes answers and choice feedback from served pages and marks each guarded question with
   * data-answer-guard-key. Static publishes and the editor preview are left alone (static copies have no server to
   * grade against).
   *
   * @param object $ctx  subject: the render context (page, mode, content).
   * @return array|null  the render context with redacted content, or nothing.
   */
  public function renderBeforeContent($ctx) {
    if (($ctx->subject['mode'] ?? '') !== 'dynamic' || !$this->isProtected($ctx)) { return null; }
    $ctx->subject['content'] = $this->scan($ctx->subject['content'] ?? '', $this->tagsFrom($ctx->settings), true)['content'];
    return $ctx->subject;
  }

  /**
   * Implements hook render.after.body.
   *
   * Adds the answer-guard-monitor singleton, with its settings baked in, to pages that have guarded questions. It
   * filters scripted input, answers the questions' check requests from the plugin's check route and sends flags.
   *
   * @param object $ctx  subject: the render context (page, content, body).
   * @return array|null  the render context with the monitor added, or nothing.
   */
  public function renderAfterBody($ctx) {
    if (($ctx->subject['mode'] ?? '') !== 'dynamic' || strpos((string) ($ctx->subject['content'] ?? ''), 'data-answer-guard-key=') === false) { return null; }
    $s = $ctx->settings;
    $page = $ctx->subject['page'] ?? [];
    $ctx->subject['body']['end'][] = '<script type="module" src="' . $this->escAttr($ctx->assets->url('frontend/dist/answer-guard-monitor.js')) . '"></script>';
    $ctx->subject['body']['end'][] = '<answer-guard-monitor page="' . $this->escAttr($page['id'] ?? '') . '" endpoint="x/api/v1/plugins/' . self::NS . '/" min-answer-ms="' . ((int) ($s['minAnswerMs'] ?? 0)) . '"'
      . (!empty($s['blockUntrusted']) ? ' block-untrusted' : '') . ' honor-prompt="' . $this->escAttr($s['honorPrompt'] ?? '') . '"></answer-guard-monitor>';
    return $ctx->subject;
  }

  /**
   * Implements operation answerGuardCheck.
   *
   * Grades the signed-in learner's choices for one guarded question against the stored key and says only whether
   * they are right, with the feedback the author wrote for the choices. Checks of the same question closer together
   * than minCheckIntervalMs get 429, which slows trying every option; every check is kept for the instructor report.
   *
   * @param object $ctx
   * @param array $req  body: pageId, key, choices (labels).
   * @return array  correct, attempts, feedback; or a 404/429 response.
   */
  public function answerGuardCheck($ctx, $req) {
    $b = $req['body'] ?? [];
    $keys = $this->asMap($ctx->storage->read('keys'));
    $q = $keys[$b['pageId'] ?? ''][$b['key'] ?? ''] ?? null;
    if (!$q) { return ['status' => 404, 'body' => ['error' => 'not a guarded question']]; }
    $attempts = $this->asList($ctx->storage->read('attempts'));
    $uid = $ctx->user['id'];
    $mine = array_values(array_filter($attempts, function ($a) use ($uid, $b) { return $a['userId'] === $uid && $a['pageId'] === $b['pageId'] && $a['key'] === $b['key']; }));
    $gap = (int) ($ctx->settings['minCheckIntervalMs'] ?? 0);
    $now = $ctx->now();
    $last = $mine ? $mine[count($mine) - 1] : null;
    if ($last && $now - $last['at'] < $gap) { return ['status' => 429, 'body' => ['error' => 'wait before checking again', 'retryAfterMs' => $gap - ($now - $last['at'])]]; }
    $chosen = array_values(array_unique(array_map(function ($c) { return $this->norm($c); }, $this->asList($b['choices'] ?? []))));
    $right = [];
    foreach ($q['choices'] as $c) { if (!empty($c['correct'])) { $right[] = $c['label']; } }
    $correct = count($chosen) === count($right);
    foreach ($right as $l) { if (!in_array($l, $chosen, true)) { $correct = false; } }
    $feedback = [];
    foreach ($q['choices'] as $c) {
      $picked = in_array($c['label'], $chosen, true);
      if ($picked && !empty($c['selected'])) { $feedback[] = $c['selected']; }
      if (!$picked && !empty($c['unselected'])) { $feedback[] = $c['unselected']; }
    }
    $attempts[] = ['userId' => $uid, 'pageId' => $b['pageId'], 'key' => $b['key'], 'at' => $now, 'correct' => $correct];
    $ctx->storage->write('attempts', $attempts);
    return ['correct' => $correct, 'attempts' => count($mine) + 1, 'feedback' => $feedback];
  }

  /**
   * Implements operation answerGuardSignal.
   *
   * Turns what the monitor saw while a learner answered one question into flags: scripted input, an automation flag
   * in the browser, no pointer or key input at all, or an answer faster than minAnswerMs. Only flagged answers are
   * stored. Keyboard-only answers are normal and never flagged for missing pointer movement.
   *
   * @param object $ctx
   * @param array $req  body: pageId, key, untrusted, msToFirstInput, inputKind, automation.
   * @return array  flagged (reasons), or a 404 response.
   */
  public function answerGuardSignal($ctx, $req) {
    $b = $req['body'] ?? [];
    $keys = $this->asMap($ctx->storage->read('keys'));
    if (empty($keys[$b['pageId'] ?? ''][$b['key'] ?? ''])) { return ['status' => 404, 'body' => ['error' => 'not a guarded question']]; }
    $reasons = [];
    if ((int) ($b['untrusted'] ?? 0) > 0) { $reasons[] = 'scripted-input'; }
    if (($b['automation'] ?? null) === true) { $reasons[] = 'automation'; }
    if (($b['inputKind'] ?? null) === 'none') { $reasons[] = 'no-input'; }
    $min = (int) ($ctx->settings['minAnswerMs'] ?? 0);
    if (isset($b['msToFirstInput']) && (int) $b['msToFirstInput'] < $min) { $reasons[] = 'fast-answer'; }
    if (!$reasons) { return ['flagged' => []]; }
    $signals = $this->asList($ctx->storage->read('signals'));
    $u = $ctx->user;
    $name = ($u['displayName'] ?? '') !== '' ? $u['displayName'] : (($u['name'] ?? '') !== '' ? $u['name'] : $u['id']);
    $signals[] = ['userId' => $u['id'], 'name' => $name, 'pageId' => $b['pageId'], 'key' => $b['key'], 'reasons' => $reasons, 'at' => $ctx->now()];
    $ctx->storage->write('signals', $signals);
    return ['flagged' => $reasons];
  }

  /**
   * Implements operation answerGuardReport.
   *
   * Lists, for editors and admins, each learner with flags on this site: how many, which reasons, and how many checks
   * they made. Flags are prompts for a conversation, not proof.
   *
   * @param object $ctx
   * @param array $req
   * @return array  items (id, name, flags, checks, summary), or a 403 response.
   */
  public function answerGuardReport($ctx, $req = []) {
    if (!$this->isEditor($ctx->user)) { return ['status' => 403, 'body' => ['error' => 'only editors and admins can see the report']]; }
    $signals = $this->asList($ctx->storage->read('signals'));
    $attempts = $this->asList($ctx->storage->read('attempts'));
    $by = [];
    foreach ($signals as $s) {
      $id = $s['userId'];
      if (!isset($by[$id])) { $by[$id] = ['id' => $id, 'name' => ($s['name'] ?? '') !== '' ? $s['name'] : $id, 'flags' => 0, 'reasons' => []]; }
      $by[$id]['flags'] += 1;
      foreach ($s['reasons'] ?? [] as $r) { $by[$id]['reasons'][$r] = ($by[$id]['reasons'][$r] ?? 0) + 1; }
    }
    $items = [];
    foreach ($by as $u) {
      $checks = count(array_filter($attempts, function ($a) use ($u) { return $a['userId'] === $u['id']; }));
      $names = array_keys($u['reasons']);
      sort($names, SORT_STRING);
      $reasons = implode(', ', array_map(function ($r) use ($u) { return $r . ' x' . $u['reasons'][$r]; }, $names));
      $items[] = ['id' => $u['id'], 'name' => $u['name'], 'flags' => $u['flags'], 'checks' => $checks,
        'summary' => $u['flags'] . ' flagged ' . ($u['flags'] === 1 ? 'answer' : 'answers') . ' (' . $reasons . '); ' . $checks . ' checks'];
    }
    usort($items, function ($a, $b) { return ($b['flags'] - $a['flags']) ?: strcmp($a['id'], $b['id']); });
    return ['items' => $items];
  }
}

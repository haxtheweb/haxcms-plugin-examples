<?php
// PluginTestCtx: the PHP ctx a plugin receives (spec/13), in memory, for PHPUnit tests of a plugin's src/php.
//
// Same method names and shapes as the reference harness's PHP ctx (harness/php/bridge.php), but nothing goes
// back to a harness process: storage, records, managed files and config live in this object, hooks and
// contract calls answer from handlers the test sets, and ctx->fetch() / ctx->exec() answer only from fakes (the
// network is off). Use it through PluginTestCase (harness/php/PluginTestCase.php):
//
//   $ctx = $this->ctx(['settings' => ['apiKey' => 'k'], 'fetch' => ['example.invalid' => ['status' => 200, 'body' => '[]']]]);
//   $res = $this->plugin()->exampleAppstoreBrowse($ctx, ['query' => ['q' => 'boom']]);
//
// What it does not do is what the engine does around a call: route security, hook ordering across plugins,
// vetoes from other plugins, transactions across saves. Those are covered by the plugin's executable cases
// (tests/cases, run by hax-plugin-test) and by the live layer of hax-plugin-check.

class PluginTestStorage {
  public $state; public $written = []; private $pluginDir; private $packageStores;
  public function __construct($state, $pluginDir, $packageStores) { $this->state = $state; $this->pluginDir = $pluginDir; $this->packageStores = $packageStores; }
  public function read($id) {
    if (isset($this->packageStores[$id])) { return json_decode(file_get_contents($this->pluginDir . '/data/' . $this->packageStores[$id]), true); }
    return $this->state[$id] ?? null;
  }
  public function write($id, $value) {
    if (isset($this->packageStores[$id])) { throw new Exception("store \"$id\" is read-only (package scope)"); }
    $this->state[$id] = $value; $this->written[$id] = $value;
  }
}

class PluginTestPackage {
  private $dir;
  public function __construct($dir) { $this->dir = realpath($dir . '/data') ?: ($dir . '/data'); }
  private function inside($path) {
    $full = realpath(dirname($this->dir) . '/' . $path);
    if ($full === false || ($full !== $this->dir && strpos($full, $this->dir . DIRECTORY_SEPARATOR) !== 0)) { throw new Exception("package access is limited to the plugin's data/ folder"); }
    return $full;
  }
  public function list($path) {
    $base = $this->inside($path);
    $out = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) { if ($f->isFile()) { $out[] = str_replace(DIRECTORY_SEPARATOR, '/', substr($f->getPathname(), strlen($base) + 1)); } }
    sort($out);
    return $out;
  }
  public function read($path, $opts = []) { return file_get_contents($this->inside($path)); }
}

class PluginTestLog {
  public $entries = [];
  public function info($m, $d = null) { $this->entries[] = ['level' => 'info', 'message' => $m]; }
  public function warn($m, $d = null) { $this->entries[] = ['level' => 'warn', 'message' => $m]; }
  public function error($m, $d = null) { $this->entries[] = ['level' => 'error', 'message' => $m]; }
  public function messages($level = null) { return array_values(array_map(function ($e) { return $e['message']; }, array_filter($this->entries, function ($e) use ($level) { return $level === null || $e['level'] === $level; }))); }
}

class PluginTestEntities {
  public $records; public $listed = []; public $saves = []; public $deletes = []; private $caps; private $site; private $pluginId;
  public function __construct($records, $caps, $site, $pluginId) { $this->records = $records; $this->caps = $caps; $this->site = $site; $this->pluginId = $pluginId; }
  // the same capability rule the engine applies (spec/08): read needs :read or :write, write needs :write
  private function need($type, $action) {
    $area = ['site' => 'site', 'page' => 'items', 'file' => 'files', 'config' => 'settings'][$type] ?? null;
    if (!$area) { return; }
    if (!in_array("$area:$action", $this->caps, true) && !($action === 'read' && in_array("$area:write", $this->caps, true))) {
      throw new Exception("{$this->pluginId} needs the $area:$action capability to $action $type records");
    }
  }
  public function get($type, $id = null) { $this->need($type, 'read'); $id = $type === 'site' ? ($id ?: $this->site) : $id; return $this->records[$type][$id] ?? null; }
  public function list($type, $query = []) {
    $this->need($type, 'read');
    $listed = $this->listed;
    return array_values(array_filter($this->records[$type] ?? [], function ($r) use ($query, $type, $listed) {
      foreach ($query as $k => $v) {
        if ($k === 'listed') { if ($type !== 'page' || in_array($r['id'] ?? null, $listed, true) !== $v) { return false; } continue; }
        if (($r[$k] ?? null) !== $v) { return false; }
      }
      return true;
    }));
  }
  public function save($type, $record) {
    $this->need($type, 'write');
    $id = $type === 'site' ? ($record['id'] ?? $this->site) : ($record['id'] ?? $record['uuid'] ?? null);
    $this->records[$type][$id] = $record; $this->saves[] = ['type' => $type, 'record' => $record];
    return ['record' => $record];
  }
  public function delete($type, $id) {
    $this->need($type, 'write');
    $existed = isset($this->records[$type][$id]);
    unset($this->records[$type][$id]); $this->deletes[] = ['type' => $type, 'id' => $id];
    return ['deleted' => $existed];
  }
}

class PluginTestConfig {
  public $saves = []; private $ctx;
  public function __construct($ctx) { $this->ctx = $ctx; }
  public function save($values, $opts = []) { $this->saves[] = $values; $this->ctx->settings = array_merge($this->ctx->settings, $values); return ['status' => 200]; }
}

class PluginTestPlugins {
  private $list; private $skills; private $ops; private $prompts;
  public function __construct($list, $skills, $ops = [], $prompts = []) { $this->list = $list; $this->skills = $skills; $this->ops = $ops; $this->prompts = $prompts; }
  public function operations($filter = []) { return array_values(array_filter($this->ops, function ($o) use ($filter) { return empty($filter['mcp']) || !empty($o['mcp']); })); }
  public function prompts() { return $this->prompts; }
  public function list() { return $this->list; }
  public function skills($audience) { return $this->skills[$audience] ?? []; }
}

class PluginTestFiles {
  public $writes = []; public $puts = []; public $removes = []; private $existing;
  public function __construct($existing) { $this->existing = $existing; }
  public function writeManaged($path, $content) { $this->writes[$path] = (string) $content; $this->existing[$path] = (string) $content; return ['path' => $path]; }
  public function readManaged($path) { return $this->existing[$path] ?? null; }
  public function put($path, $data) { $this->puts[$path] = $data; return ['path' => $path]; }
  public function remove($path) { $this->removes[] = $path; return ['removed' => true]; }
}

class PluginTestAssets {
  private $id;
  public function __construct($id) { $this->id = $id; }
  public function url($path) {
    if (!preg_match('#^frontend/dist/[A-Za-z0-9._/-]+$#', $path) || strpos($path, '..') !== false) { throw new Exception("assets->url only serves files under frontend/dist"); }
    return "x/api/v1/plugins/{$this->id}/assets/" . substr($path, strlen('frontend/dist/'));
  }
}

class PluginTestArchive {
  public function read($b64, $opts = []) {
    $bin = base64_decode((string) $b64, true);
    if ($bin === false || substr($bin, 0, 4) !== "PK\x03\x04") { throw new Exception('not a zip archive'); }
    $max = $opts['maxEntries'] ?? 5000; $maxBytes = $opts['maxBytes'] ?? 100 * 1024 * 1024; $match = '/' . str_replace('/', '\/', $opts['match'] ?? '.*') . '/';
    $tmp = tempnam(sys_get_temp_dir(), 'hxz'); file_put_contents($tmp, $bin);
    $z = new ZipArchive();
    try {
      if ($z->open($tmp) !== true) { throw new Exception('zip archive has no central directory'); }
      if ($z->numFiles > $max) { throw new Exception("zip archive has {$z->numFiles} entries (limit $max)"); }
      $out = []; $total = 0;
      for ($i = 0; $i < $z->numFiles; $i++) {
        $st = $z->statIndex($i); $name = $st['name'];
        if (substr($name, -1) === '/' || !preg_match($match, $name)) { continue; }
        $total += $st['size'];
        if ($total > $maxBytes) { throw new Exception("zip archive expands beyond $maxBytes bytes"); }
        $data = $z->getFromIndex($i);
        $out[$name] = !empty($opts['binary']) ? base64_encode($data) : $data;
      }
      return $out;
    } finally { $z->close(); @unlink($tmp); }
  }
}

// ctx->hooks->fire(): answers from $handlers[name] (a callable taking and returning the subject, or returning
// ['veto' => ['message' => ..., 'status' => ...]]); with no handler the subject comes back unchanged.
class PluginTestHooks {
  public $handlers = []; public $fired = [];
  public function __construct($handlers) { $this->handlers = $handlers; }
  public function fire($name, $subject, $opts = []) {
    $this->fired[] = ['name' => $name, 'subject' => $subject];
    if (!isset($this->handlers[$name])) { return ['subject' => $subject, 'warnings' => []]; }
    $r = call_user_func($this->handlers[$name], $subject, $opts);
    if (is_array($r) && isset($r['veto'])) { return ['subject' => $subject, 'veto' => $r['veto'], 'warnings' => []]; }
    return ['subject' => $r === null ? $subject : $r, 'warnings' => []];
  }
}

// ctx->contracts->call(): answers from $handlers["<contract>.<op>"] (a callable taking the input)
class PluginTestContracts {
  public $handlers = []; public $calls = [];
  public function __construct($handlers) { $this->handlers = $handlers; }
  public function call($name, $op, $input, $opts = []) {
    $this->calls[] = ['contract' => $name, 'op' => $op, 'input' => $input];
    if (!isset($this->handlers["$name.$op"])) { throw new Exception("no implementer of $name.$op in this test (set contracts)"); }
    return call_user_func($this->handlers["$name.$op"], $input, $opts);
  }
}

class PluginTestCtx {
  public $entityType = null; public $subject; public $previous; public $request; public $settings; public $haxcms; public $plugin; public $site; public $user;
  public $archive; public $contracts; public $transaction; public $storage; public $package; public $log; public $hooks; public $entities; public $config; public $plugins; public $assets; public $files; public $warnings = [];
  public $fetchCalls = []; public $execCalls = [];
  private $enabled; private $nowMs; private $egress; private $fetchFakes; private $execAllowed; private $execFakes;

  /**
   * @param array $o  pluginDir, pluginId, capabilities, egress, exec (allowed commands); and for the call:
   *   settings, subject, previous, entityType, stores, packageStores, records, listedPages, managedFiles,
   *   hooks (handlers), contracts (handlers), fetch (fakes by URL, URL without query, or host),
   *   execFakes (by command), now (ms), site, user, enabled (active plugin ids), haxcmsVersion
   */
  public function __construct($o = []) {
    $pluginId = $o['pluginId'] ?? 'plugin';
    $this->subject = $o['subject'] ?? null;
    $this->previous = $o['previous'] ?? null;
    $this->entityType = $o['entityType'] ?? null;
    $this->request = $o['request'] ?? null;
    $this->settings = $o['settings'] ?? [];
    $this->haxcms = (object) ['version' => $o['haxcmsVersion'] ?? '26.10.1', 'runtime' => 'php'];
    $this->plugin = ['id' => $pluginId];
    $this->site = $o['site'] ?? ['id' => 'site-1', 'name' => 'test-site', 'url' => 'https://example.org/'];
    $this->user = array_key_exists('user', $o) ? $o['user'] : ['name' => 'admin'];
    $this->transaction = ['id' => 't1', 'origin' => 'test', 'bulk' => false, 'marks' => []];
    $this->enabled = $o['enabled'] ?? [$pluginId];
    $this->nowMs = $o['now'] ?? 1767225600000; // 2026-01-01T00:00:00Z, fixed so output is repeatable
    $this->egress = $o['egress'] ?? [];
    $this->fetchFakes = $o['fetch'] ?? [];
    $this->execAllowed = $o['exec'] ?? [];
    $this->execFakes = $o['execFakes'] ?? [];
    $dir = $o['pluginDir'] ?? sys_get_temp_dir();
    $this->storage = new PluginTestStorage($o['stores'] ?? [], $dir, $o['packageStores'] ?? []);
    $this->package = new PluginTestPackage($dir);
    $this->log = new PluginTestLog();
    $this->hooks = new PluginTestHooks($o['hooks'] ?? []);
    $this->contracts = new PluginTestContracts($o['contracts'] ?? []);
    $this->archive = new PluginTestArchive();
    $this->config = new PluginTestConfig($this);
    $this->plugins = new PluginTestPlugins($o['activePlugins'] ?? [], $o['skillsByAudience'] ?? [], $o['operations'] ?? [], $o['prompts'] ?? []);
    $this->files = new PluginTestFiles($o['managedFiles'] ?? []);
    $this->assets = new PluginTestAssets($pluginId);
    $this->entities = new PluginTestEntities($o['records'] ?? [], $o['capabilities'] ?? [], $this->site['id'] ?? null, $pluginId);
    $this->entities->listed = $o['listedPages'] ?? [];
  }

  public function runTransaction($fn, $opts = []) { return $fn($this->transaction); }
  public function veto($message, $status = 409) { return ['__veto' => true, 'message' => $message, 'status' => $status]; }
  public function warn($message, $severity = 'warning') { $this->warnings[] = ['message' => $message, 'severity' => $severity]; }
  public function respond($html) { return ['__respond' => $html]; }
  public function now() { return $this->nowMs; }
  public function pluginEnabled($id) { return in_array($id, $this->enabled, true); }

  // ctx->fetch: the host must be in the plugin's egress list, and the answer comes from a fake (network is off)
  public function fetch($url, $init = []) {
    $host = parse_url($url, PHP_URL_HOST);
    $this->fetchCalls[] = ['url' => $url, 'init' => $init];
    if (!in_array($host, $this->egress, true)) { throw new Exception("{$this->plugin['id']} may not reach $host (not in its egress list)"); }
    $fake = $this->fetchFakes[$url] ?? $this->fetchFakes[strtok($url, '?')] ?? $this->fetchFakes[$host] ?? null;
    if ($fake === null) { throw new Exception("network is disabled in tests: no fetch fake for $url"); }
    $body = is_string($fake['body'] ?? null) ? $fake['body'] : json_encode($fake['body'] ?? null);
    return ['status' => $fake['status'] ?? 200, 'headers' => $fake['headers'] ?? [], 'body' => $body, 'json' => json_decode($body, true)];
  }

  // ctx->exec: commands outside the exec list are refused; the answer comes from a fake
  public function exec($cmd, $args = [], $opts = []) {
    if (!in_array($cmd, $this->execAllowed, true)) { throw new Exception("{$this->plugin['id']} may not run \"$cmd\" (not in its exec list)"); }
    $this->execCalls[] = ['cmd' => $cmd, 'args' => $args, 'files' => array_keys($opts['files'] ?? [])];
    $fake = $this->execFakes[$cmd] ?? null;
    if (!$fake) { throw new Exception("exec \"$cmd\" has no fake in this test (execFakes)"); }
    return ['code' => $fake['code'] ?? 0, 'stdout' => $fake['stdout'] ?? '', 'stderr' => $fake['stderr'] ?? ''];
  }
}

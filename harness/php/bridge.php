<?php
// PHP side of the reference harness (harness/memory-backend.mjs). Reads one call as a JSON line on stdin, runs the
// plugin's PHP method with a ctx that follows spec/13, and prints the result plus any state the call changed.
// Calls whose effects other plugins must see at once go back to the harness as RPC lines while the method runs
// (entity saves and deletes, so vetoes come back; store writes; hooks the plugin fires; bulk transactions): the
// bridge writes {"rpc": method, "args": [...]} and reads the reply line, so PHP plugins behave like Node ones.

function harness_rpc($method, $args = []) {
  fwrite(STDOUT, json_encode(['rpc' => $method, 'args' => $args], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . "\n");
  fflush(STDOUT);
  $line = fgets(STDIN);
  $r = json_decode((string) $line, true);
  if (!is_array($r)) { throw new Exception("harness rpc $method: no reply"); }
  if (array_key_exists('error', $r)) { throw new Exception($r['error']); }
  return $r['result'] ?? null;
}

class HarnessStorage {
  public $state; public $written = []; private $pluginDir; private $packageStores; private $overrides;
  public function __construct($state, $pluginDir, $packageStores, $overrides) { $this->state = $state; $this->pluginDir = $pluginDir; $this->packageStores = $packageStores; $this->overrides = $overrides; }
  public function read($id) {
    if (array_key_exists($id, $this->overrides)) { return $this->overrides[$id]; }
    if (isset($this->packageStores[$id])) { return json_decode(file_get_contents($this->pluginDir . '/data/' . $this->packageStores[$id]), true); }
    return $this->state[$id] ?? null;
  }
  public function write($id, $value) {
    if (isset($this->packageStores[$id])) { throw new Exception("store \"$id\" is read-only (package scope)"); }
    $this->state[$id] = $value; $this->written[$id] = $value;
    harness_rpc('storage.write', [$id, $value]);
  }
}

class HarnessPackage {
  private $dir;
  public function __construct($dir) { $this->dir = realpath($dir . '/data'); }
  public function list($path) {
    $base = realpath(dirname($this->dir) . '/' . $path);
    if ($base === false || ($base !== $this->dir && strpos($base, $this->dir . DIRECTORY_SEPARATOR) !== 0)) { throw new Exception("package->list is limited to the plugin's data/ folder"); }
    $out = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) { if ($f->isFile()) { $out[] = str_replace(DIRECTORY_SEPARATOR, '/', substr($f->getPathname(), strlen($base) + 1)); } }
    sort($out);
    return $out;
  }
  public function read($path, $opts = []) {
    $full = realpath(dirname($this->dir) . '/' . $path);
    if ($full === false || strpos($full, $this->dir . DIRECTORY_SEPARATOR) !== 0) { throw new Exception("package->read is limited to the plugin's data/ folder"); }
    return file_get_contents($full);
  }
}

class HarnessLog {
  public $entries = [];
  public function info($m, $d = null) { $this->entries[] = ['level' => 'info', 'message' => $m]; }
  public function warn($m, $d = null) { $this->entries[] = ['level' => 'warn', 'message' => $m]; }
  public function error($m, $d = null) { $this->entries[] = ['level' => 'error', 'message' => $m]; }
}

class HarnessEntities {
  public $saves = []; private $records; private $caps; private $site; private $pluginId;
  public function __construct($records, $caps, $site, $pluginId) { $this->records = $records; $this->caps = $caps; $this->site = $site; $this->pluginId = $pluginId; }
  private function need($type, $action) {
    $area = ['site' => 'site', 'page' => 'items', 'file' => 'files', 'config' => 'settings'][$type] ?? null;
    if (!$area) { return; }
    if (!in_array("$area:$action", $this->caps, true) && !($action === 'read' && in_array("$area:write", $this->caps, true))) {
      throw new Exception("{$this->pluginId} needs the $area:$action capability to $action $type records");
    }
  }
  public function get($type, $id = null) { $this->need($type, 'read'); $id = $type === 'site' ? ($id ?: $this->site) : $id; return $this->records[$type][$id] ?? null; }
  public $listed = [];
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
  public $deletes = [];
  // deletes and saves run in the harness right away (entity hooks, vetoes, stale checks) and report back
  public function delete($type, $id) {
    $this->need($type, 'write');
    $r = harness_rpc('entities.delete', [$type, $id]);
    if (!empty($r['deleted'])) { unset($this->records[$type][$id]); }
    return $r;
  }
  public function save($type, $record) {
    $this->need($type, 'write');
    $r = harness_rpc('entities.save', [$type, $record]);
    if (empty($r['veto']) && empty($r['conflict']) && isset($r['record'])) {
      $id = $type === 'site' ? ($r['record']['id'] ?? $this->site) : ($r['record']['id'] ?? $r['record']['uuid'] ?? null);
      if ($id !== null) { $this->records[$type][$id] = $r['record']; }
    }
    return $r;
  }
}

class HarnessConfig {
  public $saves = []; private $ctx;
  public function __construct($ctx) { $this->ctx = $ctx; }
  // applied by the harness after the call, through the config hooks
  public function save($values, $opts = []) { $this->saves[] = $values; $this->ctx->settings = array_merge($this->ctx->settings, $values); return ['status' => 200]; }
}
class HarnessPlugins {
  private $list; private $skills; private $ops; private $prompts;
  public function __construct($list, $skills, $ops = [], $prompts = []) { $this->list = $list; $this->skills = $skills; $this->ops = $ops; $this->prompts = $prompts; }
  public function operations($filter = []) { return array_values(array_filter($this->ops, function ($o) use ($filter) { return empty($filter['mcp']) || !empty($o['mcp']); })); }
  public function prompts() { return $this->prompts; }
  public function list() { return $this->list; }
  public function skills($audience) { return $this->skills[$audience] ?? []; }
}
// Managed-file writes are checked and applied by the harness after the call.
class HarnessFiles {
  public $writes = []; private $existing;
  public function __construct($existing) { $this->existing = $existing; }
  public function writeManaged($path, $content) { $this->writes[$path] = (string) $content; $this->existing[$path] = (string) $content; return ['path' => $path]; }
  public function readManaged($path) { return $this->existing[$path] ?? null; }
  public $puts = []; public $removes = [];
  // site files (base64 strings); the harness checks the path and capability when it applies them
  public function put($path, $data) { $this->puts[$path] = $data; return ['path' => $path]; }
  public function remove($path) { $this->removes[] = $path; return ['removed' => true]; }
}
class HarnessAssets {
  private $id;
  public function __construct($id) { $this->id = $id; }
  public function url($path) {
    if (!preg_match('#^frontend/dist/[A-Za-z0-9._/-]+$#', $path) || strpos($path, '..') !== false) { throw new Exception("assets->url only serves files under frontend/dist"); }
    return "x/api/v1/plugins/{$this->id}/assets/" . substr($path, strlen('frontend/dist/'));
  }
}

// ctx->archive->read: the same bounded zip reader in PHP (ZipArchive)
class HarnessArchive {
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

// ctx->contracts->call: runs another active plugin's PHP implementation of a core contract in this process
class HarnessContracts {
  // runs in the harness, so the callee gets its own ctx and capabilities (and may be a Node or PHP plugin)
  public function call($name, $op, $input, $opts = []) { return harness_rpc('contracts.call', [$name, $op, $input, (object) $opts]); }
}

class HarnessHooks {
  // every subscriber runs (in the harness, in either runtime); returns ['subject', 'veto'?, 'warnings']
  public function fire($name, $subject, $opts = []) { return harness_rpc('hooks.fire', [$name, $subject, (object) $opts]); }
}

class HarnessCtx {
  public $entityType = null; public $subject; public $previous; public $request; public $settings; public $haxcms; public $plugin; public $site; public $user;
  public $archive; public $contracts; public $transaction; public $storage; public $package; public $log; public $hooks; public $entities; public $config; public $plugins; public $assets; public $files; public $warnings = []; private $enabled;
  public function __construct($in) {
    $c = $in['ctx'];
    $this->subject = $c['subject'] ?? null;
    $this->previous = $c['previous'] ?? null;
    $this->entityType = $c['entityType'] ?? null;
    $this->settings = $c['settings'] ?? [];
    $this->haxcms = (object) $c['haxcms'];
    $this->haxcms->runtime = 'php';
    $this->plugin = $c['plugin'];
    $this->site = $c['site'];
    $this->user = $c['user'];
    $this->transaction = $c['transaction'] ?? ['marks' => []];
    if (!isset($this->transaction['marks']) || !is_array($this->transaction['marks'])) { $this->transaction['marks'] = []; }
    $this->enabled = $c['enabled'] ?? [];
    $this->nowMs = $c['now'] ?? 0;
    $this->storage = new HarnessStorage($c['stores'] ?? [], $in['pluginDir'], $in['packageStores'] ?? [], $in['overrides'] ?? []);
    $this->package = new HarnessPackage($in['pluginDir']);
    $this->log = new HarnessLog();
    $this->hooks = new HarnessHooks();
    $this->archive = new HarnessArchive();
    $this->contracts = new HarnessContracts();
    $this->config = new HarnessConfig($this);
    $this->plugins = new HarnessPlugins($in['activePlugins'] ?? [], $in['skillsByAudience'] ?? [], $in['operations'] ?? [], $in['prompts'] ?? []);
    $this->files = new HarnessFiles($in['managedFiles'] ?? []);
    $this->assets = new HarnessAssets($in['pluginId'] ?? '');
    $this->entities = new HarnessEntities($in['records'] ?? [], $in['capabilities'] ?? [], $in['currentSite'] ?? null, $in['pluginId'] ?? '');
    $this->entities->listed = $in['listedPages'] ?? [];
  }
  public $bulk = null;
  // PHP spelling of ctx.transaction.run(): the harness applies this call's saves inside one bulk transaction
  // PHP spelling of ctx.transaction.run(): opens (or joins) a transaction in the harness for the duration of $fn
  public function runTransaction($fn, $opts = []) {
    harness_rpc('tx.begin', [(object) ($opts + ['origin' => 'plugin', 'bulk' => true])]);
    try { return $fn($this->transaction); } finally { harness_rpc('tx.end', []); }
  }
  public function veto($message, $status = 409) { return ['__veto' => true, 'message' => $message, 'status' => $status]; }
  public function warn($message, $severity = 'warning') { $this->warnings[] = ['message' => $message, 'severity' => $severity]; }
  public function respond($html) { return ['__respond' => $html]; }
  private $nowMs = 0;
  public function now() { return $this->nowMs; }
  public function pluginEnabled($id) { return in_array($id, $this->enabled, true); }
  // ctx->fetch: egress checked, call recorded, answered from the case's fakes by host (spec/13 PHP shape)
  public $fetchCalls = []; public $fetchSpec = ['egress' => [], 'fakes' => []];
  // the harness does the fetch (egress, redirects and the SSRF guard checked on every hop), as for Node plugins
  public function fetch($url, $init = []) {
    $r = harness_rpc('fetch', [$url, (object) $init]);
    $body = (string) ($r['body'] ?? '');
    return ['status' => $r['status'], 'headers' => $r['headers'] ?? [], 'body' => $body, 'json' => json_decode($body, true)];
  }

  // PHP spelling of ctx.exec(): commands outside the exec list are refused; the harness answers from fakes
  public $execCalls = []; public $execSpec = ['allowed' => [], 'fakes' => []];
  public function exec($cmd, $args = [], $opts = []) {
    if (!in_array($cmd, $this->execSpec['allowed'], true)) { throw new Exception("{$this->plugin['id']} may not run \"$cmd\" (not in its exec list)"); }
    $files = array_keys($opts['files'] ?? []); sort($files);
    $this->execCalls[] = ['cmd' => $cmd, 'args' => array_map(function ($a) { return str_replace('{tmp}', '<tmp>', $a); }, $args), 'files' => $files];
    $fake = $this->execSpec['fakes'][$cmd] ?? null;
    if (!$fake) { throw new Exception("exec \"$cmd\" has no fake in this case (run.exec)"); }
    return ['code' => $fake['code'] ?? 0, 'stdout' => $fake['stdout'] ?? '', 'stderr' => $fake['stderr'] ?? ''];
  }
}

$in = json_decode(fgets(STDIN), true);
require_once $in['entry'];
$class = $in['class'];
$plugin = new $class();
if ($in['method'] === '__list_upgrades') {
  echo json_encode(['result' => array_values(array_filter(get_class_methods($plugin), function ($m) { return strpos($m, 'upgrade_') === 0; }))]);
  exit(0);
}
if (!method_exists($plugin, $in['method'])) { echo json_encode(['missing' => true]); exit(0); }
$ctx = new HarnessCtx($in);
$ctx->execSpec = $in['exec'] ?? ['allowed' => [], 'fakes' => []];
$ctx->fetchSpec = $in['fetch'] ?? ['egress' => [], 'fakes' => []];
$result = call_user_func_array([$plugin, $in['method']], array_merge([$ctx], $in['args'] ?? []));
echo json_encode([
  'result' => $result,
  'logs' => $ctx->log->entries,
  'warnings' => $ctx->warnings,
  'transaction' => ['marks' => (object) $ctx->transaction['marks']],
  'configSaves' => $ctx->config->saves,
  'managedWrites' => (object) $ctx->files->writes,
  'sitePuts' => (object) $ctx->files->puts,
  'siteRemoves' => $ctx->files->removes,
  'execCalls' => $ctx->execCalls,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

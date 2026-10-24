<?php
// PHP side of the reference harness (harness/memory-backend.mjs). Reads one call as JSON on stdin, runs the
// plugin's PHP method with a ctx that follows spec/13, and prints the result plus any state the call changed.
// Hooks a plugin fires itself (ctx->hooks->fire) have no other subscribers here; cases that need cross-plugin
// hooks run in Node only.

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
  public function list($type, $query = []) {
    $this->need($type, 'read');
    return array_values(array_filter($this->records[$type] ?? [], function ($r) use ($query) { foreach ($query as $k => $v) { if (($r[$k] ?? null) !== $v) { return false; } } return true; }));
  }
  public $deletes = [];
  public function delete($type, $id) { $this->need($type, 'write'); unset($this->records[$type][$id]); $this->deletes[] = ['type' => $type, 'id' => $id]; return ['deleted' => true]; }
  // Saves are applied by the harness after the call, running the entity hooks then.
  public function save($type, $record) {
    $this->need($type, 'write');
    $id = $type === 'site' ? ($record['id'] ?? $this->site) : ($record['id'] ?? $record['uuid']);
    $this->records[$type][$id] = $record;
    $this->saves[] = ['type' => $type, 'record' => $record];
    return ['record' => $record];
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

class HarnessHooks {
  public function fire($name, $subject, $opts = []) { return ['subject' => $subject, 'warnings' => []]; }
}

class HarnessCtx {
  public $subject; public $previous; public $request; public $settings; public $haxcms; public $plugin; public $site; public $user;
  public $transaction; public $storage; public $package; public $log; public $hooks; public $entities; public $config; public $plugins; public $assets; public $files; public $warnings = []; private $enabled;
  public function __construct($in) {
    $c = $in['ctx'];
    $this->subject = $c['subject'] ?? null;
    $this->previous = $c['previous'] ?? null;
    $this->settings = $c['settings'] ?? [];
    $this->haxcms = (object) $c['haxcms'];
    $this->haxcms->runtime = 'php';
    $this->plugin = $c['plugin'];
    $this->site = $c['site'];
    $this->user = $c['user'];
    $this->transaction = $c['transaction'] ?? ['marks' => []];
    if (!isset($this->transaction['marks']) || !is_array($this->transaction['marks'])) { $this->transaction['marks'] = []; }
    $this->enabled = $c['enabled'] ?? [];
    $this->storage = new HarnessStorage($c['stores'] ?? [], $in['pluginDir'], $in['packageStores'] ?? [], $in['overrides'] ?? []);
    $this->package = new HarnessPackage($in['pluginDir']);
    $this->log = new HarnessLog();
    $this->hooks = new HarnessHooks();
    $this->config = new HarnessConfig($this);
    $this->plugins = new HarnessPlugins($in['activePlugins'] ?? [], $in['skillsByAudience'] ?? [], $in['operations'] ?? [], $in['prompts'] ?? []);
    $this->files = new HarnessFiles($in['managedFiles'] ?? []);
    $this->assets = new HarnessAssets($in['pluginId'] ?? '');
    $this->entities = new HarnessEntities($in['records'] ?? [], $in['capabilities'] ?? [], $in['currentSite'] ?? null, $in['pluginId'] ?? '');
  }
  public $bulk = null;
  // PHP spelling of ctx.transaction.run(): the harness applies this call's saves inside one bulk transaction
  public function runTransaction($fn, $opts = []) { $this->bulk = $opts + ['origin' => 'plugin']; return $fn($this->transaction); }
  public function veto($message, $status = 409) { return ['__veto' => true, 'message' => $message, 'status' => $status]; }
  public function warn($message, $severity = 'warning') { $this->warnings[] = ['message' => $message, 'severity' => $severity]; }
  public function respond($html) { return ['__respond' => $html]; }
  public function pluginEnabled($id) { return in_array($id, $this->enabled, true); }
  public function fetch($url, $init = []) { throw new Exception('network is disabled in the harness'); }
}

$in = json_decode(stream_get_contents(STDIN), true);
require_once $in['entry'];
$class = $in['class'];
$plugin = new $class();
if ($in['method'] === '__list_upgrades') {
  echo json_encode(['result' => array_values(array_filter(get_class_methods($plugin), function ($m) { return strpos($m, 'upgrade_') === 0; }))]);
  exit(0);
}
if (!method_exists($plugin, $in['method'])) { echo json_encode(['missing' => true]); exit(0); }
$ctx = new HarnessCtx($in);
$result = call_user_func_array([$plugin, $in['method']], array_merge([$ctx], $in['args'] ?? []));
echo json_encode([
  'result' => $result,
  'stores' => (object) $ctx->storage->written,
  'logs' => $ctx->log->entries,
  'warnings' => $ctx->warnings,
  'transaction' => ['marks' => (object) $ctx->transaction['marks']],
  'entitySaves' => $ctx->entities->saves,
  'entityDeletes' => $ctx->entities->deletes,
  'bulk' => $ctx->bulk,
  'configSaves' => $ctx->config->saves,
  'managedWrites' => (object) $ctx->files->writes,
  'sitePuts' => (object) $ctx->files->puts,
  'siteRemoves' => $ctx->files->removes,
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

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

class HarnessHooks {
  public function fire($name, $subject, $opts = []) { return ['subject' => $subject, 'warnings' => []]; }
}

class HarnessCtx {
  public $subject; public $previous; public $request; public $settings; public $haxcms; public $plugin; public $site; public $user;
  public $transaction; public $storage; public $package; public $log; public $hooks; public $warnings = []; private $enabled;
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
  }
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
if (!method_exists($plugin, $in['method'])) { echo json_encode(['missing' => true]); exit(0); }
$ctx = new HarnessCtx($in);
$result = call_user_func_array([$plugin, $in['method']], array_merge([$ctx], $in['args'] ?? []));
echo json_encode([
  'result' => $result,
  'stores' => (object) $ctx->storage->written,
  'logs' => $ctx->log->entries,
  'warnings' => $ctx->warnings,
  'transaction' => ['marks' => (object) $ctx->transaction['marks']],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

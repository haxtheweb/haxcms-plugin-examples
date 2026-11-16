<?php
// PluginTestCase: PHPUnit base class for a plugin's own PHP tests (tests/php/*Test.php), the PHP counterpart of
// tests/nodejs/*.test.mjs. hax-plugin-check runs them in its php layer with harness/php/phpunit-bootstrap.php.
//
//   class FeedsPluginTest extends PluginTestCase {
//     public function testWritesRss() {
//       $ctx = $this->ctx(['records' => [...], 'listedPages' => ['p1']]);
//       $this->plugin()->rebuildAfter($ctx);
//       $this->assertStringContainsString('<rss', $ctx->files->puts['rss.xml'] ?? '');
//     }
//   }
//
// plugin() loads the class from the manifest's entry.php; ctx() builds a PluginTestCtx (harness/php/TestCtx.php)
// with the manifest's id, capabilities, egress and exec list already filled in, so a test that reaches past what
// the plugin declared fails the way it would on a real server.

use PHPUnit\Framework\TestCase;

abstract class PluginTestCase extends TestCase {
  private static $manifests = [];

  /** The plugin folder: the test file lives in <plugin>/tests/php/. */
  protected function pluginDir() {
    return dirname((new ReflectionClass(static::class))->getFileName(), 3);
  }

  /** The parts of plugin.yaml the PHP tests need (id, entry.php, capabilities, egress, exec), read without a YAML extension. */
  protected function manifest() {
    $dir = $this->pluginDir();
    if (isset(self::$manifests[$dir])) { return self::$manifests[$dir]; }
    $yaml = (string) file_get_contents($dir . '/plugin.yaml');
    $scalar = function ($key) use ($yaml) { return preg_match('/^' . preg_quote($key, '/') . ':\s*["\']?([^"\'#\s]+)/m', $yaml, $m) ? $m[1] : null; };
    $list = function ($key) use ($yaml) {
      if (!preg_match('/^' . preg_quote($key, '/') . ':\s*\[([^\]]*)\]/m', $yaml, $m)) { return []; }
      return array_values(array_filter(array_map(function ($v) { return trim(trim($v), '"\''); }, explode(',', $m[1])), 'strlen'));
    };
    $php = preg_match('/^entry:\s*\n(?:[ \t]+\S.*\n)*?[ \t]+php:\s*["\']?([^"\'#\s]+)/m', $yaml, $m) ? $m[1] : 'src/php/Plugin.php';
    return self::$manifests[$dir] = [
      'id' => $scalar('id'),
      'entry' => $php,
      'capabilities' => $list('capabilities'),
      'egress' => $list('egress'),
      'exec' => $list('exec'),
    ];
  }

  /** A new instance of the plugin's PHP class (the first class its entry file declares). */
  protected function plugin() {
    $file = $this->pluginDir() . '/' . $this->manifest()['entry'];
    require_once $file;
    $source = (string) file_get_contents($file);
    if (!preg_match('/^\s*(?:final\s+|abstract\s+)?class\s+(\w+)/m', $source, $m)) { $this->fail("no class in $file"); }
    return new $m[1]();
  }

  /** A PluginTestCtx for one call; $o overrides any default (see TestCtx.php). */
  protected function ctx($o = []) {
    $m = $this->manifest();
    return new PluginTestCtx($o + [
      'pluginDir' => $this->pluginDir(),
      'pluginId' => $m['id'],
      'capabilities' => $m['capabilities'],
      'egress' => $m['egress'],
      'exec' => $m['exec'],
    ]);
  }

  /** Asserts a hook or operation returned a veto (ctx->veto()), optionally with a message fragment. */
  protected function assertVeto($result, $messagePart = null) {
    $this->assertIsArray($result);
    $this->assertTrue(!empty($result['__veto']), 'expected a veto');
    if ($messagePart !== null) { $this->assertStringContainsString($messagePart, $result['message']); }
  }
}

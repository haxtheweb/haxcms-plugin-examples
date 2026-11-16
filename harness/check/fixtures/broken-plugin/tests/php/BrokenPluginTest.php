<?php
// Fails the PHPUnit gate: the plugin's own test does not pass.
class BrokenPluginTest extends PluginTestCase {
  public function testFailsOnPurpose() {
    $this->assertSame('expected', 'actual');
  }
}

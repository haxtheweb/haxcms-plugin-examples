<?php
// PHPUnit tests for the example plugin's PHP side, the counterpart of tests/nodejs. They call the plugin's methods
// directly with an in-memory ctx (PluginTestCase, harness/php). Run with: hax-plugin-check --only php examples/example
class ExamplePluginTest extends PluginTestCase {
  public function testListExplosionsFiltersByName() {
    $ctx = $this->ctx(['stores' => ['tally' => [['id' => 'e1', 'name' => 'Big boom'], ['id' => 'e2', 'name' => 'Small pop']]]]);
    $res = $this->plugin()->exampleListExplosions($ctx, ['query' => ['q' => 'BOOM']]);
    $this->assertSame(1, $res['total']);
    $this->assertSame('e1', $res['items'][0]['id']);
  }

  public function testExplodeRecordsTheExplosionAndFiresItsHooks() {
    $ctx = $this->ctx();
    $res = $this->plugin()->exampleExplode($ctx, ['body' => ['fileId' => 'f1', 'size' => 2]]);
    $this->assertSame(['id' => 'e1', 'name' => 'Explosion 1', 'fileId' => 'f1', 'intensity' => 2], $res);
    $this->assertSame([$res], $ctx->storage->written['tally']);
    $this->assertSame(['example.before.explode', 'example.after.explode'], array_column($ctx->hooks->fired, 'name'));
  }

  public function testAnotherPluginCanVetoAnExplosion() {
    $ctx = $this->ctx(['hooks' => ['example.before.explode' => function () { return ['veto' => ['message' => 'Quiet hours', 'status' => 423]]; }]]);
    $res = $this->plugin()->exampleExplode($ctx, ['body' => ['fileId' => 'f1']]);
    $this->assertSame(423, $res['status']);
    $this->assertSame('Quiet hours', $res['body']['error']);
    $this->assertArrayNotHasKey('tally', $ctx->storage->written);
  }

  public function testAppstoreBrokerAnswers503WithoutAKey() {
    $res = $this->plugin()->exampleAppstoreBrowse($this->ctx(), ['query' => ['q' => 'boom']]);
    $this->assertSame(503, $res['status']);
  }

  public function testAppstoreBrokerAnswers502WhenTheUpstreamIsUnreachable() {
    // no fetch fake: the network is off, so ctx->fetch throws, as a real outage would
    $res = $this->plugin()->exampleAppstoreBrowse($this->ctx(['settings' => ['apiKey' => 'k']]), ['query' => ['q' => 'boom']]);
    $this->assertSame(502, $res['status']);
    $this->assertStringContainsString('could not be reached', $res['body']['error']);
  }

  public function testAppstoreBrokerPassesTheKeyServerSide() {
    $ctx = $this->ctx(['settings' => ['apiKey' => 'secret'], 'fetch' => ['example.invalid' => ['status' => 200, 'body' => ['items' => []]]]]);
    $res = $this->plugin()->exampleAppstoreBrowse($ctx, ['query' => ['q' => 'a b']]);
    $this->assertSame(200, $res['status']);
    $this->assertSame('https://example.invalid/api/explosions?q=a%20b', $ctx->fetchCalls[0]['url']);
    $this->assertSame('secret', $ctx->fetchCalls[0]['init']['headers']['x-api-key']);
  }

  public function testABoringFileIsVetoed() {
    $this->assertVeto($this->plugin()->entityBeforeCreate($this->ctx(['subject' => ['name' => 'boring.awesome']])), 'Too boring');
    $this->assertNull($this->plugin()->entityBeforeCreate($this->ctx(['subject' => ['name' => 'big.awesome']])));
  }
}

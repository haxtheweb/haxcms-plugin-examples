<?php
// PHPUnit tests for the feeds plugin's PHP side. The executable cases (tests/cases) prove Node and PHP write the
// same bytes through the engine; these pin the PHP details directly. Run: hax-plugin-check --only php core-plugins/feeds
class FeedsPluginTest extends PluginTestCase {
  private function site($pages, $listed, $settings = []) {
    return $this->ctx([
      'settings' => $settings,
      'site' => ['id' => 's1', 'name' => 'course', 'url' => 'https://example.org/course/'],
      'records' => [
        'site' => ['s1' => ['id' => 's1', 'title' => 'Course & More', 'description' => '<p>About</p>', 'metadata' => ['site' => ['updated' => 1767225600]]]],
        'page' => array_combine(array_column($pages, 'id'), $pages),
      ],
      'listedPages' => $listed,
    ]);
  }

  public function testRssListsListedPagesNewestFirstWithEscaping() {
    $ctx = $this->site([
      ['id' => 'p1', 'title' => 'One', 'slug' => 'one', 'content' => '<p>First</p>', 'metadata' => ['created' => 1767225600]],
      ['id' => 'p2', 'title' => 'Two <b>', 'slug' => 'two', 'content' => '<p>Second</p>', 'metadata' => ['created' => 1767312000000]],
      ['id' => 'p3', 'title' => 'Hidden', 'slug' => 'hidden', 'content' => '', 'metadata' => ['created' => 1767398400]],
    ], ['p1', 'p2']);
    $this->plugin()->rebuildAfter($ctx);
    $rss = $ctx->files->writes['rss.xml'];
    $this->assertStringContainsString('<title>Course &amp; More</title>', $rss);
    $this->assertStringContainsString('<title>Two &lt;b&gt;</title>', $rss);
    $this->assertLessThan(strpos($rss, '<title>One</title>'), strpos($rss, '<title>Two &lt;b&gt;</title>'));
    $this->assertStringContainsString('<link>https://example.org/course/two</link>', $rss);
    $this->assertStringContainsString('<pubDate>Fri, 02 Jan 2026 00:00:00 GMT</pubDate>', $rss);
    $this->assertStringNotContainsString('Hidden', $rss);
    $this->assertStringContainsString('<published>2026-01-01T00:00:00.000Z</published>', $ctx->files->writes['atom.xml']);
  }

  public function testLimitAndFullContentSettings() {
    $pages = [
      ['id' => 'a', 'title' => 'A', 'slug' => 'a', 'content' => 'x ]]> y', 'metadata' => ['created' => 1767312000]],
      ['id' => 'b', 'title' => 'B', 'slug' => 'b', 'content' => 'z', 'metadata' => ['created' => 1767225600]],
    ];
    $ctx = $this->site($pages, ['a', 'b'], ['limit' => 1, 'fullContent' => true]);
    $this->plugin()->rebuildAfter($ctx);
    $this->assertStringNotContainsString('<title>B</title>', $ctx->files->writes['rss.xml']);
    $this->assertStringContainsString('x ]]]]><![CDATA[> y', $ctx->files->writes['atom.xml']);
  }

  public function testItNeedsOnlyTheCapabilitiesItDeclares() {
    // feeds declares site:read and items:read; reading pages is allowed, writing them is not
    $ctx = $this->site([], []);
    $this->expectExceptionMessage('needs the items:write capability');
    $ctx->entities->save('page', ['id' => 'x']);
  }
}

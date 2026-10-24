<?php
// Agent skills discovery (PHP). Mirrors src/nodejs/index.js.
class AgentSkillsPlugin {
  const ROOT = '.well-known/agent-skills';
  const SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

  private function digest($s) { return 'sha256:' . hash('sha256', $s); }
  private function description($md) {
    if (!preg_match('/^---\n[\s\S]*?^description:\s*(.+)$[\s\S]*?\n---/m', $md, $m)) { return ''; }
    $d = trim($m[1]);
    if (preg_match('/^(["\'])([\s\S]*)\1$/', $d, $q)) { $d = $q[2]; }
    return $d;
  }

  /**
   * Implements hook rebuild.after.
   *
   * Publishes the agent skills discovery files under .well-known/agent-skills: every skill this plugin ships plus the
   * site skills of each active plugin, with index.json (digests per file) and the .htaccess that serves them.
   *
   * @param object $ctx  subject: [scope, siteId, reason, files] of the rebuild that finished.
   * @return null
   */
  public function rebuildAfter($ctx) {
    $skills = [];
    $names = [];
    foreach ($ctx->package->list('data/skills') as $f) { $names[explode('/', $f)[0]] = true; }
    foreach (array_keys($names) as $name) {
      $files = [];
      foreach ($ctx->package->list("data/skills/$name") as $path) {
        if (preg_match('/\.(md|json|txt)$/', $path)) { $files[] = ['path' => $path, 'content' => $ctx->package->read("data/skills/$name/$path")]; }
      }
      $skills[] = ['name' => $name, 'files' => $files];
    }
    foreach ($ctx->plugins->skills('site') as $s) { $skills[] = ['name' => $s['name'], 'files' => $s['files']]; }
    usort($skills, function ($a, $b) { return strcmp($a['name'], $b['name']); });
    $index = ['$schema' => self::SCHEMA, 'skills' => []];
    foreach ($skills as $sk) {
      $main = null;
      foreach ($sk['files'] as $f) { if ($f['path'] === 'SKILL.md') { $main = $f; } }
      if (!$main) { continue; }
      $extra = [];
      foreach ($sk['files'] as $f) {
        $ctx->files->writeManaged(self::ROOT . "/{$sk['name']}/{$f['path']}", $f['content']);
        if ($f['path'] !== 'SKILL.md') { $extra[] = ['path' => $f['path'], 'digest' => $this->digest($f['content'])]; }
      }
      $entry = ['name' => $sk['name'], 'type' => 'skill-md', 'description' => $this->description($main['content']), 'url' => "{$sk['name']}/SKILL.md", 'digest' => $this->digest($main['content'])];
      if ($extra) { $entry['files'] = $extra; }
      $index['skills'][] = $entry;
    }
    // byte-identical with Node's JSON.stringify(x, null, 2): PHP pretty-prints with 4 spaces
    $json = json_encode($index, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $json = preg_replace_callback('/^( +)/m', function ($m) { return str_repeat(' ', intdiv(strlen($m[1]), 2)); }, $json);
    $ctx->files->writeManaged(self::ROOT . '/index.json', $json . "\n");
    $ctx->files->writeManaged(self::ROOT . '/.htaccess', $ctx->package->read('data/htaccess.txt'));
    return null;
  }
}

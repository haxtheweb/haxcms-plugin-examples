<?php
// Import source (PHP). Mirrors src/nodejs/index.js; both return identical results.
// One reader for "a site's files": a GitHub repository (file tree from the API, files from the raw host) or an
// uploaded zip of the same folder ($ctx->archive->read). Site importers call it through import-source.tree and stay
// free of network and zip code.
class ImportSourcePlugin {
  const API = 'https://api.github.com';
  const RAW = 'https://raw.githubusercontent.com';

  // encodeURIComponent, as the Node twin writes URLs
  private static function encComponent($s) { return strtr(rawurlencode((string) $s), ['%21' => '!', '%2A' => '*', '%27' => "'", '%28' => '(', '%29' => ')']); }
  private static function encPath($p) { return implode('/', array_map([self::class, 'encComponent'], explode('/', (string) $p))); }

  /** owner, repo and optional branch from a github.com URL, or null. */
  public static function parseRepo($url) {
    if (!preg_match('~^https?://(?:www\.)?github\.com/([^/?#]+)/([^/?#]+)(?:/tree/([^/?#]+))?~i', trim((string) $url), $m)) { return null; }
    return ['owner' => $m[1], 'name' => preg_replace('/\.git$/i', '', $m[2]), 'branch' => isset($m[3]) ? $m[3] : null];
  }

  /** The single top folder every path sits under (a GitHub download: <repo>-<branch>/), or "". */
  public static function topFolder($keys) {
    if (!$keys) { return ''; }
    $first = explode('/', $keys[0])[0] . '/';
    if ($first === '/') { return ''; }
    foreach ($keys as $k) { if (strpos($k, $first) !== 0 || strlen($k) <= strlen($first)) { return ''; } }
    return $first;
  }

  private function listGithub($ctx, $url) {
    $gh = self::parseRepo($url);
    if (!$gh) { return ['error' => 'url must be a GitHub repository (https://github.com/<owner>/<repo>)']; }
    $getJson = function ($u, $what) use ($ctx) {
      try { $r = $ctx->fetch($u); } catch (Exception $e) { throw new Exception("unable to reach $what"); }
      if ($r['status'] >= 400) { throw new Exception("unable to read $what (HTTP {$r['status']})"); }
      return $r['json'];
    };
    $repo = $gh['owner'] . '/' . $gh['name'];
    $info = $getJson(self::API . "/repos/$repo", "the repository $repo");
    $branch = $gh['branch'] ?: ((is_array($info) && !empty($info['default_branch'])) ? $info['default_branch'] : 'main');
    $tree = $getJson(self::API . "/repos/$repo/git/trees/" . self::encComponent($branch) . '?recursive=1', "the file tree of $repo");
    $paths = []; $seen = [];
    foreach ((is_array($tree) && isset($tree['tree']) && is_array($tree['tree'])) ? $tree['tree'] : [] as $t) {
      if (is_array($t) && ($t['type'] ?? null) === 'blob' && isset($t['path']) && is_string($t['path']) && !isset($seen[$t['path']])) { $seen[$t['path']] = true; $paths[] = $t['path']; }
    }
    return ['kind' => 'github', 'name' => $gh['name'], 'repo' => $repo, 'branch' => $branch, 'prefix' => '', 'rawBase' => self::RAW . "/$repo/" . self::encPath($branch), 'paths' => $paths];
  }

  private function openArchive($ctx, $input, $binary) {
    $f = (isset($input['files'][0]) && is_array($input['files'][0])) ? $input['files'][0] : [];
    $opts = ['match' => (isset($input['match']) && is_string($input['match']) && $input['match'] !== '') ? $input['match'] : '.'];
    if ($binary) { $opts['binary'] = true; }
    try { $entries = $ctx->archive->read((string) ($f['data'] ?? ''), $opts); } catch (Exception $e) { return ['error' => 'the file is not a zip archive']; }
    return ['file' => $f, 'entries' => is_array($entries) ? $entries : []];
  }

  private function listArchive($ctx, $input) {
    $a = $this->openArchive($ctx, $input, false);
    if (isset($a['error'])) { return $a; }
    $keys = array_map('strval', array_keys($a['entries']));
    usort($keys, function ($x, $y) { return $x < $y ? -1 : ($x > $y ? 1 : 0); });
    $prefix = self::topFolder($keys);
    $paths = [];
    foreach ($keys as $k) { $paths[] = substr($k, strlen($prefix)); }
    return ['kind' => 'archive', 'name' => preg_replace('/\.zip$/i', '', (string) (($a['file']['name'] ?? '') !== '' ? $a['file']['name'] : 'site')), 'repo' => null, 'branch' => null, 'prefix' => $prefix, 'rawBase' => null, 'paths' => $paths];
  }

  private static function wantedPaths($input) {
    $out = []; $seen = [];
    foreach ((isset($input['paths']) && is_array($input['paths'])) ? $input['paths'] : [] as $p) {
      if (is_string($p) && $p !== '' && !isset($seen[$p])) { $seen[$p] = true; $out[] = $p; }
    }
    return $out;
  }

  private function readGithub($ctx, $input, $paths) {
    $repo = (string) ($input['repo'] ?? '');
    $branch = (string) ($input['branch'] ?? '');
    if (!preg_match('~^[^/?#\s]+/[^/?#\s]+$~', $repo) || $branch === '') { return ['error' => 'repo (<owner>/<repo>) and branch are required']; }
    if (!empty($input['binary'])) { return ['error' => 'binary reads are for zip uploads; list a repository file by its URL (rawBase) instead']; }
    $files = [];
    foreach ($paths as $p) {
      $data = null;
      try { $r = $ctx->fetch(self::RAW . "/$repo/" . self::encPath($branch) . '/' . self::encPath($p)); $data = $r['status'] < 400 ? (string) $r['body'] : null; } catch (Exception $e) { $data = null; }
      $files[] = ['path' => $p, 'data' => $data];
    }
    return ['files' => $files];
  }

  private function readArchive($ctx, $input, $paths) {
    $binary = ($input['binary'] ?? null) === true;
    $a = $this->openArchive($ctx, $input, $binary);
    if (isset($a['error'])) { return $a; }
    $prefix = (isset($input['prefix']) && is_string($input['prefix'])) ? $input['prefix'] : '';
    $files = [];
    foreach ($paths as $p) {
      $key = $prefix . $p;
      if (!array_key_exists($key, $a['entries'])) { $files[] = ['path' => $p, 'data' => null]; continue; }
      $files[] = ['path' => $p, 'data' => $binary ? (string) $a['entries'][$key] : preg_replace('/\r\n?/', "\n", (string) $a['entries'][$key])];
    }
    return ['files' => $files];
  }

  /**
   * Implements contract import-source.tree, operation list.
   *
   * Lists the files of a site: a GitHub repository (its default branch, or the one named by /tree/<branch>) or
   * an uploaded zip of the same folder, with the top folder a GitHub download adds removed.
   *
   * @param object $ctx    Platform context (spec/13); $ctx->fetch() reaches only api.github.com and raw.githubusercontent.com.
   * @param array  $input  [url] of the repository, or [files => [[name, data (base64 zip)]], match?].
   * @return array  [kind, name, repo, branch, prefix, rawBase, paths] or [error].
   */
  public function importSourceTreeList($ctx, $input) {
    $input = $input ?: [];
    try {
      if (!empty($input['files']) && is_array($input['files'])) { return $this->listArchive($ctx, $input); }
      if (!empty($input['url'])) { return $this->listGithub($ctx, $input['url']); }
      return ['error' => 'url or files is required'];
    } catch (Exception $e) {
      return ['error' => $e->getMessage()];
    }
  }

  /**
   * Implements contract import-source.tree, operation read.
   *
   * Reads the named files of a source that list described: text from the repository's raw host, or text (base64
   * with binary) out of the uploaded zip. A file that is not there comes back with data null.
   *
   * @param object $ctx    Platform context (spec/13).
   * @param array  $input  [repo, branch, paths] for a repository, or [files, prefix, match?, paths, binary?] for a zip.
   * @return array  [files => [[path, data]]] or [error].
   */
  public function importSourceTreeRead($ctx, $input) {
    $input = $input ?: [];
    try {
      $paths = self::wantedPaths($input);
      if (!$paths) { return ['error' => 'paths is required']; }
      if (!empty($input['files']) && is_array($input['files'])) { return $this->readArchive($ctx, $input, $paths); }
      return $this->readGithub($ctx, $input, $paths);
    } catch (Exception $e) {
      return ['error' => $e->getMessage()];
    }
  }
}

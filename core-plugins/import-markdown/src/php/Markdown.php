<?php
// The markdown subset of src/nodejs/markdown.js, written for identical output.
class ImportMarkdownConverter {
  private static function esc($s) { return str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $s); }

  public static function inline($s) {
    $codes = [];
    $s = preg_replace_callback('/`([^`]+)`/', function ($m) use (&$codes) { $codes[] = '<code>' . self::esc($m[1]) . '</code>'; return "\0" . (count($codes) - 1) . "\0"; }, $s);
    $s = preg_replace_callback('/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/', function ($m) { return '<img src="' . $m[2] . '" alt="' . $m[1] . '"' . (!empty($m[3]) ? ' title="' . $m[3] . '"' : '') . '>'; }, $s);
    $s = preg_replace_callback('/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/', function ($m) { return '<a href="' . $m[2] . '"' . (!empty($m[3]) ? ' title="' . $m[3] . '"' : '') . '>' . $m[1] . '</a>'; }, $s);
    $s = preg_replace('/<(https?:\/\/[^>\s]+)>/', '<a href="$1">$1</a>', $s);
    $s = preg_replace_callback('/\*\*([^*]+)\*\*|__([^_]+)__/', function ($m) { return '<strong>' . ($m[1] !== '' ? $m[1] : $m[2]) . '</strong>'; }, $s);
    $s = preg_replace_callback('/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)|(^|[^_\w])_([^_\s][^_]*)_(?!\w)/', function ($m) {
      if (isset($m[2]) && $m[2] !== '') { return $m[1] . '<em>' . $m[2] . '</em>'; }
      return $m[3] . '<em>' . $m[4] . '</em>';
    }, $s);
    return preg_replace_callback('/\0(\d+)\0/', function ($m) use ($codes) { return $codes[(int) $m[1]]; }, $s);
  }

  public static function toHtml($md) {
    $src = preg_replace('/\r\n?/', "\n", (string) $md);
    $title = '';
    if (preg_match('/^---\n([\s\S]*?)\n---\n?/', $src, $fm)) {
      if (preg_match('/^title:\s*["\']?(.*?)["\']?\s*$/m', $fm[1], $t)) { $title = $t[1]; }
      $src = substr($src, strlen($fm[0]));
    }
    $lines = explode("\n", $src);
    $out = []; $para = []; $list = null; $quote = [];
    $flushPara = function () use (&$out, &$para) { if ($para) { $out[] = '<p>' . self::inline(implode(' ', $para)) . '</p>'; $para = []; } };
    $flushList = function () use (&$out, &$list) { if ($list) { $out[] = '<' . $list['tag'] . '>' . implode('', array_map(function ($i) { return '<li>' . self::inline($i) . '</li>'; }, $list['items'])) . '</' . $list['tag'] . '>'; $list = null; } };
    $flushQuote = function () use (&$out, &$quote) { if ($quote) { $out[] = '<blockquote>' . self::toHtml(implode("\n", $quote))['html'] . '</blockquote>'; $quote = []; } };
    $flushAll = function () use ($flushPara, $flushList, $flushQuote) { $flushPara(); $flushList(); $flushQuote(); };
    $n = count($lines);
    for ($i = 0; $i < $n; $i++) {
      $line = $lines[$i];
      if (preg_match('/^```\s*([\w-]*)\s*$/', $line, $fence)) {
        $flushAll();
        $code = [];
        while (++$i < $n && !preg_match('/^```\s*$/', $lines[$i])) { $code[] = $lines[$i]; }
        $out[] = '<pre><code' . ($fence[1] !== '' ? ' class="language-' . $fence[1] . '"' : '') . '>' . self::esc(implode("\n", $code)) . '</code></pre>';
        continue;
      }
      if (preg_match('/^>\s?/', $line)) { $flushPara(); $flushList(); $quote[] = preg_replace('/^>\s?/', '', $line); continue; }
      $flushQuote();
      if (preg_match('/^(#{1,6})\s+(.*?)\s*#*\s*$/', $line, $h)) { $flushAll(); $l = strlen($h[1]); $out[] = "<h$l>" . self::inline($h[2]) . "</h$l>"; continue; }
      if (preg_match('/^\s*([-*_])(\s*\1){2,}\s*$/', $line)) { $flushAll(); $out[] = '<hr>'; continue; }
      if (preg_match('/^\s*([-*+]|\d+[.)])\s+(.*)$/', $line, $li)) {
        $flushPara();
        $tag = preg_match('/\d/', $li[1]) ? 'ol' : 'ul';
        if ($list && $list['tag'] !== $tag) { $flushList(); }
        if (!$list) { $list = ['tag' => $tag, 'items' => []]; }
        $list['items'][] = $li[2];
        continue;
      }
      if (trim($line) === '') { $flushPara(); $flushList(); continue; }
      if ($list && preg_match('/^\s{2,}\S/', $line)) { $list['items'][count($list['items']) - 1] .= ' ' . trim($line); continue; }
      $flushList();
      $para[] = trim($line);
    }
    $flushAll();
    return ['html' => implode('', $out), 'title' => $title];
  }
}

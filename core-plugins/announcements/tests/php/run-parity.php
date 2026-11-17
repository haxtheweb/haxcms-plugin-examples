<?php
// PHP side of the parity check: same calls as tests/nodejs/run-parity.mjs, same JSON out.
require_once __DIR__ . '/../../src/php/Announcements.php';
$root = __DIR__ . '/../..';
$read = function ($p) use ($root) { return json_decode(file_get_contents("$root/$p"), true); };
$data = ['entries' => $read('data/announcements.json'), 'types' => $read('data/types.json')];
$es = $read('data/locales/es.json');
$spec = $read('tests/parity-calls.json');
$out = [];
foreach ($spec['calls'] as [$fn, $args]) {
  switch ($fn) {
    case 'latest': $out[] = Announcements::latest($data, $spec['running'], ($args[0] ?? null) === 'es' ? $es : []); break;
    case 'list': $out[] = Announcements::listEntries($data, $spec['running'], $args[0]); break;
    case 'dailyTip': $out[] = Announcements::dailyTip($data, $spec['running'], new DateTime($spec['date']), $args[0], $args[1]); break;
    case 'getEntry': $out[] = Announcements::getEntry($data, $spec['running'], $args[0]); break;
    case 'typesMap': $out[] = Announcements::typesMap($data['types']); break;
    case 'compareVersions': $out[] = Announcements::compareVersions($args[0], $args[1]); break;
    case 'fnv1a': $out[] = Announcements::fnv1a($args[0]); break;
  }
}
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

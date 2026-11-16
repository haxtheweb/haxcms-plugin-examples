<?php
// Lists what a visitor can open (mirrors src/nodejs/index.js)
class FxListedPlugin {
  public function fxListedPublic($ctx) { $ids = array_map(function ($p) { return $p['id']; }, $ctx->entities->list('page', ['listed' => true])); sort($ids, SORT_STRING); return $ids; }
}

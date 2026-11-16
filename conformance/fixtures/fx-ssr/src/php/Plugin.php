<?php
// Server-side renders its element (mirrors src/nodejs/index.js)
class FxSsrPlugin {
  public function renderBeforeContent($ctx) { $s = $ctx->subject; $s['content'] = str_replace('<fx-hello></fx-hello>', '<fx-hello><template shadowrootmode="open">Hello</template></fx-hello>', $s['content']); return $s; }
}

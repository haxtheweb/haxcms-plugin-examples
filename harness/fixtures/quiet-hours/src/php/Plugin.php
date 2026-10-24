<?php
class QuietHoursPlugin {
  // hook: example.before.explode
  public function exampleBeforeExplode($ctx) {
    return $ctx->veto('Quiet hours: no explosions right now');
  }
}

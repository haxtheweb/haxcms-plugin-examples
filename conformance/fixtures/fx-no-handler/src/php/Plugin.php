<?php
// subscribes to page.after.save in plugin.yaml but has no pageAfterSave method (a validator case)
class FxNoHandlerPlugin {
  public function pageAfterDelete($ctx) { return null; }
}

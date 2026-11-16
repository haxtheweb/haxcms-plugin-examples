<?php
// Batches reindexing in bulk transactions (mirrors src/nodejs/index.js)
class FxTxPlugin {
  public function pageAfterSave($ctx) { if (!empty($ctx->transaction['bulk'])) { $ctx->transaction['marks']['fx-tx.reindex'] = ($ctx->transaction['marks']['fx-tx.reindex'] ?? 0) + 1; return null; } $ctx->log->info('fx-tx reindex one page'); return null; }
  public function transactionAfterEnd($ctx) { if (!empty($ctx->subject['marks']['fx-tx.reindex'])) { $ctx->log->info('fx-tx reindex ' . $ctx->subject['marks']['fx-tx.reindex'] . ' pages once'); } return null; }
}

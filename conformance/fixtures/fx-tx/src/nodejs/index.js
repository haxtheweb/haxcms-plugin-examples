export default { hooks: {
  "page.after.save": async (ctx) => { if (ctx.transaction.bulk) { ctx.transaction.marks["fx-tx.reindex"] = (ctx.transaction.marks["fx-tx.reindex"] || 0) + 1; return; } ctx.log.info("fx-tx reindex one page"); },
  "transaction.after.end": async (ctx) => { if (ctx.subject.marks["fx-tx.reindex"]) ctx.log.info(`fx-tx reindex ${ctx.subject.marks["fx-tx.reindex"]} pages once`); },
} };

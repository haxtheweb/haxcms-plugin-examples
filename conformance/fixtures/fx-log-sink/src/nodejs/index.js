// Receives every log entry (the log.sink core contract) and says what it received. Its own entries are never sent
// back to it, so saying so is safe.
export default { contracts: { "log.sink": { async write(ctx, entry) {
  ctx.log.info(`fx-log-sink got [${entry.level}] ${entry.plugin}: ${entry.message}`);
} } } };

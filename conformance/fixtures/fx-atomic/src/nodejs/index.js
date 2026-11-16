// Saves body.pages one by one (and a file when body.file is set); body.failAt throws and body.vetoAt vetoes before
// that index. fxAtomicSaveAll is declared atomic, fxAtomicPlain is not (the default), fxAtomicRun opens an atomic
// transaction itself through ctx.transaction.run.
async function saveAll(ctx, body) {
  if (body.file) await ctx.files.put(body.file, Buffer.from("written").toString("base64"));
  for (const [i, page] of (body.pages || []).entries()) {
    if (body.failAt === i) throw new Error(`fx-atomic failed at ${i}`);
    if (body.vetoAt === i) return ctx.veto(`fx-atomic refused page ${i}`, 422);
    await ctx.entities.save("page", page);
  }
  return { saved: (body.pages || []).length };
}
export default { operations: {
  fxAtomicSaveAll: async (ctx, req) => saveAll(ctx, req.body),
  fxAtomicPlain: async (ctx, req) => saveAll(ctx, req.body),
  fxAtomicRun: async (ctx, req) => {
    try { return await ctx.transaction.run(() => saveAll(ctx, req.body), { bulk: true, atomic: true, origin: "fx-atomic" }); }
    catch (e) { return { status: 409, body: { error: e.message } }; }
  },
} };

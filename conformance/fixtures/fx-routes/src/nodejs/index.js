export default { operations: {
  async fxRoutesSecret(ctx) { return { version: ctx.haxcms.version }; },
  async fxRoutesJwt() { return { ok: true }; },
  async fxRoutesPublic() { return { ok: true }; },
  async fxRoutesWhere(ctx) { return { target: ctx.haxcms.target, runtime: ctx.haxcms.runtime }; },
} };

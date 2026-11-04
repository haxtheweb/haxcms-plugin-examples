export default { operations: {
  async fxRoutesSecret(ctx) { return { version: ctx.haxcms.version }; },
  async fxRoutesJwt() { return { ok: true }; },
  async fxRoutesPublic() { return { ok: true }; },
} };

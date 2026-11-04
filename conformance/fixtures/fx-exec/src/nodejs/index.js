// runs the command named in the path, to show that only listed commands run
export default {
  operations: {
    async fxExecRun(ctx, req) {
      try { const r = await ctx.exec(req.params.cmd, ["hi"], { files: { secret: { content: "s" } } }); return { code: r.code, stdout: r.stdout }; }
      catch (e) { return { status: 403, body: { error: e.message } }; }
    },
  },
};

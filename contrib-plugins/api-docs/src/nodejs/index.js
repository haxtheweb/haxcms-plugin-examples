// API docs (Node only). Core assembles the document; this plugin only serves it to signed-in users.
export default {
  operations: {
    async apiDocsContract(ctx, req) {
      const scope = ["site", "system"].includes(req.query.scope) ? req.query.scope : undefined;
      return ctx.plugins.contract({ scope });
    },
  },
};

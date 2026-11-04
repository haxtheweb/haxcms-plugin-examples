// API docs (Node only). Core assembles the document; this plugin only serves it to signed-in users.
export default {
  operations: {
    /**
     * Implements operation apiDocsContract.
     *
     * Serves the API document core assembles from every enabled plugin to signed-in users, for the site or system
     * scope.
     *
     * @param {object} ctx
     * @param {object} req  req.query.scope: site or system (optional).
     * @returns {Promise<object>}  the OpenAPI document.
     */
    async apiDocsContract(ctx, req) {
      const scope = ["site", "system"].includes(req.query.scope) ? req.query.scope : undefined;
      return ctx.plugins.contract({ scope });
    },
  },
};

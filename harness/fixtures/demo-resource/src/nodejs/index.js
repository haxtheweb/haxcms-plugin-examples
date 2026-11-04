// Demo resource (test fixture, Node). Mirrored in src/php/Plugin.php.
export default {
  contracts: {
    "oauth.resource": {
      /**
       * Implements contract oauth.resource, operation describe.
       *
       * Offers demo:read and demo:write for https://resource.example/api.
       *
       * @param {object} ctx  Platform context (spec/13).
       * @returns {Promise<object>}  { resource, title, scopes }.
       */
      async describe() {
        return { resource: "https://resource.example/api", title: "Demo resource", scopes: [{ scope: "demo:read", title: "Read", description: "Read things", write: false }, { scope: "demo:write", title: "Write", description: "Change things", write: true }] };
      },
      /**
       * Implements contract oauth.resource, operation check.
       *
       * Allows GET with demo:read and anything else with demo:write.
       *
       * @param {object} ctx  Platform context (spec/13).
       * @param {object} input  { grant, request }.
       * @returns {Promise<object>}  { allow } and a message when refused.
       */
      async check(ctx, input) {
        const need = input.request.method === "GET" ? "demo:read" : "demo:write";
        return input.grant.scopes.includes(need) ? { allow: true } : { allow: false, message: `needs ${need}` };
      },
    },
  },
  operations: {
    /**
     * Implements operation demoResourceRead.
     *
     * Echoes the grant the oauth plugin passed on, so cases can see it.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.headers["x-hax-oauth-grant"].
     * @returns {Promise<object>}  { grant }.
     */
    async demoResourceRead(ctx, req) {
      return { grant: JSON.parse((req.headers || {})["x-hax-oauth-grant"] || "null") };
    },
    /**
     * Implements operation demoResourceWrite.
     *
     * Answers ok; reaching it at all is what cases check.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @returns {Promise<object>}  { ok }.
     */
    async demoResourceWrite() {
      return { ok: true };
    },
  },
};

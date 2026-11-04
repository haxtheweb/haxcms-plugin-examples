export default { hooks: { "plugin.before.install": async () => { throw new Error("cannot reach the database"); } } };

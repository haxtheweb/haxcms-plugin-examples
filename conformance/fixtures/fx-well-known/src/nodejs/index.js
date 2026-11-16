// Serves a reserved /.well-known/ name from its settings (mirrored in src/php/Plugin.php)
export default { operations: { async fxWellKnownMetadata(ctx) { return { issuer: ctx.settings.issuer }; } } };

# haxcms-plugin-examples

Specification, JSON Schema, validator, conformance cases and example plugins for the HAXcms plugin architecture.

The architecture decisions and their log live in https://github.com/haxtheweb/issues/issues/3176. This repository is where the contract takes concrete shape so it can be reviewed before it is integrated into haxcms-nodejs and haxcms-php.

| Path | What |
|---|---|
| `spec/` | the specification, a changelog with upgrade recipes, and the gap list |
| `schema/` | JSON Schemas (`plugin.yaml`, Merlin declarations, theme and element registry entries; appstore fragments use https://github.com/haxtheweb/appstore-spec), the hook and capability lists |
| `scripts/validate.mjs` | `hax-plugin-validate`: validates a plugin folder and its registries |
| `scripts/check-core-config.mjs` | checks a live HAXcms `coreConfig` folder against the schemas |
| `examples/` | `minimal-pack`, `data-store`, and the comprehensive `example` plugin |
| `conformance/` | language-neutral cases every backend must pass (runners come later) |
| `tests/` | fixtures and the checks `npm test` runs |

Work lands here through pull requests for review; nothing is merged without maintainer approval.

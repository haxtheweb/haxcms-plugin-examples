# example (awesome)

The comprehensive teaching example. It implements **every** hook in `schema/hooks.json` (a log line, or a short body where the pattern matters) and uses every manifest key and extension point, so you can read one plugin and see how all of it fits together. It is deliberately silly: explosions. A real plugin uses a handful of these pieces.

Start with `plugin.yaml`: every key is commented. Then follow the table.

| Feature | Where | Spec |
|---|---|---|
| Manifest, identity, docs, derived tags | `plugin.yaml` | spec/02 |
| Routes (secured, public, MCP opt-in, a route that fires the plugin's own hooks, an appstore broker that keeps the API key server-side) | `config/openapi.yaml` | spec/05 |
| A new entity type (`awesomeFile` extends `file`) and a read-time annotation | `config/entities.yaml` | spec/04 |
| A data store in site scope (the other three scopes: `examples/data-store`) | `config/datastores.yaml` | spec/04 |
| A provider contract | `config/contracts.yaml` | spec/06 |
| Hooks it defines for others (a before/after pair and an alias) | `config/hooks.yaml` | spec/06 |
| Settings panel with a required value and a secret | `config/settings.schema.json`, `config/admin.yaml` | spec/07 |
| Every hook, in both runtimes | `src/nodejs/index.js`, `src/php/Plugin.php` | spec/06 |
| Notable hook bodies: veto (`entity.before.create`), requirements (`plugin.before.requirements`), mark-and-defer in a bulk transaction (`page.after.save` + `transaction.after.end`), a singleton with settings baked in (`render.after.body`), returning the subject (`config.before.save`), adding prompts (`register.before.prompts`), detached work (`git.after.commit`) | same files | spec/06 |
| A scheduled job | `schedules` in `plugin.yaml`, `tidy` in both entries | spec/06 |
| A block element with `haxProperties`, and an injected singleton | `registries/elements/`, `frontend/dist/` | spec/07 |
| A theme on the theme base, and a child theme | `registries/themes/`, `frontend/dist/` | spec/07 |
| A skeleton that enables this plugin on new sites | `registries/skeletons/awesome.json` | spec/07 |
| Merlin options: static, `api` (rows from a route, no JS) and `module` (a program) | `registries/merlin/`, `frontend/dist/explode-program.js` | spec/07 |
| An appstore app | `registries/appstore/awesome.json` | spec/07 |
| A locale overlay | `registries/locales/en.yaml` | spec/07 |
| Agent skills (site and developer) and copyable prompts | `skills/`, `docs/prompts.yaml` | spec/07 |
| Instructions for agents | `AGENTS.md` | spec/07 |
| Test cases, plus a commented-out stub as written by `hax plugin add` | `tests/cases/` | spec/07, spec/09 |

What it does when enabled on a site: it stays **inactive** until a greeting is set (requirements), then every page ends with an `awesome-counter` showing the greeting and the number of explosions; authors get an `awesome-explosion` block and three Merlin options; creating a file named `boring.awesome` is vetoed; bulk outline edits trigger one reindex instead of one per page.

The hook sections of `plugin.yaml` and both entries are generated from `schema/hook-contracts.json` and `config/hooks.yaml` by `scripts/gen-example-hooks.py`, so a new hook appears here automatically; CI (`npm test`) fails if any hook is missing. Backend code is placeholder until the loader exists; the declarative parts are validated today with `node scripts/validate.mjs examples/example`.

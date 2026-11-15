# hax-plugin-check

Every check a plugin needs, in one command. A plugin can carry code for three places at once: `src/nodejs` runs in haxcms-nodejs, `src/php` runs in haxcms-php, and `frontend/dist` ships web components to the browser. `hax-plugin-check` runs the same kinds of checks those three repositories run, on whichever parts the plugin has, plus the plugin's own contract, and finally tries it in a real running HAXcms.

```sh
npm run check                                     # every plugin in this repo
node harness/check/run.mjs contrib-plugins/glossary
node harness/check/run.mjs --only manifest,cases core-plugins/feeds
node harness/check/run.mjs --haxcms ../haxcms-nodejs core-plugins/feeds   # adds the live layer
node harness/check/run.mjs --json examples/example                        # for agents and the CLI
```

Installed as the package's `hax-plugin-check` bin, next to `hax-plugin-validate` and `hax-plugin-test`.

| Layer | Runs when the plugin has | What it checks | Same as |
| --- | --- | --- | --- |
| `manifest` | always | Is it a valid plugin: `plugin.yaml`, registries, haxProperties, hook docblocks (`scripts/validate.mjs`, which the CLI's `hax plugin validate` and `hax audit schema` call) | the plugin spec |
| `cases` | `tests/cases` | Its executable cases through the reference harness, in Node and PHP, with Node/PHP parity | the plugin spec |
| `node` | `src/nodejs`, `tests/nodejs` | ESLint with haxcms-nodejs's rules (no optional chaining), `node --test`, parity runners | haxcms-nodejs |
| `php` | `src/php` | `php -l` and PHPStan level 5. Errors that existed when the check was added are in `phpstan-baseline.neon`; new ones fail, and the baseline only shrinks | haxcms-php |
| `frontend` | `frontend/dist`, `registries/elements`, `registries/themes` | ESLint with webcomponents' rules, then in Chrome for each element (rendered from its haxProperties `demoSchema`): loads with no error, axe WCAG 2.0/2.1 A and AA (incl. color contrast) in light and in dark, changes its own colors in dark mode, and runs no animation with reduced motion on. Other modules must import cleanly | webcomponents (axe tests, contrast, dark-motion gates) |
| `live` | `--haxcms <haxcms-nodejs checkout>` | Boots a real haxcms-nodejs server (its e2e boot: temp root, real JWT login), installs the plugin and its dependencies, creates a real site, then over HTTP: the plugin is listed and not failed, contributions answer, every GET route without path parameters answers without crashing, and a page created and saved through the real API saves (or is vetoed with a 409). Required settings come from the plugin's own test cases | a real deployment |

A layer the plugin has nothing for is `skip`. A layer whose tool is missing on this machine (PHP, Chrome) is `skip` with the reason; CI installs both.

## The live layer

`--haxcms` takes a haxcms-nodejs checkout that has the plugin platform (today the `draft/plugin-platform` branch, haxcms-nodejs#138) with its dependencies installed. To test this checkout of the spec in it, link it in as the server's spec package:

```sh
git clone -b draft/plugin-platform https://github.com/haxtheweb/haxcms-nodejs ../haxcms-nodejs
(cd ../haxcms-nodejs && yarn install --frozen-lockfile --ignore-scripts \
  && rm -rf node_modules/@haxtheweb/haxcms-plugin-spec \
  && ln -s "$PWD/../haxcms-plugin-examples" node_modules/@haxtheweb/haxcms-plugin-spec)
node harness/check/run.mjs --only live --haxcms ../haxcms-nodejs
```

`inactive` is not a failure: a plugin whose requirements this environment does not meet (a command it runs, a setting with no test value) is reported with what is missing. 502, 503 and 504 from a plugin route are how a plugin says an outside service is unreachable or unconfigured, which is right with no network; a 500 is a crash and fails.

haxcms-php has no plugin host yet, so there is no PHP live layer; PHP plugin code is covered by the `cases` (PHP runtime and parity) and `php` layers until there is.

## Proving the gates work

`harness/check/fixtures/broken-plugin` breaks every gate on purpose (a bad manifest, optional chaining, an undefined PHP function, low contrast, ignored dark mode, an infinite animation, an element that throws). `node harness/check/self-test.mjs` (part of `npm test`) requires each failure to be caught.

## Files

- `run.mjs`: the command and the `manifest`, `cases`, `node` and `php` layers
- `frontend.mjs`: the browser checks (puppeteer-core with the system Chrome, axe-core; every request outside the local server is aborted)
- `live-nodejs.cjs`: the live layer
- `eslint-config.mjs`: the ESLint rules, shared with the repo's `eslint.config.mjs`
- `phpstan.sh`, `phpstan.neon`, `phpstan-baseline.neon`: PHPStan pinned to the version haxcms-php uses, checksum-verified
- `self-test.mjs`, `fixtures/`: the gates' own test

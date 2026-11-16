# broken-plugin (self-test fixture)

Not a real plugin and never shipped. Each file breaks exactly one hax-plugin-check gate on
purpose, so `node harness/check/self-test.mjs` can prove the gate catches it:

- `plugin.yaml`: the validator (its id does not match the folder name)
- `src/nodejs/index.js`: ESLint (optional chaining, unused variable)
- `src/php/Plugin.php`: PHPStan (undefined function)
- `tests/php/BrokenPluginTest.php`: PHPUnit (a failing test)
- `frontend/dist/broken-low-contrast.js`: axe color-contrast (and dark mode)
- `frontend/dist/broken-dark-ignored.js`: dark mode ignored
- `frontend/dist/broken-spinning.js`: reduced motion ignored
- `frontend/dist/broken-throws.js`: throws on load
- `frontend/dist/broken-aria-ref.js`: aria-describedby pointing across a shadow boundary

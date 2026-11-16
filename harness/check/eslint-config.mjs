// ESLint rules for plugin code, with the rules of the repository each part ends up in:
// src/nodejs and tests/nodejs follow haxcms-nodejs, frontend/dist follows webcomponents.
// Shared by the repo's eslint.config.mjs and by hax-plugin-check (harness/check/run.mjs),
// which lints one plugin folder at a time with exactly these rules.
import js from "@eslint/js";
import n from "eslint-plugin-n";
import globals from "globals";

const noOptionalChaining = {
  "no-restricted-syntax": [
    "error",
    { selector: "ChainExpression", message: "Optional chaining (?.) is not allowed in HAX code (haxcms-nodejs and webcomponents rule)." },
  ],
};
const shared = {
  ...js.configs.recommended.rules,
  ...noOptionalChaining,
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none", ignoreRestSiblings: true }],
  // importers and minifiers use \x00-style sentinels on purpose (mirrored byte for byte in src/php)
  "no-control-regex": "off",
};

/**
 * Flat config for plugin folders matched by the given globs (relative to the ESLint base path).
 * @param {string[]} roots  plugin folder globs, e.g. ["core-plugins/*"] or ["."]
 */
export function pluginConfigs(roots) {
  const under = (r, p) => (r === "." ? p : `${r}/${p}`);
  return [
    { ignores: ["**/node_modules/**", "**/vendor/**", "**/*.min.js"] },
    // Node side of a plugin: runs inside haxcms-nodejs.
    {
      files: roots.flatMap((r) => [under(r, "src/nodejs/**/*.{js,mjs,cjs}"), under(r, "tests/nodejs/**/*.{js,mjs,cjs}")]),
      languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } },
      plugins: { n },
      settings: { node: { version: ">=22.0.0" } },
      rules: {
        ...n.configs["flat/recommended-module"].rules,
        ...shared,
        // plugins import the spec package and siblings that the host resolves, not npm here
        "n/no-missing-import": "off",
        "n/no-unpublished-import": "off",
      },
    },
    // Browser side: web components, themes and Merlin programs under frontend/dist.
    {
      files: roots.map((r) => under(r, "frontend/dist/**/*.js")),
      languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.browser } },
      rules: shared,
    },
  ];
}

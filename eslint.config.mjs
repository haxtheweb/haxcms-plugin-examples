// ESLint for every plugin in this repository; rules in harness/check/eslint-config.mjs.
import { pluginConfigs } from "./harness/check/eslint-config.mjs";

export default pluginConfigs(["core-plugins/*", "contrib-plugins/*", "examples/*", "harness/fixtures/*", "conformance/fixtures/*"]);

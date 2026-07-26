// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // scripts/test/build/ holds the transpiled copies run.sh generates. Linting
    // them made results depend on whether the suite had been run.
    ignores: ["dist/*", "scripts/test/build/*", "android/*", "ios/*", "server/*"],
  }
]);

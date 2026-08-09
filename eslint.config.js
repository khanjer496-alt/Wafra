// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    // scripts/test/build/ holds the transpiled copies run.sh generates. Linting
    // them made results depend on whether the suite had been run.
    //
    // .claude/worktrees/ is the same class of problem with a louder failure: a
    // fan-out of parallel agents checks the whole repo out once per agent under
    // there, so `eslint .` linted every copy of every source file and reported
    // 899 errors in code that is already linted where it actually lives.
    // .gitignore does not help — eslint walks the filesystem, not the index.
    ignores: [
      "dist/*",
      "scripts/test/build/*",
      "android/*",
      "ios/*",
      "server/*",
      ".claude/worktrees/**",
    ],
  },
  {
    // Everything under scripts/ is a Node program, not app code: the test
    // runner, the invariant harness, the Playwright suites, the icon renderer.
    // They legitimately use __dirname, process and require, and the app config
    // does not grant those — so a new tool file failed `eslint .` in CI while
    // passing `eslint src` locally. Say what these files are instead of
    // contorting them around a config gap.
    files: ["scripts/**"],
    languageOptions: { globals: { ...globals.node } },
  }
]);

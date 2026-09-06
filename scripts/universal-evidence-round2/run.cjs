const { spawnSync } = require('node:child_process');
const path = require('node:path');
// Source-only, sequential suites: no shared compiler/build/native artifacts.
const suites = ['fields', 'money', 'semantics', 'pipeline', 'holdout-fields', 'holdout-money', 'holdout-semantics'];
let failures = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, ['--test', path.join(__dirname, suite + '.test.cjs')], { stdio: 'inherit' });
  if (result.status !== 0) failures++;
}
console.log(`Round2 suites: ${suites.length - failures}/${suites.length} passed`);
process.exitCode = failures ? 1 : 0;

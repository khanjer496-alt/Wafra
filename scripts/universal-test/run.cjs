const { spawnSync } = require('node:child_process');
const path = require('node:path');
const suites = ['fields', 'money', 'parser', 'import', 'pipeline', 'categorization', 'arabic-nonposting-safety',
  'card-statement-source', 'world-source-regressions', 'source-review-routing', 'card-native-review',
  'ai-source-contract', 'ai-platform-reader', 'ai-ios-capture', 'ai-android-capture',
  'private-alert-formats', 'private-format-source-contract', 'private-format-teaching', 'private-format-capture', 'private-format-headless', 'source-conventions', 'private-source-conventions', 'paid-account-directions', 'launch-mideast', 'launch-money', 'launch-europe', 'launch-english', 'launch-safety', 'launch-safety6', 'launch-policy', 'launch-integration', 'launch-perf', 'launch-recall'];
let failures = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, [path.join(__dirname, suite + '.test.cjs')], { stdio: 'inherit' });
  if (result.status !== 0) failures++;
}
console.log(`Universal suites: ${suites.length - failures}/${suites.length} passed (in-memory, no shared build)`);
if (failures) process.exitCode = 1;

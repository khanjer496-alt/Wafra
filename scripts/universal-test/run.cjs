const { spawnSync } = require('node:child_process');
const path = require('node:path');
const suites = ['fields', 'money', 'parser', 'import', 'pipeline', 'categorization'];
let failures = 0;
for (const suite of suites) {
  const result = spawnSync(process.execPath, [path.join(__dirname, suite + '.test.cjs')], { stdio: 'inherit' });
  if (result.status !== 0) failures++;
}
console.log(`Universal suites: ${suites.length - failures}/${suites.length} passed (in-memory, no shared build)`);
if (failures) process.exitCode = 1;

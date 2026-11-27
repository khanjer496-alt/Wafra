'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const testDir = path.resolve(__dirname, '..');

// The root `npm test` stops at its first failing suite (set -e), so a red main
// check hides every later suite. Run the main-only suites whose doubles or
// expectations this retention work touches here too, each in isolation and from
// the same directory run.sh uses, and keep source-free JSON diagnostics in the
// uploaded repair evidence.
const journey = fs.readdirSync(path.join(testDir, 'ios-journey'))
  .filter(name => name.endsWith('.test.cjs')).map(name => path.join('ios-journey', name));
const suites = [
  ['universal-test', ['../universal-test/run.cjs']],
  ['ios-journey', ['--test', '--test-concurrency=1', ...journey]],
  // ios-capture-setup also checks the prebuilt native iOS project, which only the
  // main check job generates, so it is exercised there and not in this job.
  ...['ios-setup-ux', 'relay', 'db', 'review-promotion', 'review-alerts-ui']
    .map(name => [name, [`${name}.test.js`]]),
];
// node --test prints "# tests N"; the script suites print "N passed, M failed",
// "<suite>: N passed, M failed" or "Universal suites: N/M passed".
const testsRan = (stdout) => Math.max(0,
  ...[...stdout.matchAll(/^# tests (\d+)$/gm)].map((match) => Number(match[1])),
  ...[...stdout.matchAll(/(\d+)(?:\/\d+)? passed/g)].map((match) => Number(match[1])));
const withoutTestContext = (env) => {
  const copy = { ...env };
  delete copy.NODE_TEST_CONTEXT;
  return copy;
};
for (const [name, args] of suites) {
  // universal-test alone took 163 s on hosted repair at 384983c6 and passed
  // 180 s once fix3 added parser cases; a budget timeout is not a test result.
  test(`main-only retention suite: ${name}`, { timeout: 440000 }, () => {
    const result = spawnSync(process.execPath, ['--max-old-space-size=768', ...args], {
      cwd: testDir, encoding: 'utf8', timeout: 420000, maxBuffer: 8 * 1024 * 1024,
      // node:test marks its children with NODE_TEST_CONTEXT; a nested
      // `node --test` that inherits it skips every file and exits 0.
      env: { ...withoutTestContext(process.env), FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    const evidence = JSON.stringify({ suite: name, status: result.status, signal: result.signal,
      error: result.error?.message ?? null,
      stdout: (result.stdout ?? '').slice(result.status === 0 ? -1200 : -30000),
      stderr: (result.stderr ?? '').slice(-8000) });
    assert.equal(result.status, 0, evidence);
    assert.doesNotMatch(result.stderr ?? '', /run\(\) is being called recursively/, evidence);
    // A listed suite that ran no tests is a failure, not a pass (CEO 4a8b6cee).
    assert.ok(testsRan(result.stdout ?? '') > 0, `${name} ran no tests: ${evidence}`);
    console.log(evidence);
  });
}

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
for (const [name, args] of suites) {
  // universal-test alone took 163 s on hosted repair at 384983c6 and passed
  // 180 s once fix3 added parser cases; a budget timeout is not a test result.
  test(`main-only retention suite: ${name}`, { timeout: 440000 }, () => {
    const result = spawnSync(process.execPath, ['--max-old-space-size=768', ...args], {
      cwd: testDir, encoding: 'utf8', timeout: 420000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    const evidence = JSON.stringify({ suite: name, status: result.status, signal: result.signal,
      error: result.error?.message ?? null,
      stdout: (result.stdout ?? '').slice(result.status === 0 ? -1200 : -30000),
      stderr: (result.stderr ?? '').slice(-8000) });
    assert.equal(result.status, 0, evidence);
    console.log(evidence);
  });
}

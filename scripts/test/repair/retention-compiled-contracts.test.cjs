'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');

// Run the affected existing compiled contracts in hosted repair CI as well as
// the root suite. JSON messages preserve diagnostics without terminal controls
// in the uploaded repair evidence; no blocked historical log is transformed.
for (const file of ['alert-review-tray.test.js', 'historical-import.test.js', 'contracts.test.js']) {
  test(`existing retention contract: ${file}`, { timeout: 60000 }, () => {
    const result = spawnSync(process.execPath, ['--max-old-space-size=512', path.join(root, 'scripts/test', file)], {
      cwd: root, encoding: 'utf8', timeout: 45000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    });
    const evidence = JSON.stringify({ file, status: result.status, signal: result.signal,
      error: result.error?.message ?? null,
      stdout: (result.stdout ?? '').slice(result.status === 0 ? -1200 : -24000),
      stderr: (result.stderr ?? '').slice(-6000) });
    assert.equal(result.status, 0, evidence);
    console.log(evidence);
  });
}

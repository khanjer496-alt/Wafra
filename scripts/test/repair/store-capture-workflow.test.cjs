'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const { backup } = require('../../store-capture/backup.cjs');
const { isValidBackupState } = require('../build/backup-validation.js');
const { detectSubscriptions } = require('../build/subscriptions.js');

for (const day of ['2026-01-01', '2026-03-31', '2028-02-29']) {
  for (const language of ['en', 'ar']) test(`capture uses an ordinary valid ${language} backup on ${day}`, () => {
    const fixture = backup(language, day);
    assert.equal(isValidBackupState(fixture.data), true);
    assert.equal(fixture.data.privateMode, false, 'Import captures need the real chooser, not its privacy-disabled page');
    assert.equal(fixture.data.onlineLogosEnabled, false, 'Showing Import is not consent to send merchants to a logo service');
    assert.ok(detectSubscriptions(fixture.data.transactions, [], new Date(fixture.exportedAt)).some(s => s.title === 'Netflix'));
    assert.ok(fixture.data.transactions.every(t => t.source === 'manual' && t.date <= day));
    for (const key of ['pro', 'founderPro', 'trialStartTs', 'complimentaryIssuedAt']) assert.equal(key in fixture.data, false);
  });
}
test('capture is manual, exact-source, artifact-only with strict destination assertions', () => {
  const root = path.resolve(__dirname, '../../..');
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/ios-store-capture.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|schedule:|secrets\.|auto-submit|eas build|appstoreconnect|tunnel/);
  assert.match(workflow, /persist-credentials: false/);
  const flow = fs.readFileSync(path.join(root, '.maestro/store-surfaces.yaml'), 'utf8');
  assert.equal((flow.match(/takeScreenshot:/g) || []).length, 8);
  assert.doesNotMatch(flow, /optional:|clearState|Start with sample data/);
});
test('capture validator rejects incomplete, stale, modified and incorrectly sized artifacts', () => {
  // The shared Mac's Homebrew3.14 has a broken libexpat link; system Python
  // runs these stdlib-only checks. The capture workflow pins Python3.12.
  const python = process.platform === 'darwin' ? '/usr/bin/python3' : 'python3';
  const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'scripts/store-capture', '-p', 'test_*.py'],
    { cwd: path.resolve(__dirname, '../../..'), encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
});

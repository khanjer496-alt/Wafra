'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isValidBackupState } = require('../test/build/backup-validation.js');
const { detectSubscriptions } = require('../test/build/subscriptions.js');

const folder = process.argv[2];
const results = [];
for (const language of ['en', 'ar']) {
  const file = path.join(folder, `wafra-capture-${language}.json`);
  const content = fs.readFileSync(file);
  const fixture = JSON.parse(content);
  assert.equal(fixture.app, 'wafra');
  assert.equal(fixture.version, 1);
  assert.equal(isValidBackupState(fixture.data), true, 'Shipping backup validator must accept the ordinary fixture');
  assert.equal(fixture.data.language, language);
  assert.equal(fixture.data.privateMode, false, 'Import must show the real chooser');
  assert.equal(fixture.data.onlineLogosEnabled, false);
  for (const field of ['pro', 'founderPro', 'trialStartTs', 'complimentaryIssuedAt']) {
    assert.equal(Object.hasOwn(fixture.data, field), false, `Backup must not inject ${field}`);
  }
  const recurring = detectSubscriptions(fixture.data.transactions, [], new Date(fixture.exportedAt));
  assert.ok(recurring.some(s => s.title === 'Netflix'), 'Subscription detail needs a genuinely detected recurring charge');
  assert.equal(fixture.data.transactions.every(t => t.source === 'manual'), true);
  results.push({ language, syntheticData: true, sha256: crypto.createHash('sha256').update(content).digest('hex'),
    rows: fixture.data.transactions.length, shippingValidator: true, recurringTitles: recurring.map(s => s.title) });
}
fs.writeFileSync(path.join(folder, 'validation.json'), JSON.stringify(results, null, 2) + '\n');
console.log('Both synthetic normal backups pass shipping validation and recurrence detection');

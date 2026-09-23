'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const { isValidBackupState } = load(path.join(root, 'src/lib/backup-validation.ts'), {
  '@/lib/transfer-reconciliation': require('../build/transfer-reconciliation'),
  '@/lib/ledger-money': require('../build/ledger-money'),
});
const row = { id: 'saved', type: 'expense', amountFils: 25000, category: 'groceries', accountId: 'account',
  title: 'SHOP', date: '2026-09-23', source: 'sms', viaPush: true };
test('notification observation backup receipts are optional UUIDs, never arbitrary source text', () => {
  assert.equal(isValidBackupState({ transactions: [row] }), true);
  assert.equal(isValidBackupState({ transactions: [{ ...row, notificationObservationId: '11111111-1111-4111-8111-111111111111' }] }), true);
  for (const invalid of [null, true, 1, [], {}, 'raw bank notification text', 'a'.repeat(64)]) {
    assert.equal(isValidBackupState({ transactions: [{ ...row, notificationObservationId: invalid }] }), false);
  }
});

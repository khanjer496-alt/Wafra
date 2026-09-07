'use strict';
// Synthetic mutation of existing alert grammars, not the owner's missing SMS.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSms } = require('../build/sms-parser.js');
const { createLaunchAlertSession, parsePastedBankAlerts } = require('../build/launch-alert-parser.js');
const { setActiveMarket, setLedgerCurrency } = require('../build/markets.js');
setActiveMarket('AE'); setLedgerCurrency('AED', 2);

for (const instrument of ['card', 'Credit Card', 'Debit Card']) {
  for (const sender of ['FAB', 'ENBD', 'ADCB', 'Liv']) {
    test(`${sender}/${instrument}: a completed purchase reversal remains incoming money in real capture`, () => {
      const body = `Your purchase of AED 55.75 at TALABAT with ${instrument} ending 1234 has been reversed on 05/09/2026.`;
      const legacy = parseSms(body, {}, { sender });
      assert.equal(legacy?.type, 'income', 'legacy parser already proved a return');
      const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED' });
      const actual = session.parse(body, sender, session.inspect(body, sender));
      assert.equal(actual?.type, 'income', 'semantic routing cannot turn returned money into another expense');
      assert.equal(actual.amountFils, 5575);
      assert.equal(actual.currency, 'AED');
      assert.equal(actual.categoryGuess, 'other', 'a refund is not business revenue');
      assert.equal(actual.transferHint, false);
      assert.equal(actual.date, '2026-09-05');
      assert.equal(actual.merchant, legacy.merchant);
      assert.equal(parsePastedBankAlerts(body, {})[0]?.type, 'income');
    });
  }
}

for (const [name, body, type] of [
  ['ordinary Talabat purchase', 'Purchase of AED 55.75 with Credit Card ending 1234 at TALABAT.', 'expense'],
  ['actual salary credit reversal', 'Salary credit AED 7,500.00 to your account has been reversed.', 'expense'],
  ['actual refund taken back', 'Refund AED 47.99 to card 1234 was reversed and debited from your account.', 'expense'],
  ['future purchase return', 'Your purchase of AED 55.75 at TALABAT with card ending 1234 will be reversed tomorrow.', null],
  ['failed payout', 'Talabat merchant payout of AED 1,250.00 to your account has failed.', null],
  ['future payout', 'Your Talabat merchant payout of AED 1,250.00 will be credited to your account tomorrow.', null],
]) {
  test(name + ' is not falsely added to income', () => {
    const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED' });
    const actual = session.parse(body, 'FAB', session.inspect(body, 'FAB'));
    assert.equal(actual?.type ?? null, type);
  });
}

test('a reread repairs the old reversed-purchase expense once without changing cents or user edits', () => {
  const { buildImportPlan } = require('../build/import-plan.js');
  const { materializeImportBatch, applyMaterializedImportBatch } = require('../build/ledger-import.js');
  const { summarizeMonth } = require('../build/insights.js');
  const body = 'Your purchase of AED 55.75 at TALABAT with Credit Card ending 1234 has been reversed on 05/09/2026.';
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED' });
  const parsed = session.parse(body, 'FAB', session.inspect(body, 'FAB'));
  const now = new Date('2026-09-07T12:00:00Z');
  const smsTs = Date.parse('2026-09-05T10:00:00Z');
  const captured = { ...parsed, smsTs, sender: 'FAB', channel: 'inbox', sourceEventId: 'a981' };
  const base = { hydrated: true, onboarded: true, accounts: [
    { id: 'fab-card', name: 'FAB card', bankName: 'FAB', kind: 'card', cardType: 'credit', last4: '1234', openingFils: 0, color: '#111111' },
  ], accountHints: { '1234': 'fab-card' }, transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  merchantOverrides: {}, reviewTray: { schemaVersion: 1, pending: [], tombstones: [] },
  marketId: 'AE', monthStartDay: 1, lastScanTs: 0, parserVersion: 33 };
  const apply = state => {
    let id = 0;
    const plan = buildImportPlan([captured], state, smsTs, now);
    const batch = materializeImportBatch(plan.batch, state, prefix => `${prefix}-${++id}`);
    return { state: applyMaterializedImportBatch(state, batch), plan };
  };
  const first = apply(base).state;
  assert.equal(first.transactions.length, 1);
  const original = first.transactions[0];
  const oldRow = { ...original, type: 'expense', category: 'dining' };
  const oldState = { ...first, transactions: [oldRow] };
  const repair = apply(oldState);
  assert.equal(repair.plan.txCount, 0, 'reread is not a second transaction');
  const restored = repair.state.transactions[0];
  assert.equal(restored.id, original.id);
  assert.equal(restored.amountFils, 5575);
  assert.equal(restored.date, '2026-09-05');
  assert.equal(restored.accountId, original.accountId);
  assert.equal(restored.type, 'income');
  assert.equal(restored.category, 'other');
  const summary = summarizeMonth(repair.state.transactions, { mode: 'month', key: '2026-09' });
  assert.equal(summary.incomeFils, 5575);
  assert.equal(summary.expenseFils, 0);
  assert.deepEqual(apply(repair.state).state, repair.state, 'repeated reads are idempotent');
  const edited = apply({ ...oldState, transactions: [{ ...oldRow, userEdited: true }] }).state;
  assert.equal(edited.transactions[0].type, 'expense', 'an explicit user correction remains user-owned');
});

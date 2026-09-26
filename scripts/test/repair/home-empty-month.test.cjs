'use strict';
// Actual Home + actual dashboard projection over synthetic rows. The empty-month
// card invites the person to check bank alerts, so it must appear only when the
// period truly has no live records, not merely no recent-activity rows.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, walk } = require('./reference-harness.cjs');
const { createLoader } = require('../../universal-test/load-ts.cjs');
const actual = createLoader()('@/lib/dashboard-projection');

const account = { id: 'bank', name: 'Bank', kind: 'bank', openingFils: 0 };
const card = { id: 'card', name: 'Card', kind: 'card', cardType: 'credit', openingFils: 0 };
const renderHome = transactions => {
  const h = createHarness({ state: { accounts: [account, card], transactions, bills: [], cardDues: [] } });
  h.deps['@/lib/dashboard-projection'].projectDashboard = request => actual.projectDashboard(request);
  return walk(h.render('home'));
};
const hasEmptyMonth = nodes => nodes.some(node => node.type === 'EmptyMonth');

test('a month whose only records are a card-payment settlement is not called empty', () => {
  const settlement = { id: 'settle', accountId: 'bank', date: '2026-09-05', title: 'Card payment',
    type: 'expense', category: 'other', amountFils: 50000, source: 'sms', isTransfer: true, cardPaymentSide: 'funding' };
  const receipt = { id: 'receipt', accountId: 'card', date: '2026-09-05', title: 'Card payment received',
    type: 'income', category: 'other', amountFils: 50000, source: 'sms', isTransfer: true, cardPaymentSide: 'receipt' };
  const projected = actual.projectDashboard({ state: { ...createHarness().state, accounts: [account, card],
    transactions: [settlement, receipt], bills: [], cardDues: [] }, period: { mode: 'month', key: '2026-09' },
  now: new Date('2026-09-15T09:00:00Z'), surface: 'home', includeInsights: false, includeCleanupPrompts: false });
  assert.equal(projected.activityRows.length, 0, 'settlements are not recent cash-flow activity');
  assert.equal(projected.hasPeriodTransfers, false, 'settlement sides are not transfer candidates');
  assert.equal(projected.hasPeriodRecords, true);
  assert.equal(hasEmptyMonth(renderHome([settlement, receipt])), false);
});

test('a month with no live records still offers the empty-month card', () => {
  const hidden = { id: 'old', accountId: 'archived', date: '2026-09-05', title: 'Grocer',
    type: 'expense', category: 'groceries', amountFils: 1200, source: 'manual' };
  const previous = { ...hidden, id: 'previous', accountId: 'bank', date: '2026-08-05' };
  assert.equal(hasEmptyMonth(renderHome([hidden, previous])), true);
});

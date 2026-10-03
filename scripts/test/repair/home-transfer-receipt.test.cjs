'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, walk } = require('./reference-harness.cjs');
const { createLoader } = require('../../universal-test/load-ts.cjs');
const load = createLoader();
const actual = load('@/lib/dashboard-projection');
const { TRANSFER_NORMALIZATION_VERSION } = load('@/lib/transfer-reconciliation');

for (const transition of ['finalization', 'receipt IDs', 'history completion']) test(`Home refreshes totals on ${transition} without replacing ledger arrays`, () => {
  const account = { id: 'bank', name: 'Bank', kind: 'bank', openingFils: 0 };
  const tx = { id: 'ordinary', accountId: 'bank', date: '2026-09-05', title: 'Grocer',
    type: 'expense', category: 'groceries', amountFils: 12345, source: 'manual' };
  const h = createHarness({ state: { accounts: [account], transactions: [tx], bills: [], cardDues: [],
    transferInternalIds: [tx.id], transferNormalizationVersion: transition === 'receipt IDs' ? TRANSFER_NORMALIZATION_VERSION : undefined,
    historyImport: { status: transition === 'receipt IDs' ? 'complete' : 'running', scanned: 1, found: 1 } } });
  const memoSlots = [], stateSlots = [];
  let memoIndex = 0, stateIndex = 0, projections = 0;
  h.deps.react.useMemo = (factory, dependencies) => {
    const slot = memoIndex++, prior = memoSlots[slot];
    if (prior && dependencies.length === prior.dependencies.length &&
      dependencies.every((value, i) => Object.is(value, prior.dependencies[i]))) return prior.value;
    const value = factory(); memoSlots[slot] = { dependencies, value }; return value;
  };
  h.deps.react.useState = initial => {
    const slot = stateIndex++;
    if (!Object.hasOwn(stateSlots, slot)) stateSlots[slot] = typeof initial === 'function' ? initial() : initial;
    return [stateSlots[slot], value => { stateSlots[slot] = typeof value === 'function' ? value(stateSlots[slot]) : value; }];
  };
  h.deps['@/lib/dashboard-projection'].projectDashboard = request => {
    projections++;
    return actual.projectDashboard(request);
  };
  const render = () => {
    memoIndex = stateIndex = 0;
    return walk(h.render('home')).find(node => node.props?.testID === 'home-spending-total').props.accessibilityLabel;
  };
  const money = value => h.deps['@/lib/ledger-money'].formatMinorUnits(value, h.state.ledgerMoney);
  assert.ok(render().includes(money(0)));
  const transactions = h.state.transactions, accounts = h.state.accounts;
  if (transition !== 'history completion') h.state.transferInternalIds = [];
  if (transition === 'finalization') h.state.transferNormalizationVersion = TRANSFER_NORMALIZATION_VERSION;
  if (transition !== 'receipt IDs') h.state.historyImport = { status: 'complete' };
  assert.ok(render().includes(money(12345)), 'completed receipt must remove stale exclusion from the Home total');
  assert.equal(h.state.transactions, transactions);
  assert.equal(h.state.accounts, accounts);
  assert.equal(projections, 2);
  h.state.reviewTray = { pending: [] };
  render();
  assert.equal(projections, 2, 'unrelated review status must not invalidate financial totals');
  h.state.historyImport = { ...h.state.historyImport, scanned: 100 };
  render();
  assert.equal(projections, 2, 'progress counters alone do not invalidate totals');
});

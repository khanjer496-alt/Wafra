'use strict';
// Synthetic regression cases derived from the existing Talabat settlement
// fixture. These are not the owner's missing bank messages.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSms } = require('../build/sms-parser.js');
const { createLaunchAlertSession } = require('../build/launch-alert-parser.js');
const { setActiveMarket, setLedgerCurrency } = require('../build/markets.js');
const { healPatch, applyHealPatch } = require('../build/heal.js');
const { internalTransferIds, isIncome, liveAccountIds } = require('../build/ledger.js');
const { buildImportPlan } = require('../build/import-plan.js');
const { materializeImportBatch, applyMaterializedImportBatch } = require('../build/ledger-import.js');
const { summarizeMonth } = require('../build/insights.js');

setActiveMarket('AE');
setLedgerCurrency(null);
const credit = 'AED 1,165.33 has been credited to your account 0002.';
const originator = ' B/O DELIVERY HERO TALABAT DB LLC Talabat Biweekly Payment till ';

for (const periodEnd of ['31/08/2026', '2026-08-31', '31-Aug-2026']) {
  test(`settlement period ${periodEnd} is not the bank posting date`, () => {
    const source = credit + originator + periodEnd + '.';
    const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' });
    for (const parsed of [parseSms(source, {}, { sender: 'Liv' }),
      session.parse(source, 'Liv', session.inspect(source, 'Liv'))]) {
      assert.ok(parsed);
      assert.equal(parsed.type, 'income');
      assert.equal(parsed.categoryGuess, 'business');
      assert.equal(parsed.amountFils, 116533);
      assert.equal(parsed.transferHint, false);
      assert.equal(parsed.date, null, 'capture must use the message receipt date when no posting date is stated');
    }
  });
}

test('rereading a previously generic business credit restores its proven payer as well as income visibility', () => {
  const source = credit + originator + '31-Aug-2026.';
  const parsed = parseSms(source, {}, { sender: 'Liv' });
  assert.equal(parsed.merchant, 'Talabat sales');
  const prior = {
    id: 'old-payout', source: 'sms', type: 'income', category: 'business',
    title: 'Incoming transfer', accountId: 'liv', amountFils: 116533,
    date: '2026-09-02', ts: Date.parse('2026-09-02T08:00:00Z'), isTransfer: true,
  };
  const patch = healPatch(prior, parsed);
  assert.equal(patch?.title, 'Talabat sales');
  const repaired = applyHealPatch(prior, patch);
  assert.equal(repaired.isTransfer, false);
  // A coincident, equal-sized outgoing transfer is not proof that a named
  // merchant settlement came from another owned account.
  const outgoing = { ...prior, id: 'separate-outgoing', accountId: 'fab',
    type: 'expense', title: 'Outgoing transfer', category: 'other' };
  const live = new Set(['liv', 'fab']);
  const internal = internalTransferIds([outgoing, repaired], live);
  assert.equal(isIncome(repaired, live, internal), true);
});

const baseState = () => ({
  hydrated: true, onboarded: true, accounts: [
    { id: 'liv', name: 'Liv', kind: 'bank', bankName: 'Liv', last4: '0002', openingFils: 0, color: '#111111' },
    { id: 'fab', name: 'FAB', kind: 'bank', bankName: 'FAB', last4: '0004', openingFils: 0, color: '#222222' },
  ],
  transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: { '0002': 'liv', '0004': 'fab' }, merchantOverrides: {},
  reviewTray: { schemaVersion: 1, pending: [], tombstones: [] },
  lastScanTs: 0, parserVersion: 33, marketId: 'AE', monthStartDay: 1,
  privateMode: false, captureOptOut: false,
});
const receivedAt = Date.parse('2026-09-02T08:00:00Z');
const now = new Date('2026-09-07T12:00:00Z');
function capturedPayout() {
  const source = credit + originator + '31-Aug-2026.';
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' });
  const parsed = session.parse(source, 'Liv', session.inspect(source, 'Liv'));
  assert.ok(parsed);
  return { ...parsed, date: parsed.date ?? '2026-09-02', smsTs: receivedAt,
    sender: 'Liv', channel: 'inbox', sourceEventId: 'a901' };
}
function importPayout(state) {
  let nextId = 0;
  const plan = buildImportPlan([capturedPayout()], state, receivedAt, now);
  const batch = materializeImportBatch(plan.batch, state, prefix => `${prefix}-${++nextId}`);
  return { state: applyMaterializedImportBatch(state, batch), plan };
}

test('launch parsing, import, active-account filtering and September totals agree; August stays separate', () => {
  const { state } = importPayout(baseState());
  assert.equal(state.transactions.length, 1);
  const live = liveAccountIds(state.accounts);
  const internal = internalTransferIds(state.transactions, live);
  const september = summarizeMonth(state.transactions, { mode: 'month', key: '2026-09' }, live, internal);
  assert.equal(september.incomeFils, 116533);
  assert.equal(september.expenseFils, 0);
  assert.equal(summarizeMonth(state.transactions, { mode: 'month', key: '2026-08' }, live, internal).incomeFils, 0);
  assert.deepEqual(importPayout(state).state, state, 'replay must not duplicate the payout');
});

for (const staleFlag of [false, true]) {
  test(`the real import pipeline repairs old business identity with stale transfer flag ${staleFlag}, once`, () => {
    const initial = importPayout(baseState()).state;
    const row = initial.transactions[0];
    const legacy = { ...initial, transactions: [
      { ...row, title: 'Incoming transfer', isTransfer: staleFlag },
      { id: 'separate-outgoing', accountId: 'fab', title: 'Outgoing transfer', source: 'manual',
        type: 'expense', category: 'other', amountFils: row.amountFils, date: row.date,
        ts: row.ts, isTransfer: true },
    ] };
    const repaired = importPayout(legacy);
    assert.equal(repaired.plan.txCount, 0, 'repair is an update, not a new deposit');
    assert.equal(repaired.state.transactions.length, 2);
    const payout = repaired.state.transactions.find(tx => tx.id === row.id);
    assert.equal(payout.title, 'Talabat sales');
    assert.equal(payout.type, 'income');
    assert.equal(payout.amountFils, row.amountFils);
    assert.equal(payout.date, row.date);
    assert.equal(payout.accountId, row.accountId);
    const live = liveAccountIds(repaired.state.accounts);
    const internal = internalTransferIds(repaired.state.transactions, live);
    assert.equal(isIncome(payout, live, internal), true);
    assert.equal(summarizeMonth(repaired.state.transactions, { mode: 'month', key: '2026-09' }, live, internal).incomeFils, 116533);
    assert.deepEqual(importPayout(repaired.state).state, repaired.state, 'second repair is a no-op');
  });
}

test('hand-edited entries and user-renamed or already named credits are not retitled', () => {
  const parsed = capturedPayout();
  const prior = { id: 'pinned', source: 'sms', type: 'income', category: 'business',
    title: 'Incoming transfer', amountFils: 116533, accountId: 'liv', date: '2026-09-02', isTransfer: false };
  assert.equal(healPatch({ ...prior, userEdited: true }, parsed), null);
  assert.equal(healPatch({ ...prior, titleEdited: true }, parsed)?.title, undefined);
  assert.equal(healPatch({ ...prior, title: 'My restaurant settlement' }, parsed)?.title, undefined);
  assert.equal(healPatch(prior, { ...parsed, categoryPinned: true })?.title, undefined);
  assert.equal(healPatch(prior, { ...parsed, transferHint: true })?.title, undefined);
  assert.equal(healPatch(prior, { ...parsed, merchant: 'Incoming transfer' })?.title, undefined);
});

test('Talabat purchases, refunds and non-posted notifications do not become business payouts', () => {
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE' });
  const parse = body => session.parse(body, 'Liv', session.inspect(body, 'Liv'));
  const purchase = parse('Purchase of AED 55.00 at TALABAT with Debit Card ending 1234');
  assert.equal(purchase.type, 'expense');
  assert.equal(purchase.categoryGuess, 'dining');
  const refund = parse('Refund of AED 55.00 from TALABAT has been credited to your account 0002.');
  assert.equal(refund.type, 'income');
  assert.equal(refund.categoryGuess, 'other');
  for (const body of [
    'Talabat payout of AED 1,165.33 will be credited to your account 0002 on 08/09/2026.',
    'Talabat payout of AED 1,165.33 to your account 0002 failed.',
    'Your OTP 123456 to approve an AED 55.00 payment to TALABAT. Do not share it.',
  ]) assert.equal(parse(body), null);
});

test('archiving an account continues to exclude its transactions, without modifying their income classification', () => {
  const { state } = importPayout(baseState());
  const accounts = state.accounts.map(account => ({ ...account, archived: true }));
  const live = liveAccountIds(accounts);
  const internal = internalTransferIds(state.transactions, accounts);
  const summary = summarizeMonth(state.transactions, { mode: 'month', key: '2026-09' }, live, internal);
  assert.equal(summary.incomeFils, 0);
  assert.equal(state.transactions[0].type, 'income');
});

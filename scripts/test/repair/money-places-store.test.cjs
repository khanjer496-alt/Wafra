'use strict';
// Store actions behind the Accounts/Bills redesign: "Set today's balance",
// editing a hand-made bill, and the reversible "cancelled" subscription state.
// Runs the SHIPPING reducer (scripts/perf/load-store.cjs). Synthetic data only.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { loadStore } = require('../../perf/load-store.cjs');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');
const { store, reducer, build } = loadStore();
const balances = build('balances');
const subscriptionsLib = build('subscriptions');
const freshness = load(path.join(root, 'src/lib/account-freshness.ts'));

const AED = { schemaVersion: 2, currency: 'AED', exponent: 2 };
const base = (over = {}) => reducer({ hydrated: false, transactions: [], accounts: [] }, {
  type: 'hydrate',
  state: {
    onboarded: true, language: 'en', marketId: 'AE', ledgerMoney: AED,
    accounts: [], transactions: [], bills: [], cardDues: [], goals: [], budgets: [],
    ...over,
  },
});
const bank = { id: 'bank', name: 'Everyday', kind: 'bank', openingFils: 0, color: '#000',
  snapshotFils: 500_000, snapshotKind: 'balance', snapshotTs: Date.UTC(2026, 8, 1, 9) };
const smsRow = { id: 'tx-sms', type: 'expense', amountFils: 1_000, category: 'dining', accountId: 'bank',
  title: 'Cafe', date: '2026-09-02', source: 'sms', smsKey: 's1-1000' };
const cash = { id: 'cash', name: 'Cash', kind: 'cash', openingFils: 10_000, color: '#000' };
const cashRows = [
  { id: 'c1', type: 'expense', amountFils: 2_500, category: 'dining', accountId: 'cash', title: 'Tea', date: '2026-09-03', source: 'manual' },
  { id: 'c2', type: 'income', amountFils: 1_000, category: 'other', accountId: 'cash', title: 'Refund', date: '2026-09-04', source: 'manual' },
];
const TS = Date.UTC(2026, 8, 25, 8, 30);
const setBalance = (state, id, fils, ts = TS) => reducer(state, { type: 'setAccountBalance', id, fils, ts });

test('hydrating a ledger written before these fields keeps it valid, with no cancelled subscriptions', () => {
  const state = base({ accounts: [bank] });
  assert.deepEqual({ ...state.cancelledSubscriptions }, {});
  assert.equal(state.accounts[0].manualSnapshotTs, undefined);
  assert.equal(freshness.snapshotOrigin(state.accounts[0]), 'bank');
});

test('a bank-fed account gets the typed figure as a snapshot the user owns, transactions untouched', () => {
  const before = base({ accounts: [bank], transactions: [smsRow] });
  const after = setBalance(before, 'bank', 412_345);
  const account = after.accounts.find((a) => a.id === 'bank');
  assert.equal(account.snapshotFils, 412_345);
  assert.equal(account.snapshotKind, 'balance');
  assert.equal(account.snapshotTs, TS);
  assert.equal(account.manualSnapshotTs, TS);
  assert.equal(account.openingFils, 0, 'the opening balance of a bank-fed account is not rewritten');
  assert.equal(after.transactions, before.transactions, 'no transaction is added, removed or changed');
  assert.equal(balances.reliableBalanceFils(after, account), 412_345);
  assert.equal(freshness.snapshotOrigin(account), 'manual');
  const label = freshness.accountSnapshotFreshness(account, new Date(TS + 60_000), 'en').label;
  assert.match(label, /^Set by you · today/);
  assert.doesNotMatch(label, /Bank/);
});

test('an account with captured rows but no snapshot yet also takes a snapshot, not an opening edit', () => {
  const { snapshotFils, snapshotKind, snapshotTs, ...noSnapshot } = bank;
  const after = setBalance(base({ accounts: [noSnapshot], transactions: [smsRow] }), 'bank', 90_000);
  const account = after.accounts[0];
  assert.equal(account.snapshotFils, 90_000);
  assert.equal(account.manualSnapshotTs, TS);
  assert.equal(account.openingFils, 0);
});

test('a newer bank alert takes the figure back, and is labelled as the bank again', () => {
  const mine = setBalance(base({ accounts: [bank], transactions: [smsRow] }), 'bank', 412_345).accounts[0];
  // Exactly what ledger-import.ts writes for a newer snapshot: fils, kind, ts.
  const newer = { ...mine, snapshotFils: 400_000, snapshotKind: 'balance', snapshotTs: TS + 3_600_000 };
  assert.equal(freshness.snapshotOrigin(newer), 'bank');
  assert.match(freshness.accountSnapshotFreshness(newer, new Date(TS + 3_700_000), 'en').label, /^Bank alert/);
});

test('a hand-kept account moves its opening balance so the running figure lands on what was typed', () => {
  const before = base({ accounts: [cash], transactions: cashRows });
  assert.equal(balances.reliableBalanceFils(before, before.accounts[0]), 10_000 - 2_500 + 1_000);
  const after = setBalance(before, 'cash', 20_000);
  const account = after.accounts[0];
  assert.equal(balances.reliableBalanceFils(after, account), 20_000);
  assert.equal(account.snapshotFils, undefined, 'no frozen snapshot: later entries keep moving it');
  assert.equal(account.manualSnapshotTs, undefined);
  assert.equal(after.transactions, before.transactions);
  // A later hand entry still moves the balance.
  const later = reducer(after, { type: 'addTransaction', transaction: {
    id: 'c3', type: 'expense', amountFils: 500, category: 'dining', accountId: 'cash', title: 'Snack', date: '2026-09-26', source: 'manual' } });
  assert.equal(balances.reliableBalanceFils(later, later.accounts[0]), 19_500);
});

test('zero is a real balance; negative, fractional and card balances are refused', () => {
  const before = base({ accounts: [cash, bank, { id: 'card', name: 'Visa', kind: 'card', cardType: 'credit', openingFils: 0, color: '#000' },
    { id: 'debit', name: 'Debit', kind: 'card', cardType: 'debit', openingFils: 0, color: '#000' }], transactions: cashRows });
  assert.equal(balances.reliableBalanceFils(setBalance(before, 'cash', 0), setBalance(before, 'cash', 0).accounts[0]), 0);
  assert.equal(setBalance(before, 'cash', -5), before);
  assert.equal(setBalance(before, 'cash', 1.5), before);
  assert.equal(setBalance(before, 'card', 100), before);
  assert.equal(setBalance(before, 'debit', 100), before);
  assert.equal(setBalance(before, 'missing', 100), before);
});

test('freshness labels are honest in both languages and plural-correct in Arabic', () => {
  const account = { snapshotTs: TS, manualSnapshotTs: TS };
  const days = (n) => new Date(TS + n * 86_400_000);
  assert.equal(freshness.accountSnapshotFreshness(account, days(1), 'en').label, 'Set by you · yesterday');
  assert.equal(freshness.accountSnapshotFreshness(account, days(3), 'en').label, 'Set by you · 3 days ago');
  const quiet = freshness.accountSnapshotFreshness(account, days(20), 'en');
  assert.equal(quiet.quiet, true);
  assert.equal(quiet.label, 'Set by you 20 days ago');
  assert.match(freshness.accountSnapshotFreshness(account, days(3), 'ar').label, /^أدخلته بنفسك/);
  assert.equal(freshness.accountFreshness(TS, days(2), 'ar').label, 'تنبيه البنك · قبل يومين');
  assert.equal(freshness.accountFreshness(TS, days(5), 'ar').label, 'تنبيه البنك · قبل 5 أيام');
  assert.equal(freshness.accountFreshness(TS, days(12), 'ar').label, 'تنبيه البنك · قبل 12 يوماً');
  assert.equal(freshness.accountSnapshotFreshness({}, days(1), 'en'), null);
});

const manualBill = { id: 'b1', title: 'Rent', category: 'rent', amountFils: 500_000, dueDay: 1, paidMonths: ['2026-08'] };
const yearlyBill = { id: 'b2', title: 'Insurance', category: 'other', amountFils: 120_000, dueDay: 10,
  yearlyOnISO: '2026-02-10', paidMonths: [] };
const detectedBill = { id: 'b3', title: 'Water', category: 'utilities', amountFils: 9_000, dueDay: 4, autoDetected: true, paidMonths: [] };
const edit = (state, id, patch) => reducer(state, { type: 'editBill', id, patch });

test('a hand-made bill can be renamed, re-priced and moved, keeping its paid months', () => {
  const before = base({ bills: [manualBill, yearlyBill, detectedBill] });
  const after = edit(before, 'b1', { title: '  Flat rent ', amountFils: 520_000, dueDay: 28 });
  const bill = after.bills.find((b) => b.id === 'b1');
  assert.deepEqual({ ...bill, paidMonths: [...bill.paidMonths] },
    { ...manualBill, title: 'Flat rent', amountFils: 520_000, dueDay: 28, paidMonths: ['2026-08'] });
  assert.equal(after.bills.length, 3);
});

test('a yearly bill moves its anniversary with its day, and refuses a day its month lacks', () => {
  const before = base({ bills: [yearlyBill] });
  const moved = edit(before, 'b2', { dueDay: 28 }).bills[0];
  assert.equal(moved.dueDay, 28);
  assert.equal(moved.yearlyOnISO, '2026-02-28');
  assert.equal(edit(before, 'b2', { dueDay: 29 }), before, '29 February 2026 does not exist');
  assert.equal(edit(before, 'b2', { dueDay: 30 }), before);
});

test('detected reminders and invalid edits are refused rather than half-applied', () => {
  const before = base({ bills: [manualBill, detectedBill] });
  assert.equal(edit(before, 'b3', { amountFils: 1 }), before, 'the next bank notice would overwrite it');
  assert.equal(edit(before, 'b1', { title: '   ' }), before);
  assert.equal(edit(before, 'b1', { amountFils: 0 }), before);
  assert.equal(edit(before, 'b1', { amountFils: 12.5 }), before);
  assert.equal(edit(before, 'b1', { dueDay: 0 }), before);
  assert.equal(edit(before, 'b1', { dueDay: 32 }), before);
  assert.equal(edit(before, 'b1', { title: 'Flat rent', dueDay: 40 }), before, 'one bad field refuses the whole edit');
  assert.equal(edit(before, 'missing', { title: 'x' }), before);
});

const cancel = (state, merchant, cancelledOn) => reducer(state, { type: 'setSubscriptionCancelled', merchant, cancelledOn });

test('cancelled is stored per merchant, is reversible, and never touches Not-a-subscription', () => {
  const before = base({ notSubscriptions: ['gym'] });
  const marked = cancel(before, '  City Gym ', '2026-09-25');
  assert.deepEqual({ ...marked.cancelledSubscriptions }, { 'city gym': '2026-09-25' });
  assert.deepEqual([...marked.notSubscriptions], ['gym']);
  const undone = cancel(marked, 'City Gym', null);
  assert.deepEqual({ ...undone.cancelledSubscriptions }, {});
  assert.equal(cancel(before, 'Gym', 'yesterday'), before);
  assert.equal(cancel(before, '__proto__', '2026-09-25'), before);
  assert.equal(cancel(before, '   ', '2026-09-25'), before);
});

const sub = (title, lastChargedISO, over = {}) => ({
  title, category: 'entertainment', group: 'subscription', status: 'active', cadence: 'monthly',
  avgAmountFils: 1_500, lastAmountFils: 1_500, lastChargedISO, nextExpectedISO: '2026-10-05', chargeCount: 4,
  paymentHistory: false, priceIncreased: false, priorTypicalFils: 1_500, monthlyEquivalentFils: 1_500, ...over,
});

test('a cancelled subscription leaves the monthly total until a later charge says it is still paid', () => {
  const subs = [sub('Netflix', '2026-09-05'), sub('City Gym', '2026-07-01', { monthlyEquivalentFils: 3_900 }),
    sub('Spotify', '2026-09-07', { monthlyEquivalentFils: 1_199 })];
  const cancelled = { 'city gym': '2026-09-25' };
  assert.equal(subscriptionsLib.subscriptionsMonthlyEquivalent(subs), 1_500 + 3_900 + 1_199);
  assert.equal(subscriptionsLib.subscriptionsMonthlyEquivalent(subs, cancelled), 1_500 + 1_199);
  assert.deepEqual(subscriptionsLib.withoutCancelled(subs, cancelled).map((s) => s.title), ['Netflix', 'Spotify']);
  assert.deepEqual(subscriptionsLib.cancelledByUser(subs, cancelled).map((s) => s.title), ['City Gym']);
  // Charged again after the user said it was cancelled: it counts again.
  const chargedAgain = [sub('City Gym', '2026-10-01', { monthlyEquivalentFils: 3_900 })];
  assert.equal(subscriptionsLib.isCancelledByUser(chargedAgain[0], cancelled), false);
  assert.equal(subscriptionsLib.subscriptionsMonthlyEquivalent(chargedAgain, cancelled), 3_900);
  // A charge on the day of cancelling is the one they cancelled after.
  assert.equal(subscriptionsLib.isCancelledByUser(sub('City Gym', '2026-09-25'), cancelled), true);
  // Prototype keys are not merchants.
  assert.equal(subscriptionsLib.isCancelledByUser(sub('constructor', '2026-01-01'), {}), false);
});

test('reminders skip a subscription the user cancelled, and reschedule when that changes', () => {
  const reminders = build('reminders');
  const now = new Date(2026, 8, 25, 12);
  const state = base({});
  const subs = [sub('Netflix', '2026-09-05', { nextExpectedISO: '2026-10-05' }),
    sub('City Gym', '2026-09-03', { nextExpectedISO: '2026-10-03' })];
  const ids = (s) => reminders.buildPaymentReminders(s, now, 24, subs).map((r) => r.id);
  assert.deepEqual(ids(state).sort(), ['sub-city gym', 'sub-netflix']);
  const cancelled = cancel(state, 'City Gym', '2026-09-25');
  assert.deepEqual(ids(cancelled), ['sub-netflix']);
  assert.equal(reminders.reminderScheduleInputsChanged(state, cancelled), true);
});

test('backups carrying the new fields validate, and malformed ones are refused', () => {
  const validate = build('backup-validation').isValidBackupState;
  assert.equal(validate({ transactions: [], accounts: [{ ...bank, manualSnapshotTs: TS }], cancelledSubscriptions: { 'city gym': '2026-09-25' } }), true);
  assert.equal(validate({ transactions: [], cancelledSubscriptions: { 'city gym': 'soon' } }), false);
  assert.equal(validate({ transactions: [], accounts: [{ ...bank, manualSnapshotTs: -1 }] }), false);
  assert.equal(typeof store.applyBillEdit, 'function');
});

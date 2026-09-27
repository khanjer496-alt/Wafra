'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('../../universal-test/load-ts.cjs');
const load = createLoader();
const { widgetSnapshotForLedger } = load('@/lib/widget-ledger');
const { detectSubscriptions } = load('@/lib/subscriptions');
const { setMonthStartDay } = load('@/lib/format');
const now = new Date(2026, 8, 27, 12);
const moneySpec = { schemaVersion: 2, currency: 'AED', exponent: 2 };
function monthly(title, day, amountFils, extra = {}) {
  return [7, 8, 9].map(month => ({ id: `${title}-${month}`, title, amountFils,
    category: 'software', type: 'expense', accountId: 'bank', source: 'manual', userEdited: true,
    date: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, ...extra }));
}
function state(patch = {}) {
  return { hydrated: true, onboarded: true, privateMode: false, language: 'en', marketId: 'AE', ledgerMoney: moneySpec,
    accounts: [{ id: 'bank', kind: 'bank', name: 'Current account', openingFils: 0 }],
    transactions: [...monthly('AllDebrid', 1, 1680), ...monthly('Google One', 2, 799), ...monthly('ChatGPT', 5, 7999),
      ...monthly('Claude', 9, 7599), ...monthly('Netflix', 13, 4500)],
    budgets: [], bills: [], cardDues: [], notSubscriptions: [], cancelledSubscriptions: {}, merchantOverrides: {},
    transferInternalIds: [], historyImport: null, ...patch };
}
function snapshot(s, at = now) {
  const detected = detectSubscriptions(s.transactions, s.notSubscriptions, at, new Set(s.accounts.filter(a => !a.archived).map(a => a.id)), new Set());
  return widgetSnapshotForLedger({ state: s, now: at, moneySpec, language: 'en' }, detected);
}
test('Coming up includes actual inferred subscriptions across month end, without manual bills', () => {
  setMonthStartDay(1);
  const s = state();
  const detected = detectSubscriptions(s.transactions, [], now, new Set(['bank']), new Set());
  assert.equal(detected.filter(row => row.group === 'subscription').length, 5, 'real detector establishes five obligations');
  assert.deepEqual(snapshot(s).bills.map(b => [b.title, b.dueISO, b.amountMinor, b.estimated]), [
    ['AllDebrid', '2026-10-01', 1680, true], ['Google One', '2026-10-02', 799, true], ['ChatGPT', '2026-10-05', 7999, true],
  ]);
});
test('the 30-day window includes bills beyond Home nine-day horizon and next month after paid current month', () => {
  const s = state({ transactions: [], bills: [
    { id: 'due-first', title: 'Rent', category: 'rent', amountFils: 450000, dueDay: 1, paidMonths: ['2026-09'] },
    { id: 'due-12', title: 'Utilities', category: 'utilities', amountFils: 24000, dueDay: 12, paidMonths: ['2026-09'] },
    { id: 'later', title: 'Outside window', category: 'utilities', amountFils: 5000, dueDay: 29, paidMonths: ['2026-09'] },
  ] });
  assert.deepEqual(snapshot(s).bills.map(b => [b.title, b.dueISO]), [['Rent', '2026-10-01'], ['Utilities', '2026-10-12']]);
});
test('dismissed, cancelled and archived-account recurrences never reappear in widget obligations', () => {
  const s = state({ notSubscriptions: ['AllDebrid'], cancelledSubscriptions: { 'google one': '2026-09-02' },
    accounts: [{ id: 'bank', kind: 'bank', name: 'Bank', openingFils: 0 }, { id: 'old', kind: 'bank', archived: true, name: 'Old', openingFils: 0 }] });
  s.transactions.push(...monthly('Spotify', 1, 2299, { accountId: 'old' }));
  assert.deepEqual(snapshot(s).bills.map(b => b.title), ['ChatGPT', 'Claude', 'Netflix']);
});

test('manual annual bills seed future months, with paid and salary-month boundaries respected', () => {
  const bill = { id: 'annual', title: 'Annual plan', category: 'software', amountFils: 24000,
    dueDay: 1, yearlyOnISO: '2025-10-01', paidMonths: [] };
  try {
    setMonthStartDay(1);
    assert.deepEqual(snapshot(state({ transactions: [], bills: [bill] })).bills.map(b => b.dueISO), ['2026-10-01']);
    assert.deepEqual(snapshot(state({ transactions: [], bills: [{ ...bill, paidMonths: ['2026-10'] }] })).bills, []);
    setMonthStartDay(25);
    assert.deepEqual(snapshot(state({ transactions: [], bills: [bill] })).bills.map(b => b.dueISO), ['2026-10-01']);
    assert.deepEqual(snapshot(state({ transactions: [], bills: [{ ...bill, paidMonths: ['2026-09'] }] })).bills, []);
    const boundary = { ...bill, dueDay: 27, yearlyOnISO: '2025-10-27' };
    assert.deepEqual(snapshot(state({ transactions: [], bills: [boundary] })).bills.map(b => b.dueISO), ['2026-10-27']);
    assert.deepEqual(snapshot(state({ transactions: [], bills: [{ ...boundary, dueDay: 28, yearlyOnISO: '2025-10-28' }] })).bills, []);
  } finally { setMonthStartDay(1); }
});

test('a future annual bill reconciled from an actual debit is not published as unpaid', () => {
  const bill = { id: 'annual-paid', title: 'Netflix', category: 'software', amountFils: 24000,
    dueDay: 1, yearlyOnISO: '2025-10-01', paidMonths: [] };
  const debit = { id: 'annual-payment', title: 'Netflix', category: 'software', amountFils: 24000,
    accountId: 'bank', date: '2026-10-01', type: 'expense', source: 'manual', userEdited: true };
  assert.deepEqual(snapshot(state({ bills: [bill], transactions: [debit] })).bills, []);
});

test('future annual agenda row opens its original bill and records only that occurrence paid', () => {
  const { createHarness, walk } = require('./reference-harness.cjs');
  const bills = [{ id: 'annual', title: 'Annual plan', category: 'software', amountFils: 24000,
    dueDay: 1, yearlyOnISO: '2025-10-01', paidMonths: [] }];
  const fixture = state({ transactions: [], bills });
  const make = states => {
    const h = createHarness({ state: fixture, now, states });
    h.deps['@/lib/bills'] = load('@/lib/bills');
    h.local('@/lib/upcoming-bills', 'src/lib/upcoming-bills.ts');
    return h;
  };
  const h = make({});
  const tree = h.render('bills');
  const row = walk(tree).find(n => n.props?.accessibilityLabel?.startsWith('Annual plan.') && n.props.onPress);
  assert.ok(row, 'annual October obligation is actionable in September');
  row.props.onPress();
  const chosen = h.events.find(e => e[0] === 'state' && e[1] === 4)?.[2];
  assert.deepEqual(JSON.parse(JSON.stringify(chosen)), { id: 'annual', dueISO: '2026-10-01' });
  assert.equal(h.events.some(e => e[0] === 'markBillPaid'), false);
  const detail = make({ 4: chosen });
  const sheet = walk(detail.render('bills')).find(n => n.props?.name === 'BillDetailSheet' && n.props.bill?.bill.id === 'annual');
  assert.ok(sheet, 'future annual bill resolves to the detail sheet');
  assert.equal(sheet.props.bill.dueISO, '2026-10-01');
  assert.equal(sheet.props.bill.daysLeft, 4);
  const mark = walk(sheet).find(n => n.props?.testID === 'bill-detail-mark-paid');
  assert.ok(mark); mark.props.onPress();
  assert.equal(detail.events.some(e => e[0] === 'markBillPaid'), false, 'opening confirmation sends no payment');
  const confirmation = detail.events.find(e => e[0] === 'state' && e[1] === 5)?.[2];
  assert.equal(typeof confirmation?.onConfirm, 'function'); confirmation.onConfirm();
  const payment = detail.events.find(e => e[0] === 'markBillPaid');
  assert.equal(payment[1], 'annual'); assert.equal(payment[2], '2026-10');
  assert.equal(payment[3].amountFils, 24000); assert.equal(payment[3].date, '2026-09-27');
});

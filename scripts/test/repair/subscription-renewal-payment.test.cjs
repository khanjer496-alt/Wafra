'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('../../universal-test/load-ts.cjs');
const load = createLoader();
const { billsForMonth } = load('@/lib/bills');
const { leavingSoon } = load('@/lib/leaving-soon');
const { buildPaymentReminders } = load('@/lib/reminders');
const { detectSubscriptions } = load('@/lib/subscriptions');
const { setMonthStartDay } = load('@/lib/format');
const at = date => new Date(`${date}T08:00:00`);
const bill = patch => ({ id: 'plan', title: 'ChatGPT', category: 'software', amountFils: 39900,
  dueDay: 1, autoDetected: true, paidMonths: [], ...patch });
const charge = (date, amountFils = 39900, patch = {}) => ({ id: date, date, amountFils,
  title: 'ChatGPT', category: 'software', accountId: 'bank', type: 'expense', source: 'sms', ...patch });
const history = () => ['2026-07-01', '2026-08-01', '2026-09-01'].map(date => charge(date));
const state = (transactions, bills = [bill()]) => ({ accounts: [{ id: 'bank', kind: 'bank', name: 'Bank', openingFils: 0 }],
  transactions, bills, budgets: [], cardDues: [], notSubscriptions: [], cancelledSubscriptions: {} });
const project = (transactions, date = '2026-10-01', bills = [bill()]) => billsForMonth(bills, transactions, at(date));

test('changed-price renewal settles the tracked cycle across Bills, Home and notifications', () => {
  const rows = [...history(), charge('2026-10-01', 8900)];
  const s = state(rows);
  assert.equal(project(rows)[0].status, 'paid');
  assert.equal(project(rows)[0].bill.amountFils, 8900);
  assert.deepEqual(leavingSoon(s, at('2026-10-01'), { kinds: ['card', 'bill'] }), []);
  assert.equal(buildPaymentReminders(s, at('2026-10-01')).some(r => r.dateISO === '2026-10-01'), false);
  assert.equal(project(rows, '2026-11-01')[0].bill.amountFils, 8900);
  assert.equal(project(rows, '2026-11-01')[0].status, 'due-soon');
  assert.equal(s.bills[0].amountFils, 39900, 'projection must not rewrite the saved bill');
});

test('early renewal belongs to October only, including unchanged amounts and salary months', () => {
  for (const amount of [39900, 8900]) {
    const rows = [charge('2026-07-01'), charge('2026-08-01'), charge('2026-08-31'), charge('2026-09-30', amount)];
    assert.equal(project(rows)[0].status, 'paid');
    // August31 is September's renewal, not a second payment in August.
    assert.equal(project(rows, '2026-09-01')[0].bill.amountFils, 39900);
    const withoutSeptember = [charge('2026-07-01'), charge('2026-08-01'), charge('2026-09-30', amount)];
    assert.notEqual(project(withoutSeptember, '2026-09-01')[0].status, 'paid');
    try {
      setMonthStartDay(25);
      assert.equal(project(rows)[0].status, 'paid');
      assert.equal(project(rows, '2026-10-25')[0].bill.amountFils, amount);
      assert.notEqual(project(rows, '2026-10-25')[0].status, 'paid');
    } finally { setMonthStartDay(1); }
  }
});

test('later payments do not change the amount of an earlier billing cycle', () => {
  const rows = [...history(), charge('2026-10-01', 8900), charge('2026-11-01', 12900)];
  assert.equal(project(rows)[0].bill.amountFils, 8900);
  assert.equal(project(rows, '2026-11-01')[0].bill.amountFils, 12900);
});

test('exact notices, marketplaces and unrelated providers keep strict amount matching', () => {
  for (const patch of [{ statedDueDate: '2026-10-01' }, { title: 'Apple.com' }, { title: 'ChatGPT Cafe' }]) {
    const b = bill(patch);
    const rows = [...history(), charge('2026-10-01', 8900)].map(t => ({ ...t, title: b.title }));
    assert.notEqual(project(rows, '2026-10-01', [b])[0].status, 'paid');
    assert.equal(project(rows, '2026-11-01', [b])[0].bill.amountFils, 39900);
  }
});

test('one timely charge settles a single-service subscription at its new price, saved or added by hand', () => {
  // The reported case: a bill the person added at AED 384.99, then one charge
  // at AED 799.99 four days early (27 Sep for 1 Oct), with no earlier history.
  for (const autoDetected of [true, false]) {
    const b = bill({ amountFils: 38499, autoDetected });
    const rows = [charge('2026-09-27', 79999)];
    const october = project(rows, '2026-10-01', [b])[0];
    assert.equal(october.status, 'paid', `autoDetected=${autoDetected}`);
    assert.equal(october.bill.amountFils, 79999);
    assert.equal(project(rows, '2026-11-01', [b])[0].bill.amountFils, 79999, 'the next estimate uses the new price');
    assert.notEqual(project(rows, '2026-11-01', [b])[0].status, 'paid');
    assert.notEqual(project(rows, '2026-09-01', [b])[0].status, 'paid', 'the early renewal is not also September\'s');
    assert.equal(b.amountFils, 38499, 'projection must not rewrite the saved bill');
  }
});

test('a bill added by hand keeps its same-month match off the anchor, but never double-counts a renewal', () => {
  const b = bill({ autoDetected: false, dueDay: 15 });
  // Charged on the 3rd for a bill the person dated the 15th: same month, same price.
  assert.equal(project([charge('2026-10-03')], '2026-10-01', [b])[0].status, 'paid');
  // An early renewal counts for the cycle it renews, not the month it posted in.
  const first = bill({ autoDetected: false });
  const rows = [charge('2026-09-28')];
  assert.equal(project(rows, '2026-10-01', [first])[0].status, 'paid');
  assert.notEqual(project(rows, '2026-09-01', [first])[0].status, 'paid', 'a 28 Sep renewal is October\'s, not September\'s');
});

test('ambiguous or off-anchor charges cannot settle a changed-price renewal', () => {
  const scenarios = [
    [...history(), charge('2026-10-01', 8900), charge('2026-10-01', 9900, { id: 'other' })],
    [...history(), charge('2026-10-01', 8900), charge('2026-09-20', 5000)],
    [...history(), charge('2026-10-12', 8900)],
  ];
  for (const rows of scenarios) assert.notEqual(project(rows)[0].status, 'paid');
  // A lone timely rise, or a fall after a renewed month, is that cycle's renewal.
  for (const [rows, amount] of [[[charge('2026-10-01', 49900)], 49900],
    [[charge('2026-07-01'), charge('2026-09-01'), charge('2026-10-01', 8900)], 8900]]) {
    assert.equal(project(rows)[0].status, 'paid');
    assert.equal(project(rows)[0].bill.amountFils, amount);
  }
});

test('a small charge from the same service cannot settle a bill or lower its estimate on its own', () => {
  // An add-on, a top-up or a card check near the renewal date: AED 3.67 against AED 56.
  for (const autoDetected of [true, false]) {
    const b = bill({ title: 'Netflix', amountFils: 5600, autoDetected });
    const rows = [charge('2026-10-01', 367, { title: 'Netflix' })];
    assert.notEqual(project(rows, '2026-10-01', [b])[0].status, 'paid', `autoDetected=${autoDetected}`);
    assert.equal(project(rows, '2026-11-01', [b])[0].bill.amountFils, 5600);
  }
  // A real downgrade is accepted once the previous month renewed through the service.
  const b = bill({ title: 'Netflix', amountFils: 5600 });
  const downgraded = [charge('2026-09-01', 5600, { title: 'Netflix' }), charge('2026-10-01', 2500, { title: 'Netflix' })];
  assert.equal(project(downgraded, '2026-10-01', [b])[0].status, 'paid');
  assert.equal(project(downgraded, '2026-11-01', [b])[0].bill.amountFils, 2500);
});

test('a hand-added bill charged far from its saved day still reconciles every month', () => {
  // Due on the 1st, always charged on the 20th: each charge sits nearer the
  // next anchor but renews nothing there, so its own month still claims it.
  const b = bill({ title: 'Netflix', amountFils: 5600, autoDetected: false });
  const rows = [charge('2026-09-20', 5600, { title: 'Netflix' }), charge('2026-10-20', 5600, { title: 'Netflix', id: 'oct' })];
  assert.equal(project(rows, '2026-09-01', [b])[0].status, 'paid');
  assert.equal(project(rows, '2026-10-01', [b])[0].status, 'paid');
  // A bank descriptor that only contains the name still settles through the provider match.
  const spelled = [charge('2026-10-03', 5600, { title: 'Netflix.com' })];
  assert.equal(project(spelled, '2026-10-01', [b])[0].status, 'paid');
});

test('competing saved obligations cannot both claim a changed-price renewal', () => {
  for (const other of [bill({ id: 'other' }), bill({ id: 'other', autoDetected: false }),
    bill({ id: 'other', statedDueDate: '2026-10-01' })]) {
    assert.ok(project([...history(), charge('2026-10-01', 8900)], '2026-10-01', [bill(), other])
      .every(r => r.status !== 'paid'));
  }
});

test('transfers, hidden accounts and different service identities cannot settle a renewal', () => {
  for (const patch of [{ isTransfer: true }, { type: 'income' }, { accountId: 'hidden' }]) {
    const rows = [...history(), charge('2026-10-01', 8900, patch)];
    assert.notEqual(billsForMonth([bill()], rows, at('2026-10-01'), new Set(['bank']), new Set())[0].status, 'paid');
  }
  const b = bill({ importIdentity: 'service:1234' });
  const rows = history().map(t => ({ ...t, billIdentity: 'service:1234' }));
  rows.push(charge('2026-10-01', 8900, { billIdentity: 'account:1234' }));
  assert.notEqual(project(rows, '2026-10-01', [b])[0].status, 'paid');
});

test('yearly renewals and clamped month ends retain their calendar anchor', () => {
  const yearly = bill({ yearlyOnISO: '2024-01-01' });
  const annualRows = [charge('2024-01-01'), charge('2025-01-01'), charge('2025-12-31', 8900)];
  assert.equal(project(annualRows, '2026-01-01', [yearly])[0].status, 'paid');
  assert.equal(project(annualRows, '2027-01-01', [yearly])[0].bill.amountFils, 8900);
  const monthEnd = bill({ dueDay: 31 });
  const rows = [charge('2026-01-31'), charge('2026-02-28'), charge('2026-03-30', 8900)];
  assert.equal(project(rows, '2026-03-31', [monthEnd])[0].status, 'paid');
  assert.equal(project(rows, '2026-04-30', [monthEnd])[0].bill.amountFils, 8900);
});

test('inferred renewal notification quotes the same latest amount as the visible row', () => {
  const rows = [...history(), charge('2026-10-01', 8900)];
  const now = at('2026-10-31');
  const subs = detectSubscriptions(rows, [], now);
  const visible = leavingSoon(state(rows, []), now, { detectedSubscriptions: subs });
  assert.equal(visible[0].amountFils, 8900);
  const note = buildPaymentReminders(state(rows, []), now, 24, subs).find(r => r.kind === 'subscription');
  assert.match(note.body, /89(?:\.00)?/);
  assert.doesNotMatch(note.body, /399/);
});

test('explicitly recording a later cycle does not automatically settle the payment-date cycle', () => {
  const b = bill({ paidMonths: ['2026-11'] });
  const rows = [...history(), charge('2026-10-01', 39900, { id: 'prepaid', source: 'manual',
    billPayment: { billId: 'plan', month: '2026-11' } })];
  assert.notEqual(project(rows, '2026-10-01', [b])[0].status, 'paid');
  assert.equal(project(rows, '2026-11-01', [b])[0].status, 'paid');
});

test('a reporting-day change invalidates both cycle and bill projection caches', () => {
  const bills = [bill({ dueDay: 20, paidMonths: ['2026-10'] })];
  const rows = [];
  try {
    setMonthStartDay(1);
    assert.equal(project(rows, '2026-10-26', bills)[0].dueISO, '2026-10-20');
    setMonthStartDay(25);
    assert.equal(project(rows, '2026-10-26', bills)[0].dueISO, '2026-11-20');
  } finally { setMonthStartDay(1); }
});

test('malformed service identities cannot establish a changed-price renewal', () => {
  const rows = [...history(), charge('2026-10-01', 8900)].map(t => ({ ...t, billIdentity: 'service:12345' }));
  assert.notEqual(project(rows, '2026-10-01', [bill({ importIdentity: 'service:12345' })])[0].status, 'paid');
});

test('legacy same-tail or malformed competitors cannot let one early payment settle two cycles', () => {
  for (const identity of ['account:1234', 'unrecognized:1234']) {
    const auto = bill({ importIdentity: 'service:1234' });
    const manual = bill({ id: 'other', autoDetected: false, amountFils: 8900, importIdentity: identity });
    const rows = [...history(), charge('2026-09-30', 8900)].map(t => ({ ...t, billIdentity: 'service:1234' }));
    const september = project(rows, '2026-09-01', [auto, manual]);
    const october = project(rows, '2026-10-01', [auto, manual]);
    assert.notEqual(october.find(r => r.bill.id === 'plan').status, 'paid');
    assert.equal(september.find(r => r.bill.id === 'other').status, 'paid', 'legacy bill already claims the early debit');
  }
});

// Preserve the reported SMS format with synthetic card, charge and credit-limit values.
test('Google ChatGPT card SMS imports a four-day-early price increase and clears its saved due', () => {
  const { parseSms } = load('@/lib/sms-parser');
  const { buildImportPlan } = load('@/lib/import-plan');
  const { materializeImportBatch, applyMaterializedImportBatch } = load('@/lib/ledger-import');
  const body = 'Credit Card XXX9426 used for AED849.99 (+2.99% foreign txn fee) on 27/09/2026 17:44:57 ' +
    'at Google ChatGPT,650-2530000-US. Avl. Cr.limit AED68513.72';
  const smsTs = Date.parse('2026-09-27T17:44:57+04:00');
  for (const sender of [undefined, 'ADCB']) {
    const parsed = parseSms(body, undefined, sender ? { sender } : undefined);
    assert.equal(parsed.merchant, 'ChatGPT');
    assert.equal(parsed.amountFils, 84999, 'the charge, not the fee percentage or available limit');
    assert.equal(parsed.categoryGuess, 'software');
    assert.equal(parsed.date, '2026-09-27');
    assert.equal(parsed.snapshotKind, 'limit');
    const initial = { ...state(history()), hydrated: true, marketId: 'AE', privateMode: true,
      ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
      accounts: [{ id: 'bank', kind: 'card', cardType: 'credit', last4: '9426', bankName: 'ADCB',
        name: 'Credit Card', openingFils: 0 }],
      goals: [], accountHints: {}, merchantOverrides: {}, billAliases: {}, lastScanTs: 0, parserVersion: 49 };
    let serial = 0;
    const importOnce = current => {
      const plan = buildImportPlan([{ ...parsed, smsTs, sender, channel: 'inbox' }], current, smsTs, at('2026-10-01'));
      return applyMaterializedImportBatch(current,
        materializeImportBatch(plan.batch, current, prefix => `${prefix}-${++serial}`));
    };
    const next = importOnce(initial);
    assert.equal(next.transactions.length, initial.transactions.length + 1);
    const imported = next.transactions.find(row => !initial.transactions.some(old => old.id === row.id));
    assert.equal(imported.title, 'ChatGPT');
    assert.equal(imported.amountFils, 84999);
    const current = project(next.transactions, '2026-10-01', next.bills)[0];
    assert.equal(current.status, 'paid');
    assert.equal(current.bill.amountFils, 84999);
    assert.equal(leavingSoon(next, at('2026-10-01'), { kinds: ['card', 'bill'] }).some(row => row.billId === 'plan'), false);
    assert.equal(buildPaymentReminders(next, at('2026-10-01')).some(row => row.kind === 'bill' && row.dateISO === '2026-10-01'), false);
    const following = project(next.transactions, '2026-11-01', next.bills)[0];
    assert.equal(following.bill.amountFils, 84999);
    assert.notEqual(following.status, 'paid');
    assert.equal(importOnce(next).transactions.length, next.transactions.length, 'replayed alert cannot duplicate spending');
  }
});

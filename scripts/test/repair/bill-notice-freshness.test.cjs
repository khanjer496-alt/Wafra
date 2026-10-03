'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { test } = require('node:test');

// Run shipping sources without modifying another suite's compiled directory.
function load(name, dependencies = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../src/lib', `${name}.ts`), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)(id => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    assert.ok(id.startsWith('@/lib/'), `unexpected dependency ${id}`);
    return require(path.resolve(__dirname, '../build', id.slice('@/lib/'.length)));
  }, module, module.exports);
  return module.exports;
}

const bills = load('bills');
const planner = load('import-plan');
const now = new Date(2026, 8, 30, 12);
const notice = (patch = {}) => ({
  id: 'bill', title: 'Etisalat', category: 'telecom', amountFils: 30000,
  dueDay: 25, statedDueDate: '2026-09-25', autoDetected: true, paidMonths: [], ...patch,
});
const receipt = { id: 'receipt', title: 'Etisalat', category: 'telecom', type: 'expense',
  amountFils: 25000, accountId: 'bank', date: '2026-09-20', source: 'sms' };
const status = bill => bills.billsForMonth([bill], [receipt], now)[0].status;

test('a separately imported older notice cannot replace the current exact obligation', () => {
  const current = notice();
  const state = { hydrated: true, accounts: [], transactions: [], bills: [current], cardDues: [],
    budgets: [], goals: [], merchantOverrides: {}, accountHints: {}, billAliases: {}, lastScanTs: 0,
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } };
  const { parseSms } = require('../build/sms-parser');
  const parsed = parseSms('Dear Customer, The due date for your e& bill is nearing. A total amount of AED 250.00 including VAT is due on 25-08-2026. To pay your bill, please visit businessonline.etisalat.ae/quickpay.');
  const plan = planner.buildImportPlan([{ ...parsed, sender: 'Etisalat',
    smsTs: Date.parse('2026-08-20T12:00:00Z'), channel: 'inbox' }], state, +now, now);
  assert.equal(plan.batch.newBills.length, 1, 'the prior cycle is inside the 45-day history window');
  const merged = bills.mergeImportedBills([current], plan.batch.newBills.map(b => ({
    ...b, id: 'incoming', paidMonths: [],
  })))[0];
  assert.equal(merged.amountFils, 30000);
  assert.equal(merged.statedDueDate, '2026-09-25');
  assert.notEqual(status(merged), 'paid', 'AED 250 does not settle the current AED 300 notice');
});

test('an undated replay cannot erase an exact notice or relax its payment threshold', () => {
  const current = notice();
  const incoming = notice({ id: 'undated', statedDueDate: undefined, amountFils: 25000 });
  const merged = bills.mergeImportedBills([current], [incoming])[0];
  assert.equal(merged.amountFils, 30000);
  assert.equal(merged.statedDueDate, '2026-09-25');
  assert.notEqual(status(merged), 'paid');
});

test('a newer cycle can replace an older notice with a lower amount and changed due day', () => {
  const current = notice({ paidMonths: ['2026-08'], accountId: 'chosen' });
  const incoming = notice({ id: 'october', statedDueDate: '2026-10-20', dueDay: 20, amountFils: 20000 });
  const merged = bills.mergeImportedBills([current], [incoming])[0];
  assert.equal(merged.amountFils, 20000);
  assert.equal(merged.statedDueDate, '2026-10-20');
  assert.equal(merged.dueDay, 20);
  assert.equal(merged.id, 'bill');
  assert.equal(merged.accountId, 'chosen');
  assert.deepEqual(merged.paidMonths, ['2026-08']);
});

test('manual reminders and automatic estimates retain their existing refresh semantics', () => {
  const manual = notice({ autoDetected: false, statedDueDate: undefined });
  assert.equal(bills.mergeImportedBills([manual], [notice({ amountFils: 40000 })])[0], manual);
  const estimate = notice({ statedDueDate: undefined });
  assert.equal(bills.mergeImportedBills([estimate], [notice({ statedDueDate: undefined, amountFils: 40000 })])[0].amountFils,
    40000);
  assert.equal(bills.mergeImportedBills([estimate], [notice()])[0].statedDueDate, '2026-09-25');
});

test('same-cycle corrections require strictly newer source chronology', () => {
  const before = Date.parse('2026-09-18T12:00:00Z');
  const currentAt = Date.parse('2026-09-20T12:00:00Z');
  const after = Date.parse('2026-09-22T12:00:00Z');
  const current = notice({ noticeObservedAt: currentAt });
  for (const noticeObservedAt of [before, currentAt, undefined]) {
    const replay = notice({ id: 'older', amountFils: 25000, noticeObservedAt });
    const merged = bills.mergeImportedBills([current], [replay])[0];
    assert.equal(merged.amountFils, 30000, `unproven correction at ${noticeObservedAt}`);
    assert.equal(merged.noticeObservedAt, currentAt);
  }
  const corrected = bills.mergeImportedBills([current], [notice({
    id: 'correction', amountFils: 25000, noticeObservedAt: after,
  })])[0];
  assert.equal(corrected.amountFils, 25000, 'a later bank correction may lower the total');
  assert.equal(corrected.noticeObservedAt, after);
  assert.equal(status(corrected), 'paid');
  const replayed = bills.mergeImportedBills([corrected], [current])[0];
  assert.equal(replayed.amountFils, 25000, 'an older higher total must not undo the correction');
  assert.equal(replayed.noticeObservedAt, after);
});

test('legacy notices require matching facts before acquiring source chronology', () => {
  const current = notice();
  const at = Date.parse('2026-09-20T12:00:00Z');
  assert.equal(bills.mergeImportedBills([current], [notice({
    amountFils: 25000, noticeObservedAt: at,
  })])[0].amountFils, 30000, 'an unknown prior clock cannot prove this is a newer correction');
  const enriched = bills.mergeImportedBills([current], [notice({ noticeObservedAt: at })])[0];
  assert.equal(enriched.noticeObservedAt, at);
  assert.equal(enriched.amountFils, 30000);
  const older = bills.mergeImportedBills([enriched], [notice({ noticeObservedAt: at - 1000 })])[0];
  assert.equal(older.noticeObservedAt, at, 'metadata-only replays must not rewind provenance');
});

test('planner carries only a usable original notice observation clock', () => {
  const { parseSms } = require('../build/sms-parser');
  const parsed = parseSms('Dear Customer, The due date for your e& bill is nearing. A total amount of AED 300.00 including VAT is due on 25-09-2026. To pay your bill, please visit businessonline.etisalat.ae/quickpay.');
  const state = { hydrated: true, accounts: [], transactions: [], bills: [], cardDues: [],
    budgets: [], goals: [], merchantOverrides: {}, accountHints: {}, billAliases: {}, lastScanTs: 0,
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } };
  const at = Date.parse('2026-09-20T12:00:00Z');
  for (const smsTs of [at, undefined, 0, -1, NaN, Infinity, at + 0.5]) {
    const plan = planner.buildImportPlan([{ ...parsed, sender: 'Etisalat', smsTs, channel: 'inbox' }],
      state, +now, now);
    assert.equal(plan.batch.newBills[0].noticeObservedAt, smsTs === at ? at : undefined);
  }
});

test('within-batch selection prioritizes the stated cycle before the observation clock', () => {
  const { parseSms } = require('../build/sms-parser');
  const parsed = parseSms('Dear Customer, The due date for your e& bill is nearing. A total amount of AED 300.00 including VAT is due on 25-09-2026. To pay your bill, please visit businessonline.etisalat.ae/quickpay.');
  const current = { ...parsed, sender: 'Etisalat', billIdentity: 'account:1234',
    smsTs: Date.parse('2026-09-20T12:00:00Z'), channel: 'inbox' };
  const old = { ...current, date: '2026-08-25', amountFils: 25000,
    smsTs: Date.parse('2026-09-29T12:00:00Z') };
  const state = { hydrated: true, accounts: [], transactions: [], bills: [], cardDues: [],
    budgets: [], goals: [], merchantOverrides: {}, accountHints: {}, billAliases: {}, lastScanTs: 0,
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } };
  for (const input of [[current, old], [old, current]]) {
    const plan = planner.buildImportPlan(input, state, +now, now);
    assert.equal(plan.batch.newBills.length, 1);
    assert.equal(plan.batch.newBills[0].statedDueDate, '2026-09-25');
    assert.equal(plan.batch.newBills[0].amountFils, 30000);
    assert.equal(plan.batch.newBills[0].noticeObservedAt, current.smsTs);
    const merged = bills.mergeImportedBills([notice({ importIdentity: 'account:1234' })],
      plan.batch.newBills.map(b => ({ ...b, id: 'incoming', paidMonths: [] })))[0];
    assert.equal(merged.statedDueDate, '2026-09-25');
    assert.notEqual(status(merged), 'paid');
  }
  const correction = { ...current, amountFils: 25000, smsTs: current.smsTs + 1000 };
  for (const input of [[current, correction], [correction, current]]) {
    const plan = planner.buildImportPlan(input, state, +now, now);
    assert.equal(plan.batch.newBills[0].amountFils, 25000);
    assert.equal(plan.batch.newBills[0].noticeObservedAt, correction.smsTs);
  }
});

test('an undated observation cannot displace a dated notice within either import identity path', () => {
  const { parseSms } = require('../build/sms-parser');
  const parsed = parseSms('Dear Customer, The due date for your e& bill is nearing. A total amount of AED 300.00 including VAT is due on 25-09-2026. To pay your bill, please visit businessonline.etisalat.ae/quickpay.');
  const state = { hydrated: true, accounts: [], transactions: [], bills: [], cardDues: [],
    budgets: [], goals: [], merchantOverrides: {}, accountHints: {}, billAliases: {}, lastScanTs: 0,
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } };
  for (const billIdentity of ['account:1234', undefined]) {
    const current = { ...parsed, sender: 'Etisalat', billIdentity,
      smsTs: Date.parse('2026-09-20T12:00:00Z'), channel: 'inbox' };
    const undated = { ...current, date: '2026-10-01', dueDay: null, amountFils: 25000,
      smsTs: Date.parse('2026-09-29T12:00:00Z') };
    for (const input of [[current, undated], [undated, current]]) {
      const plan = planner.buildImportPlan(input, state, +now, now);
      assert.equal(plan.batch.newBills.length, 1);
      assert.equal(plan.batch.newBills[0].statedDueDate, '2026-09-25');
      assert.equal(plan.batch.newBills[0].amountFils, 30000);
    }
  }
});

test('unorderable conflicting totals fail planning before a batch can acknowledge either notice', () => {
  const { parseSms } = require('../build/sms-parser');
  const parsed = parseSms('Dear Customer, The due date for your e& bill is nearing. A total amount of AED 300.00 including VAT is due on 25-09-2026. To pay your bill, please visit businessonline.etisalat.ae/quickpay.');
  const state = { hydrated: true, accounts: [], transactions: [], bills: [], cardDues: [],
    budgets: [], goals: [], merchantOverrides: {}, accountHints: {}, billAliases: {}, lastScanTs: 123,
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } };
  const before = JSON.stringify(state);
  const at = Date.parse('2026-09-20T12:00:00Z');
  for (const clocks of [[undefined, undefined], [at, undefined], [at, at]]) {
    const first = { ...parsed, billIdentity: 'account:1234', sender: 'Etisalat', smsTs: clocks[0], channel: 'inbox' };
    const second = { ...first, amountFils: 25000, smsTs: clocks[1] };
    for (const input of [[first, second], [second, first]]) {
      assert.throws(() => planner.buildImportPlan(input, state, +now, now), /Conflicting bill notices/);
      assert.equal(JSON.stringify(state), before, 'no ledger or import cursor can change before materialization');
    }
    const repeated = planner.buildImportPlan([first, { ...second, amountFils: first.amountFils }], state, +now, now);
    assert.equal(repeated.batch.newBills.length, 1, 'matching facts need no invented chronology');
  }
});

test('a proven higher same-cycle notice revokes only its manual paid claim', () => {
  const at = Date.parse('2026-09-20T12:00:00Z');
  const current = notice({ noticeObservedAt: at, paidMonths: ['2026-08', '2026-09', '2026-10'] });
  const transactions = [{ ...receipt, id: 'manual', amountFils: 30000, source: 'manual',
    billPayment: { billId: current.id, month: '2026-09' } }];
  const before = JSON.stringify(transactions);
  const merged = bills.mergeImportedBills([current], [notice({ amountFils: 40000, noticeObservedAt: at + 1000 })])[0];
  assert.deepEqual(merged.paidMonths, ['2026-08', '2026-10']);
  assert.equal(merged.amountFils, 40000, 'show the latest stated total without inventing a remaining-balance model');
  assert.notEqual(bills.billsForMonth([merged], transactions, now)[0].status, 'paid');
  assert.equal(JSON.stringify(transactions), before, 'the actual AED 300 expense survives');
  assert.deepEqual(current.paidMonths, ['2026-08', '2026-09', '2026-10']);
  const covered = bills.billsForMonth([merged], [{ ...receipt, amountFils: 40000 }], now)[0];
  assert.equal(covered.status, 'paid', 'independent receipt evidence can cover the corrected total');
  assert.equal(covered.autoReconciled, true);
});

test('lower, equal, older and unproven notices do not revoke an existing paid claim', () => {
  const at = Date.parse('2026-09-20T12:00:00Z');
  const current = notice({ noticeObservedAt: at, paidMonths: ['2026-09'] });
  for (const incoming of [
    notice({ amountFils: 25000, noticeObservedAt: at + 1000 }),
    notice({ amountFils: 30000, noticeObservedAt: at + 1000 }),
    notice({ amountFils: 40000, noticeObservedAt: at - 1000 }),
    notice({ amountFils: 40000, noticeObservedAt: at }),
    notice({ amountFils: 40000 }),
    notice({ amountFils: 40000, statedDueDate: '2026-08-25', noticeObservedAt: at + 1000 }),
    notice({ amountFils: 40000, statedDueDate: undefined, noticeObservedAt: at + 1000 }),
  ]) {
    assert.deepEqual(bills.mergeImportedBills([current], [incoming])[0].paidMonths, ['2026-09']);
  }
});

test('a higher later-cycle notice reopens only that later money month', () => {
  const current = notice({ paidMonths: ['2026-08', '2026-09', '2026-10'] });
  const merged = bills.mergeImportedBills([current], [notice({
    amountFils: 40000, statedDueDate: '2026-10-25',
  })])[0];
  assert.deepEqual(merged.paidMonths, ['2026-08', '2026-09']);
  const lower = bills.mergeImportedBills([current], [notice({
    amountFils: 20000, statedDueDate: '2026-10-25',
  })])[0];
  assert.deepEqual(lower.paidMonths, current.paidMonths);
});

test('revoked notice claims use salary-month boundaries instead of the calendar month', () => {
  const format = require('../build/format');
  const at = Date.parse('2026-10-01T12:00:00Z');
  format.setMonthStartDay(25);
  try {
    const current = notice({ dueDay: 3, statedDueDate: '2026-10-03', noticeObservedAt: at,
      paidMonths: ['2026-08', '2026-09', '2026-10'] });
    const merged = bills.mergeImportedBills([current], [{ ...current, amountFils: 40000,
      noticeObservedAt: at + 1000 }])[0];
    assert.deepEqual(merged.paidMonths, ['2026-08', '2026-10'], 'October 3 belongs to the September salary month');
    const later = bills.mergeImportedBills([current], [{ ...current, amountFils: 40000,
      dueDay: 25, statedDueDate: '2026-10-25', noticeObservedAt: at + 2000 }])[0];
    assert.deepEqual(later.paidMonths, ['2026-08', '2026-09'], 'October 25 starts the October salary month');
  } finally {
    format.setMonthStartDay(1);
  }
});

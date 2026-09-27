'use strict';
// Synthetic card identity; the source describes the reported HSBC table shape.
// Exercise the shipping parser, planner and ledger reducer, not copied rules.
const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const build = path.resolve(__dirname, '../build');
const { parseStatementLines } = require(path.join(build, 'imports.js'));
const { parseSms } = require(path.join(build, 'sms-parser.js'));
const { duplicateGuard } = require(path.join(build, 'dedupe.js'));
const { buildImportPlan } = require(path.join(build, 'import-plan.js'));
const { materializeImportBatch, applyMaterializedImportBatch } = require(path.join(build, 'ledger-import.js'));
const { isSpending, isIncome } = require(path.join(build, 'ledger.js'));
const { cardPaymentRows } = require(path.join(build, 'cards.js'));
const markets = require(path.join(build, 'markets.js'));
markets.setActiveMarket('AE');
markets.setLedgerCurrency('AED', 2);
const NOW = new Date('2026-09-27T12:00:00Z');
const PAN = '4111 1111 1111 1111'; // Standard synthetic test number, never customer data.
const HEADER = `HSBC Live+ Credit Card Statement\nNumber Card Credit\n${PAN}\nMinimum Payment Due AED 50.00\n`;
const TABLE = 'Transaction Date Posting Date Transaction Details Original Amount VAT Total Amount (AED)\n';
const dates = ['2026-08-26', '2026-09-03', '2026-09-03'];
const amounts = [1073500, 203600, 10175];
const TEXT = HEADER + TABLE + [
  `26-Aug-26 26-Aug-26 TO ${PAN} 10,735.00 CR 10,735.00 CR`,
  `03-Sept-26 03-Sept-26 TO ${PAN} 2,036.00 CR 2,036.00 CR`,
  `03-Sept-26 03-Sept-26 TO ${PAN} 101.75 CR 101.75 CR`,
  '10-Aug-26 11-Aug-26 CASHBACK 13.92 CR 13.92 CR',
  '23-Aug-26 24-Aug-26 Amazon.ae Dubai AE 44.99 CR 44.99 CR',
  '07-Sept-26 08-Sept-26 NFC - (G-PAY)- EMARAT 6840 Dubai AE 355.00 355.00',
  '08-Sept-26 09-Sept-26 Urban Company Dubai AE 355.00 355.00',
].join('\n');
const card = { id: 'hsbc-credit-test', name: 'HSBC Credit Card', kind: 'card', cardType: 'credit',
  last4: '1111', bankName: 'HSBC', openingFils: 0, color: '#000000' };
const instrument = { last4: '1111', kind: 'credit', bankIdentity: 'hsbc' };
const base = (transactions = []) => ({ hydrated: true, privateMode: true, marketId: 'AE',
  ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
  accounts: [card], transactions, budgets: [], bills: [], goals: [], cardDues: [],
  accountHints: { 1111: card.id }, merchantOverrides: {}, billAliases: {}, notSubscriptions: [],
  lastScanTs: 0, parserVersion: 49 });
const stamp = (date, hours = '12:00:00') => Date.parse(`${date}T${hours}Z`);
const scanned = (row, index, upload = 'a'.repeat(32)) => {
  const { raw: _raw, ...sourceFree } = row; // Relay discards the PDF body before sending it to the phone.
  return { ...sourceFree, captureSource: 'pdf', statementImportId: upload,
    smsTs: stamp(row.date) - index * 121000 };
};
let serial = 0;
function apply(rows, state) {
  const plan = buildImportPlan(rows, state, 0, NOW);
  return { plan, state: applyMaterializedImportBatch(state,
    materializeImportBatch(plan.batch, state, prefix => `${prefix}-${++serial}`)) };
}
const legacy = (i, changes = {}) => ({ id: `legacy-${i}`, source: 'sms', viaPush: true,
  type: 'expense', amountFils: amounts[i], category: 'other', accountId: card.id,
  title: 'Card payment', date: dates[i], ts: stamp(dates[i], '08:00:00') + i,
  smsKey: `s${stamp(dates[i], '08:00:00') + i}-${amounts[i]}`,
  isTransfer: true, captureInstrument: instrument, ...changes });

test('all three HSBC TO-card credits are settlement receipts, not ordinary income', () => {
  const result = parseStatementLines(TEXT, 'AED');
  assert.equal(result.rejectedRows, 0);
  assert.equal(result.rows.length, 7);
  const payments = result.rows.filter(row => row.kind === 'cardPayment');
  assert.equal(payments.length, 3);
  assert.deepEqual(payments.map(row => row.amountFils), amounts);
  assert.deepEqual(payments.map(row => row.date), dates);
  assert.equal(payments.reduce((n, row) => n + row.amountFils, 0), 1287275);
  for (const row of payments) {
    assert.equal(row.transferHint, true);
    assert.equal(row.cardPaymentSide, 'receipt');
    assert.deepEqual(row.card, { last4: '1111', kind: 'credit' });
    assert.equal(row.merchant, 'Card •1111 payment');
  }
  assert.equal(result.rows[3].kind, 'transaction');
  assert.equal(result.rows[3].transferHint, false, 'cashback is not a repayment');
  assert.equal(result.rows[4].transferHint, false, 'merchant refund is not a repayment');
  const { state } = apply(result.rows.map((row, index) => scanned(row, index)), base());
  assert.equal(state.transactions.filter(row => isSpending(row)).reduce((n, row) => n + row.amountFils, 0), 71000);
  assert.equal(state.transactions.filter(row => isIncome(row)).reduce((n, row) => n + row.amountFils, 0), 5891);
  assert.equal(cardPaymentRows(state).reduce((n, row) => n + row.amountFils, 0), 1287275);
});

test('terse TO repayment needs exact HSBC header identity and a credit direction', () => {
  const row = (description, marker = 'CR') => `26-Aug-26 ${description} 100.00 ${marker}`;
  const parse = (header, description, marker) => parseStatementLines(header + row(description, marker), 'AED').rows[0];
  assert.equal(parse(HEADER, `TO ${PAN}`).kind, 'cardPayment');
  for (const [header, description, marker] of [
    [HEADER.replace('HSBC', 'Other Bank'), `TO ${PAN}`, 'CR'],
    [HEADER, 'TO 4000 0000 0000 1111', 'CR'], // Same last-four, different full number.
    [HEADER.replace(PAN, 'XXXX XXXX XXXX 1111'), `TO ${PAN}`, 'CR'],
    [HEADER, `TO ${PAN}`, 'DR'],
    [HEADER, `TO ${PAN} REFUND`, 'CR'],
    [HEADER, `TO ${PAN} LATE FEE`, 'DR'],
    [HEADER, 'TO TESCO', 'CR'],
    [HEADER + 'Credit Card Number 4000 0000 0000 2222\n', `TO ${PAN}`, 'CR'],
    ['HSBC Statement of Account\nAccount Number 1111111111111111\n', `TO ${PAN}`, 'CR'],
  ]) assert.notEqual(parse(header, description, marker)?.kind, 'cardPayment', `${description} / ${marker}`);
});

test('statement import repairs legacy card-payment direction once without duplicating money', () => {
  const rows = parseStatementLines(TEXT, 'AED').rows.slice(0, 3).map((row, index) => scanned(row, index));
  const before = base(amounts.map((_, i) => legacy(i)));
  const { plan, state } = apply(rows, before);
  assert.equal(plan.txCount, 0);
  assert.equal(state.transactions.length, 3);
  assert.deepEqual(new Set(state.transactions.map(row => row.id)), new Set(before.transactions.map(row => row.id)));
  for (const row of state.transactions) {
    assert.equal(row.type, 'income');
    assert.equal(row.isTransfer, true);
    assert.equal(row.cardPaymentSide, 'receipt');
    assert.equal(isIncome(row), false);
    assert.equal(isSpending(row), false);
    assert.equal(row.viaPush, true, 'notification provenance is not relabelled SMS');
    assert.equal(row.smsKey, before.transactions.find(old => old.id === row.id).smsKey);
  }
  const replay = apply(rows, state);
  assert.equal(replay.plan.txCount, 0);
  assert.equal(replay.state.transactions.length, 3);
  assert.equal(cardPaymentRows(replay.state).reduce((n, row) => n + row.amountFils, 0), 1287275);
});

test('legacy repair never rewrites user edits or ordinary same-value purchases', () => {
  const row = scanned(parseStatementLines(TEXT, 'AED').rows[0], 0);
  for (const changes of [
    { userEdited: true }, { transferDecision: { version: 1, ownership: 'external', decidedAt: NOW.getTime() } },
    { title: 'Emarat', isTransfer: false, category: 'transport' },
    { date: '2026-08-25' }, { captureInstrument: { ...instrument, bankIdentity: 'adcb' } },
  ]) {
    const old = legacy(0, changes);
    const { plan } = apply([row], base([old]));
    assert.ok(!plan.batch.updates.some(update => update.id === old.id));
  }
  const ambiguous = apply([row], base([legacy(0), legacy(0, { id: 'second', smsKey: `s${stamp(dates[0], '09:00:00')}-${amounts[0]}`, ts: stamp(dates[0], '09:00:00') })]));
  assert.equal(ambiguous.plan.batch.updates.length, 0, 'ambiguous same-value old receipts are not guessed');
});

const live = (title, date = '2026-09-07', extra = {}) => ({ id: 'purchase', source: 'sms', viaPush: true,
  type: 'expense', title, date, amountFils: 35500, category: 'other', accountId: card.id,
  ts: stamp(date, '08:00:00'), smsKey: `s${stamp(date, '08:00:00')}-35500`, captureInstrument: instrument, ...extra });
const candidate = (title, date = '2026-09-08', extra = {}) => ({ type: 'expense', title, date,
  amountFils: 35500, accountId: card.id, captureInstrument: instrument,
  ts: stamp(date), smsKey: `s${stamp(date)}-35500`, captureSource: 'pdf', statementImportId: 'b'.repeat(32), ...extra });

test('same money on same card never merges contradictory merchant descriptions', () => {
  for (const date of ['2026-09-07', '2026-09-08']) {
    for (const [left, right] of [['Emarat', 'Urban Company'], ['Emarat Dubai', 'Urban Company Dubai'],
      ['Urban Company', 'Urban Restaurant'], ['Trading Company', 'Other Company']]) {
      assert.equal(duplicateGuard([live(left)]).has(candidate(right, date)), false);
      const stored = live(right, date, { captureSource: 'pdf', statementImportId: 'c'.repeat(32), ts: stamp(date), smsKey: `s${stamp(date)}-35500` });
      assert.equal(duplicateGuard([stored]).has(candidate(left, '2026-09-07', { captureSource: undefined,
        statementImportId: undefined, channel: 'push', ts: stamp('2026-09-07', '08:00:00'), smsKey: `s${stamp('2026-09-07', '08:00:00')}-35500` })), false);
    }
  }
  assert.equal(duplicateGuard([live('Emarat', '2026-09-07', { captureSource: 'pdf', statementImportId: 'c'.repeat(32) })])
    .has(candidate('Urban Company', '2026-09-07')), false, 'different uploads do not erase different merchants');
});

test('known descriptor variants still reconcile one-to-one; a genuine repeat remains', () => {
  for (const [left, right] of [['Endurancein', 'PAYPAL *ENDURANCEIN'], ['Emarat', 'NFC - (G-PAY)- EMARAT 6840 Dubai AE'],
    ['UrbanClap', 'Urban Company Dubai AE'], ['Carrefour', 'CARREFOUR HYPER 1234']]) {
    const guard = duplicateGuard([live(left)]);
    assert.equal(guard.has(candidate(right)), true, `${left} / ${right}`);
    assert.equal(guard.has(candidate(right, '2026-09-08', { ts: stamp('2026-09-08') - 121000,
      smsKey: `s${stamp('2026-09-08') - 121000}-35500` })), false, 'one live event explains only one statement row');
  }
});

test('banking-channel words are not telecom purchases and explicit transfers remain movements', () => {
  const debit = 'Your account has been debited AED 3500.00 through Personal Internet Banking.';
  const parsed = parseSms(debit, undefined, 'HSBC');
  assert.equal(parsed.categoryGuess, 'other');
  assert.equal(parsed.transferHint, false, 'a channel alone does not prove ownership or settlement');
  const transfer = parseSms('Your account has been debited AED 3500.00 for a transfer through Personal Internet Banking.', undefined, 'HSBC');
  assert.equal(transfer.merchant, 'Outgoing transfer');
  assert.equal(transfer.transferHint, true);
  assert.equal(transfer.categoryGuess, 'other');
  const { state } = apply([{ ...transfer, channel: 'push', smsTs: NOW.getTime(), sender: 'HSBC' }], base());
  assert.equal(state.transactions.length, 1);
  assert.equal(isSpending(state.transactions[0]), false);
  assert.equal(state.transactions[0].viaPush, true);
  for (const body of [
    'Your account has been debited AED 350.00 for ETISALAT through Personal Internet Banking.',
    'Your account has been debited AED 350.00 for your internet bill via mobile banking.',
  ]) {
    const bill = parseSms(body, undefined, 'HSBC');
    assert.equal(bill.categoryGuess, 'telecom');
    assert.equal(bill.transferHint, false);
  }
  const fee = parseSms('Your account has been debited AED 5.00 for a transfer through Personal Internet Banking. Transfer fee.', undefined, 'HSBC');
  assert.equal(fee.transferHint, false);
});

test('unresolved account debit retains bounded local evidence only outside private mode', () => {
  const body = 'Your account has been debited AED 3500.00 through Personal Internet Banking.';
  const p = { ...parseSms(body, undefined, 'HSBC'), channel: 'push', smsTs: NOW.getTime(), sender: 'HSBC' };
  const open = apply([p], { ...base(), privateMode: false }).state.transactions[0];
  assert.equal(open.raw, body);
  const privateRow = apply([p], base()).state.transactions[0];
  assert.equal(privateRow.raw, undefined);
  const { healPatch } = require(path.join(build, 'heal.js'));
  const wrong = { ...open, category: 'telecom', raw: undefined };
  const healed = healPatch(wrong, p);
  assert.equal(healed.category, 'other');
  assert.equal(healed.raw, body);
  assert.equal(healPatch({ ...wrong, userEdited: true }, p), null);
  const { raw: _raw, ...noSource } = p;
  assert.notEqual(healPatch(wrong, noSource)?.category, 'other', 'no source means no invented historical correction');
});

test('statement first then a legacy payment alert stays one repayment in either order', () => {
  const rows = parseStatementLines(TEXT, 'AED').rows.slice(0, 3).map((row, index) => scanned(row, index));
  const statement = apply(rows, base()).state;
  const oldAlerts = amounts.map((amountFils, index) => ({ kind: 'transaction', type: 'expense', amountFils,
    currency: 'AED', merchant: 'Card payment', date: dates[index], dueDay: null, minDueFils: null,
    card: { last4: '1111', kind: 'credit' }, transferHint: true, categoryGuess: 'other', categoryDeliberate: true,
    snapshotFils: null, snapshotKind: null, reference: null, sender: 'HSBC', channel: 'push',
    smsTs: stamp(dates[index], '08:00:00') + index }));
  const { plan, state } = apply(oldAlerts, statement);
  assert.equal(plan.txCount, 0);
  assert.equal(state.transactions.length, 3);
  assert.equal(cardPaymentRows(state).reduce((sum, row) => sum + row.amountFils, 0), 1287275);
  assert.ok(state.transactions.every(row => row.type === 'income' && row.cardPaymentSide === 'receipt'));
  const repeat = apply([oldAlerts[0], { ...oldAlerts[0], smsTs: oldAlerts[0].smsTs + 3600000 }], statement);
  assert.equal(repeat.plan.txCount, 1, 'one statement receipt cannot swallow two genuine alerts');
});

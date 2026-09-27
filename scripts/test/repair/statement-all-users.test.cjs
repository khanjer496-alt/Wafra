'use strict';
// Synthetic identities/source shapes; this verifies shared rules, not bank-format coverage.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStatementLines } = require('../build/imports.js');
const { parseSms } = require('../build/sms-parser.js');
const { duplicateGuard } = require('../build/dedupe.js');
const { buildImportPlan } = require('../build/import-plan.js');
const { materializeImportBatch, applyMaterializedImportBatch } = require('../build/ledger-import.js');
const { isIncome, isSpending } = require('../build/ledger.js');
const { transactionPresentation } = require('../build/transaction-presentation.js');
const { formatAmount } = require('../build/format.js');
const markets = require('../build/markets.js');
const currencies = [['AED', 2], ['SAR', 2], ['USD', 2], ['EUR', 2], ['JPY', 0], ['KWD', 3]];
const pans = ['4111111111111111', '5555555555554444', '4000000000000002'];
const banks = ['HSBC', 'ADCB', 'FAB', 'Emirates NBD', 'Al Rajhi', 'Chase'];
const day = '2026-02-04';
const NOW = new Date('2026-09-27T12:00:00Z');
const ts = hour => Date.parse(`${day}T${hour}:00:00Z`);
const money = (minor, exponent) => exponent === 0 ? String(minor)
  : `${Math.trunc(minor / 10 ** exponent)}.${String(minor % 10 ** exponent).padStart(exponent, '0')}`;
const header = (bank, pan) => `${bank} Credit Card Statement\nCredit Card Number ${pan}\nTransaction Date Description Amount\n`;
const input = (bank, pan, amount, description = 'PAYMENT RECEIVED - THANK YOU') =>
  header(bank, pan) + `04-Feb-26 ${description} ${amount} CR`;
let serial = 0;
const scanned = (row, captureSource = 'pdf', upload = 'a'.repeat(32)) => {
  const { raw: _raw, ...facts } = row;
  return { ...facts, captureSource, statementImportId: upload, smsTs: ts('12') };
};
function stateFor(bank, pan, currency, exponent, privateMode, user = bank) {
  const last4 = pan.slice(-4);
  const card = { id: `card-${user}`, kind: 'card', cardType: 'credit', bankName: bank,
    name: `${bank} card`, last4, openingFils: 0, color: '#000000' };
  return { hydrated: true, privateMode, marketId: 'AE',
    ledgerMoney: { schemaVersion: 2, currency, exponent }, accounts: [card], transactions: [],
    budgets: [], bills: [], goals: [], cardDues: [], accountHints: { [last4]: card.id },
    merchantOverrides: {}, billAliases: {}, notSubscriptions: [], lastScanTs: 0, parserVersion: 49 };
}
function apply(rows, state) {
  markets.setActiveMarket('AE');
  markets.setLedgerCurrency(state.ledgerMoney.currency, state.ledgerMoney.exponent);
  const plan = buildImportPlan(rows, state, 0, NOW);
  return { plan, state: applyMaterializedImportBatch(state,
    materializeImportBatch(plan.batch, state, prefix => `${prefix}-${++serial}`)) };
}
function legacy(state, amountFils) {
  const card = state.accounts[0];
  return { id: `old-${card.id}`, source: 'sms', viaPush: true,
    title: 'Card payment', type: 'expense', isTransfer: true, category: 'other',
    amountFils, accountId: card.id, date: day, ts: ts('08'), smsKey: `s${ts('08')}-${amountFils}`,
    captureInstrument: { last4: card.last4, kind: 'credit', bankIdentity: markets.bankIdentityForName(card.bankName) } };
}
for (const [currency, exponent] of currencies) {
  test(`HSBC TO-card grammar is independent of user/card/amount in ${currency}`, () => {
    for (const pan of pans) for (const minor of [1, 35125, 789001]) {
      const result = parseStatementLines(input('HSBC', pan, money(minor, exponent), `TO ${pan}`), currency);
      assert.equal(result.rejectedRows, 0, `${currency}/${minor}/${pan.slice(-4)}`);
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].kind, 'cardPayment');
      assert.equal(result.rows[0].cardPaymentSide, 'receipt');
      assert.equal(result.rows[0].card.last4, pan.slice(-4));
      assert.equal(result.rows[0].amountFils, minor);
      assert.ok(!JSON.stringify(scanned(result.rows[0])).includes(pan), 'no full PAN in body-free facts');
    }
  });
}
for (const bank of banks) for (const [currency, exponent] of currencies) {
  test(`${bank}/${currency}: settlements survive both orders, privacy settings and reimports`, () => {
    const bankIndex = banks.indexOf(bank);
    const pan = pans[bankIndex % pans.length];
    const amount = 73125 + bankIndex * 17;
    const result = parseStatementLines(input(bank, pan, money(amount, exponent)), currency,
      { card: { kind: 'credit', last4: pan.slice(-4) }, bankHint: bank });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].kind, 'cardPayment');
    for (const captureSource of ['pdf', 'csv']) for (const privateMode of [false, true]) {
      // csv tests planner provenance here, not CSV text extraction.
      const fresh = stateFor(bank, pan, currency, exponent, privateMode);
      const original = legacy(fresh, amount);
      const statement = scanned(result.rows[0], captureSource);
      const first = apply([statement], { ...fresh, transactions: [original] });
      assert.equal(first.plan.txCount, 0, 'one legacy payment is updated, not added again');
      assert.equal(first.state.transactions.length, 1);
      const saved = first.state.transactions[0];
      assert.equal(saved.id, original.id);
      assert.equal(saved.amountFils, amount);
      assert.equal(saved.type, 'income');
      assert.equal(saved.cardPaymentSide, 'receipt');
      assert.equal(saved.viaPush, true);
      assert.equal(isSpending(saved), false);
      assert.equal(isIncome(saved), false);
      const replay = apply([statement], first.state);
      assert.equal(replay.plan.txCount, 0);
      assert.equal(replay.state.transactions.length, 1);
      assert.equal(replay.state.transactions[0].raw, undefined);
      const statementFirst = apply([statement], fresh).state;
      const oldAlert = { ...result.rows[0], kind: 'transaction', type: 'expense', merchant: 'Card payment',
        cardPaymentSide: undefined, channel: 'push', smsTs: ts('08'), sender: bank };
      const reverse = apply([oldAlert], statementFirst);
      assert.equal(reverse.plan.txCount, 0, 'later legacy alert is not a second receipt');
      assert.equal(reverse.state.transactions.length, 1);
      assert.equal(reverse.state.transactions[0].cardPaymentSide, 'receipt');
    }
  });
}
test('card identity, direction, refunds and fees remain boundaries for every synthetic HSBC card', () => {
  for (const pan of pans) {
    const other = (pan[0] === '4' ? '5' : '4') + pan.slice(1);
    for (const body of [input('Other Bank', pan, '200.00', `TO ${pan}`),
      input('HSBC', pan, '200.00', `TO ${other}`),
      input('HSBC', pan, '200.00', `TO ${pan}`).replace('200.00 CR', '200.00 DR'),
      input('HSBC', pan, '200.00', 'CASHBACK'), input('HSBC', pan, '200.00', 'CARD PAYMENT REFUND'),
      input('HSBC', pan, '200.00', 'CARD PAYMENT FEE'),
    ]) assert.notEqual(parseStatementLines(body, 'AED').rows[0]?.kind, 'cardPayment');
  }
});
test('manual edits, splits and ownership decisions are never rewritten by the legacy repair', () => {
  const base = stateFor('HSBC', pans[1], 'AED', 2, true);
  const payment = scanned(parseStatementLines(input('HSBC', pans[1], '731.25'), 'AED').rows[0]);
  for (const changes of [{ userEdited: true, title: 'My saved payment' }, { source: 'manual' },
    { transferDecision: { version: 1, ownership: 'external', decidedAt: NOW.getTime() } },
    { splits: [{ category: 'shopping', amountFils: 73125 }] },
  ]) {
    const old = { ...legacy(base, 73125), ...changes };
    const before = JSON.stringify(old);
    const result = apply([payment], { ...base, transactions: [old] });
    assert.ok(!result.plan.batch.updates.some(update => update.id === old.id));
    assert.equal(JSON.stringify(old), before);
  }
});
const live = (title, extra = {}) => ({ id: 'live', title, type: 'expense', amountFils: 35500,
  category: 'other', source: 'sms', viaPush: true, accountId: 'card', date: day,
  ts: ts('08'), smsKey: `s${ts('08')}-35500`,
  captureInstrument: { last4: '1111', kind: 'credit', bankIdentity: 'hsbc' }, ...extra });
const candidate = (title, extra = {}) => ({ ...live(title), id: undefined, channel: undefined,
  captureSource: 'pdf', statementImportId: 'b'.repeat(32), ts: ts('12'), smsKey: `s${ts('12')}-35500`, ...extra });
test('a shared brand prefix cannot erase a different local business', () => {
  for (const [a, b] of [['Amazon', 'Amazon Cafe Dubai AE'], ['Netflix', 'Netflix Car Rental Dubai AE'],
    ['Apple', 'Apple Pharmacy'], ['The One', 'The One Restaurant'], ['Urban Company', 'Urban Restaurant'],
    ['Carrefour', 'Carrefour Cafe MOE DXB']]) {
    assert.equal(duplicateGuard([live(a)]).has(candidate(b)), false, `${a}/${b}`);
    assert.equal(duplicateGuard([live(b, { captureSource: 'pdf', statementImportId: 'c'.repeat(32) })])
      .has(candidate(a, { captureSource: undefined, statementImportId: undefined, channel: 'push' })), false);
  }
});
test('compatible descriptions consume once and respect card, bank, account, direction and date', () => {
  for (const [a, b] of [['Emarat', 'NFC - (G-PAY)- EMARAT 6840 DUBAI AE'],
    ['UrbanClap', 'Urban Company Dubai AE'], ['Carrefour', 'CARREFOUR HYPER 1234'],
    ['Carrefour', 'CARREFOUR MOE DXB'],
    ['Endurancein', 'PAYPAL *ENDURANCEIN']]) {
    const guard = duplicateGuard([live(a)]);
    assert.equal(guard.has(candidate(b)), true, `${a}/${b}`);
    assert.equal(guard.has(candidate(b, { smsKey: `s${ts('13')}-35500`, ts: ts('13') })), false);
    for (const extra of [{ accountId: 'other-card' },
      { captureInstrument: { last4: '1111', kind: 'credit', bankIdentity: 'adcb' } },
      { captureInstrument: { last4: '4444', kind: 'credit', bankIdentity: 'hsbc' } },
      { type: 'income' }, { amountFils: 35510 }, { date: '2026-03-10' },
    ]) assert.equal(duplicateGuard([live(a)]).has(candidate(b, extra)), false);
  }
});
test('bank-channel categorization is shared and never hides actual telecom bills', () => {
  markets.setActiveMarket('AE'); markets.setLedgerCurrency('AED', 2);
  for (const bank of banks.slice(0, 4)) for (const channel of ['Personal Internet Banking', 'mobile banking', 'online banking']) {
    const debit = parseSms(`Your account has been debited AED 123.45 through ${channel}.`, undefined, bank);
    assert.equal(debit.categoryGuess, 'other'); assert.equal(debit.transferHint, false);
    const bill = parseSms(`Your account has been debited AED 123.45 for ETISALAT through ${channel}.`, undefined, bank);
    assert.equal(bill.categoryGuess, 'telecom'); assert.equal(bill.transferHint, false);
  }
});
test('display and exact money survive independent users, sources and currency switches', () => {
  for (const [currency, exponent] of currencies) for (const language of ['en', 'ar']) {
    markets.setLedgerCurrency(currency, exponent);
    for (const source of [undefined, 'pdf', 'csv', 'email', 'shortcut']) for (const viaPush of [true, false]) {
      const original = { ...live('NFC - (G-PAY)- SHOP 123 DUBAI AE'), captureSource: source,
        viaPush, amountFils: 12345, id: `${currency}-${language}-${source}-${viaPush}` };
      Object.freeze(original);
      const before = JSON.stringify(original);
      const result = transactionPresentation(original, language);
      assert.equal(result.title, 'Shop 123'); assert.equal(result.sign, 'minus'); assert.equal(result.repayment, false);
      assert.equal(formatAmount(12345, { decimals: true, canonical: true }), exponent === 0 ? '12,345' : exponent === 2 ? '123.45' : '12.345');
      assert.equal(JSON.stringify(original), before); assert.equal(isSpending(original), true);
    }
  }
  markets.setLedgerCurrency('AED', 2);
});

test('explicit issuer survives neutral/other-market ledgers and same-tail account collisions', () => {
  for (const currency of ['AED', 'SAR', 'USD']) for (const [left, right] of [
    ['HSBC', 'ADCB'], ['Al Rajhi', 'FAB'], ['Chase', 'Other Bank'], ['بنك ألف', 'بنك باء'],
  ]) {
    const base = stateFor(left, pans[0], currency, 2, true, 'first');
    const second = stateFor(right, pans[0], currency, 2, true, 'second').accounts[0];
    const collision = { ...base, accounts: [base.accounts[0], second], accountHints: { 1111: second.id } };
    const parsed = parseStatementLines(input(left, pans[0], '123.45'), currency,
      { card: { kind: 'credit', last4: '1111' }, bankHint: left }).rows[0];
    const result = apply([scanned(parsed)], collision);
    assert.equal(result.plan.batch.newAccounts.length, 0, `${currency}/${left}`);
    assert.equal(result.state.transactions.length, 1);
    assert.equal(result.state.transactions[0].accountId, base.accounts[0].id);
    assert.equal(result.state.transactions[0].captureInstrument.bankIdentity, markets.bankIdentityForName(left));
    assert.equal(collision.accountHints[1111], second.id, 'planning did not mutate old hints');
  }
});

test('unidentified card source cannot cross-merge against a different explicitly named bank', () => {
  const base = stateFor('HSBC', pans[0], 'USD', 2, true);
  const old = { ...live('Endurancein'), accountId: base.accounts[0].id, amountFils: 12345 };
  const parsed = parseStatementLines('04-Feb-26 PAYPAL *ENDURANCEIN 123.45 DR', 'USD',
    { card: null, bankHint: 'Chase' }).rows[0];
  const result = apply([scanned(parsed)], { ...base, transactions: [old] });
  assert.equal(result.plan.txCount, 1);
  assert.equal(result.state.transactions.length, 2);
});

test('unknown issuer stays unknown instead of inheriting a country default', () => {
  const base = stateFor('HSBC', pans[0], 'USD', 2, true, 'first');
  const second = stateFor('ADCB', pans[0], 'USD', 2, true, 'second').accounts[0];
  const parsed = parseStatementLines(input('Unidentified', pans[0], '123.45'), 'USD',
    { card: { kind: 'credit', last4: '1111' } }).rows[0];
  const result = apply([scanned(parsed)], { ...base, accounts: [...base.accounts, second] });
  assert.equal(result.state.transactions.length, 1);
  assert.equal(result.state.transactions[0].captureInstrument.bankIdentity, undefined);
  assert.ok(![base.accounts[0].id, second.id].includes(result.state.transactions[0].accountId));
});

test('known zero-decimal card identity exception never imports a labelled running balance', () => {
  for (const tail of ['TO 5555555555551111 351 9000 CR', 'SHOP 351 9000 CR', 'TO 4111111111111111 351 9000 CR']) {
    const result = parseStatementLines(header('HSBC', pans[0]) + `04-Feb-26 ${tail}`, 'JPY');
    assert.equal(result.rows.length, 0);
    assert.equal(result.rejectedRows, 1);
  }
});

test('the real CSV reader keeps explicit receipt/fee/refund directions and currency precision', () => {
  const { parseStatementCsv } = require('../build/imports.js');
  for (const [currency, exponent] of currencies) {
    const amount = money(12345, exponent);
    const csv = 'Date,Description,Debit,Credit,Credit Card Number\n' +
      `2026-02-04,PAYMENT RECEIVED - THANK YOU,,${amount},1111\n` +
      `2026-02-05,CARD PAYMENT FEE,${amount},,1111\n` +
      `2026-02-06,MERCHANT REFUND,,${amount},1111`;
    const result = parseStatementCsv(csv, currency);
    assert.equal(result.rejectedRows, 0);
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[0].kind, 'cardPayment');
    assert.equal(result.rows[0].cardPaymentSide, 'receipt');
    assert.equal(result.rows[1].type, 'expense');
    assert.equal(result.rows[1].transferHint, false);
    assert.equal(result.rows[2].type, 'income');
    assert.equal(result.rows[2].transferHint, false);
    assert.ok(result.rows.every(row => row.amountFils === 12345));
  }
});

test('repeated identical statement amounts are preserved one-for-one, never guessed into one old payment', () => {
  const base = stateFor('HSBC', pans[0], 'AED', 2, true);
  const statement = parseStatementLines(input('HSBC', pans[0], '123.45'), 'AED').rows[0];
  const original = legacy(base, 12345);
  const before = { ...base, transactions: [original] };
  const sameUpload = [scanned(statement), { ...scanned(statement), smsTs: ts('12') - 121000 }];
  const result = apply(sameUpload, before);
  assert.equal(result.plan.txCount, 1);
  assert.equal(result.state.transactions.length, 2);
  assert.equal(result.state.transactions.reduce((sum, row) => sum + row.amountFils, 0), 24690);
  assert.equal(apply(sameUpload, result.state).plan.txCount, 0);
});

for (const platform of ['android', 'ios']) for (const language of ['en', 'ar']) for (const largeText of [false, true]) {
  test(`${platform}/${language}/large=${largeText}: shared repayment rows use real currency formatting`, () => {
    // Components execute; native primitives are explicit harness substitutes, not a device test.
    const { createHarness, text } = require('./reference-harness.cjs');
    const h = createHarness({ platform, language, largeText });
    h.deps['@/lib/format'].formatAmount = formatAmount;
    h.deps['@/lib/markets'].ledgerCurrencyCode = markets.ledgerCurrencyCode;
    for (const [currency, exponent] of currencies) {
      markets.setLedgerCurrency(currency, exponent);
      const tx = { ...live('Card payment'), type: 'income', isTransfer: true, cardPaymentSide: 'receipt',
        captureSource: 'pdf', amountFils: 12345 };
      const before = JSON.stringify(tx);
      const row = h.deps['@/components/transaction-row'].TransactionRow({ transaction: tx, onPress() {} });
      const exact = formatAmount(tx.amountFils, { decimals: true });
      assert.ok(text(row).includes(exact));
      assert.ok(row.props.accessibilityLabel.includes(exact));
      assert.ok(row.props.accessibilityLabel.includes(currency));
      assert.ok(text(row).includes(language === 'ar' ? 'سداد بطاقة ائتمان' : 'Credit-card repayment'));
      assert.doesNotMatch(row.props.accessibilityLabel, /plus|minus/i);
      assert.equal(JSON.stringify(tx), before);
    }
    assert.ok(!h.events.some(event => event[0] === 'editTransaction'));
    markets.setLedgerCurrency('AED', 2);
  });
}

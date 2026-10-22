const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-ts.cjs').createLoader();
const { createHash } = require('node:crypto');
const { hasBankAlertMoneyHint, hasGenericBankAlertContext, inspectGenericBankEventForReview,
  createLaunchAlertSession } = load('@/lib/launch-alert-parser');
const { parseHistoricalMessageRecords } = load('@/lib/historical-import');
const { setActiveMarket, setLedgerCurrency } = load('@/lib/markets');
const { setActiveCountry } = load('@/lib/country');

// Fictional values in public-source wallet/field-list layouts. No real
// accounts or counterparties; these tests verify routing, never bank coverage.
// https://github.com/sarim2000/pennywiseai-tracker/issues/524
const wallet = 'Money sent successfully to CEDAR CLIENT. Amount Tsh 12,500. Total Charges Tsh 430. Fees Tsh 400. Balance is Tsh 1,200. TxnID: ABC135724.';

test('a native Tanzanian wallet receipt reaches generic Review with separate principal and balance', () => {
  assert.equal(hasBankAlertMoneyHint(wallet), true);
  assert.equal(hasGenericBankAlertContext(wallet), true);
  const event = inspectGenericBankEventForReview(wallet);
  assert.ok(event);
  assert.equal(event.decision, 'review');
  assert.equal(event.amount.value.currency, 'TZS');
  assert.equal(event.amount.value.minorUnits, '1250000');
  assert.equal(event.balance.value.minorUnits, '120000');
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'TZS', activeMarket: 'ZZ',
    bestEffort: { enabled: false, country: 'TZ' } });
  assert.equal(session.parseUnproven(wallet, '', session.inspect(wallet, '')), null);
});

test('TSh receipt fields retain Review routing when principal follows a prior balance', () => {
  const source = 'Balance: Tsh 17,500. You have received Tsh 12,500 from CEDAR CLIENT. TxnID: ABC135724.';
  assert.equal(hasGenericBankAlertContext(source), true);
  const event = inspectGenericBankEventForReview(source);
  assert.ok(event);
  assert.equal(event.amount.value.minorUnits, '1250000');
  assert.equal(event.balance.value.minorUnits, '1750000');
});

test('abbreviated TSh principal and balance fields are reviewable without claiming completion', () => {
  const source = 'Money sent to CEDAR CLIENT. Txn Amt: Tsh 12,500. Total Charges: Tsh 430. Bal: Tsh 1,200. Ref: ABC135724.';
  assert.equal(hasGenericBankAlertContext(source), true);
  const event = inspectGenericBankEventForReview(source);
  assert.ok(event);
  assert.equal(event.decision, 'review');
});

test('a structured debit account and amount are reviewable without inventing settlement', () => {
  const source = 'Debit!\nAcct:35****2468\nAmt:NGN125.60\nDesc:POS PURCHASE ORCHARD BOOKSHOP\nDate:2026-10-09 09:15\nBal:NGN3500.00';
  assert.equal(hasGenericBankAlertContext(source), true);
  const event = inspectGenericBankEventForReview(source);
  assert.ok(event);
  assert.equal(event.amount.value.currency, 'NGN');
  assert.equal(event.status, 'unknown');
  assert.equal(event.decision, 'review');
});

test('shaped Arabic bank labels reach Review without changing source coordinates', () => {
  const source = 'ﺷراء\nﺑطﺎﻗة:\nﻣﺑﻟﻎ:SAR46.80\nﻟدى:CEDAR BAKERY\nﻓﻲ:2026-10-09 09:15';
  assert.equal(hasGenericBankAlertContext(source), true);
  const event = inspectGenericBankEventForReview(source);
  assert.ok(event);
  assert.equal(event.merchant.value, 'CEDAR BAKERY');
  const span = event.merchant.spans[0];
  assert.equal(source.slice(span.start, span.end), 'CEDAR BAKERY');
});

for (const source of [
  'I sent you Tsh 12500 from me. Did you get it? Wallet balance is Tsh 1200.',
  'Lunch costs Tsh 500. See you at 4.',
  'A debit course costs NGN125.60. Account for every minute.',
]) test('ordinary conversation is not admitted by new receipt and field-list routing', () => {
  assert.equal(hasGenericBankAlertContext(source), false);
  assert.equal(inspectGenericBankEventForReview(source), null);
});

for (const source of [
  'Cash Out of Tsh 12500 failed. Wallet balance is Tsh 1200.',
  'Cash Out of Tsh 12500 is pending. Wallet balance is Tsh 1200.',
  'To receive Tsh 12500, enter your OTP. Wallet balance is Tsh 1200.',
]) test('new wallet routing cannot post failed, pending or authentication messages', () => {
  const session = createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'TZS', activeMarket: 'ZZ',
    bestEffort: { enabled: true, country: 'TZ' } });
  assert.equal(session.parseUnproven(source, '', session.inspect(source, '')), null);
});

const receivedAt = '2026-10-11T12:00:00Z';
function history(source, enabled = true) {
  setActiveMarket('ZZ');
  setLedgerCurrency('INR', 2);
  setActiveCountry('IN');
  const session = createLaunchAlertSession({ overrides: {}, activeMarket: 'ZZ', pinnedCurrency: 'INR',
    bestEffort: { enabled, country: 'IN' } });
  const record = JSON.stringify({ v: 1, id: createHash('sha256').update(source).digest('hex'),
    text: source, sender: 'UNLISTED-BANK', receivedAt });
  return parseHistoricalMessageRecords([record], {}, new Date('2026-10-11T12:05:00Z'), new Set(), session);
}
const statement = 'Your credit card ending 1357 statement is available. Total due INR 3280.50. Minimum due INR 180.00. Due date 2026-11-04.';
const repayment = 'Payment of INR 430.10 received for your credit card ending 1357 on 2026-10-09.';

test('history keeps unverified statement debt facts in typed Review without accepting spending', () => {
  const result = history(statement);
  assert.equal(result.acceptedCount, 0);
  assert.deepEqual(result.parsed, []);
  assert.equal(result.reviewCandidates.length, 1);
  assert.equal(result.ignoredCount, 0);
  const review = result.reviewCandidates[0];
  assert.equal(review.kind, 'universal');
  assert.equal(review.event.decision, 'review');
  assert.equal(review.event.family, 'statement');
  assert.equal(review.event.status, 'informational');
  assert.equal(review.event.amount.value, null, 'the debt total is never spending');
  assert.deepEqual(review.event.statementTotal.value, { currency: 'INR', minorUnits: '328050', exponent: 2 });
  assert.deepEqual(review.event.minimumDue.value, { currency: 'INR', minorUnits: '18000', exponent: 2 });
  assert.equal(review.event.dueDate.value, '2026-11-04');
  assert.deepEqual(review.event.instrument.value, { kind: 'card', last4: '1357' });
  for (const field of [review.event.statementTotal, review.event.minimumDue, review.event.dueDate, review.event.instrument]) {
    assert.equal(field.evidence, 'explicit');
  }
  assert.equal(review.channel, 'shortcut');
  assert.equal(Object.hasOwn(review, 'raw'), false);
  assert.equal(JSON.stringify(result).includes(statement), false);
});

test('history keeps an unverified completed repayment in typed Review without an automatic settlement', () => {
  const result = history(repayment);
  assert.equal(result.acceptedCount, 0);
  assert.deepEqual(result.parsed, []);
  assert.equal(result.reviewCandidates.length, 1);
  assert.equal(result.ignoredCount, 0);
  const review = result.reviewCandidates[0];
  assert.equal(review.kind, 'universal');
  assert.equal(review.event.decision, 'review');
  assert.equal(review.event.family, 'card-payment');
  assert.equal(review.event.status, 'posted');
  assert.equal(review.event.direction, 'credit');
  assert.deepEqual(review.event.amount.value, { currency: 'INR', minorUnits: '43010', exponent: 2 });
  assert.equal(review.event.transactionDate.value, '2026-10-09');
  assert.deepEqual(review.event.instrument.value, { kind: 'card', last4: '1357' });
  for (const field of [review.event.amount, review.event.transactionDate, review.event.instrument]) {
    assert.equal(field.evidence, 'explicit');
  }
  assert.equal(review.channel, 'shortcut');
  assert.equal(Object.hasOwn(review, 'raw'), false);
  assert.equal(JSON.stringify(result).includes(repayment), false);
});

for (const source of [statement, repayment]) test('disabled unverified import keeps native obligations out of accepted history', () => {
  assert.equal(history(source, false).acceptedCount, 0);
});

for (const source of [
  statement.replace('2026-11-04', '2026-09-04'),
  statement.replace('Total due INR 3280.50', 'Total due USD 3280.50'),
  repayment.replace('received', 'will be received'),
  repayment.replace('received', 'received, but reversed'),
  repayment.replace('ending 1357', 'starting with 864275'),
]) test('history cannot accept unresolved, foreign or non-completed native obligations', () => {
  assert.equal(history(source).acceptedCount, 0);
});

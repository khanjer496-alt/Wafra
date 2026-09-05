const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('../universal-test/load-ts.cjs');
const load = createLoader();
const { extractUniversalMoney } = load('@/lib/universal-money');
const publicCase = require('./public-cases.json').parser.find(row => row.id === 'public-au-commbank-spend');
const context = publicCase.context;

// Real official screenshot transcription, accessed 2026-09-05:
// https://www.commbank.com.au/digital-banking/transaction-notifications.html
test('public CommBank event amount wins over monthly category spend', () => {
  const result = extractUniversalMoney(publicCase.body, context);
  assert.deepEqual(result.amount.value, publicCase.expected['amount.value']);
  assert.equal(result.observations[1].field.value.minorUnits, '4000');
  assert.ok(result.observations[1].field.issues.includes('aggregate-money-field'));
  assert.doesNotMatch(publicCase.body.slice(result.transactionSpan.start, result.transactionSpan.end), /40|this month/);
});

// Synthetic mutations of the evidenced aggregate/event contrast. These test
// invariants; they are not additional real bank templates or coverage claims.
for (const aggregate of [
  "So far this month you've spent $40 on Food.",
  "This month you've spent $40 on Food.",
  'Monthly spending total $40 on Food.',
  'Month-to-date spending $40 on Food.',
  'Cumulative spending $40 on Food.',
  'Total spent $40 on Food this month.',
  'Category spending total $40 on Food.',
  'You have spent $40 on Food so far this month.',
]) {
  test(`synthetic aggregate alone is never a principal: ${aggregate}`, () => {
    const result = extractUniversalMoney(aggregate, context);
    assert.equal(result.amount.value, null);
    assert.equal(result.transactionSpan, null);
  });
  for (const reverse of [false, true]) test(`synthetic aggregate preserves event, reverse=${reverse}: ${aggregate}`, () => {
    const purchase = '$15 spend at Sandwich Co.';
    const source = reverse ? aggregate + ' ' + purchase : purchase + ' ' + aggregate;
    assert.equal(extractUniversalMoney(source, context).amount.value?.minorUnits, '1500');
  });
}
test('synthetic two actual purchases remain ambiguous despite aggregate', () => {
  const result = extractUniversalMoney('$15 spend at Sandwich Co. $20 spent at Market. Monthly spending total $40.', context);
  assert.equal(result.amount.evidence, 'ambiguous');
  assert.equal(result.amount.value, null);
  assert.deepEqual(result.amount.alternatives.map(row => row.minorUnits), ['1500', '2000']);
});
test('synthetic NEW BALANCE merchant exclusion keeps purchase', () => {
  const source = 'Purchase AUD15 at NEW BALANCE. Monthly spending total AUD40.';
  const start = source.indexOf('NEW BALANCE');
  const result = extractUniversalMoney(source, {}, [{ start, end: start + 'NEW BALANCE'.length }]);
  assert.equal(result.amount.value?.minorUnits, '1500');
  assert.equal(result.statementTotal.value, null);
});
test('synthetic ordinary monthly service fee remains a fee', () => {
  const result = extractUniversalMoney('Monthly service fee AUD5 charged.');
  assert.equal(result.amount.value?.minorUnits, '500');
  assert.equal(result.observations[0].role, 'fee');
});
for (const separator of [', ', '; ', '\n', ' ']) test(`synthetic aggregate boundary preserves purchase clause: ${JSON.stringify(separator)}`, () => {
  const source = 'AUD15 spend at Sandwich Co' + separator + "So far this month you've spent AUD40 on Food.";
  const result = extractUniversalMoney(source);
  assert.equal(result.amount.value?.minorUnits, '1500');
  assert.doesNotMatch(source.slice(result.transactionSpan.start, result.transactionSpan.end), /so far|this month|40/i);
});
test('synthetic period wording does not override an explicitly labelled purchase', () => {
  assert.equal(extractUniversalMoney('This month Purchase AUD15 at Market.').amount.value?.minorUnits, '1500');
});
test('synthetic total spent at one merchant is an event without period or category context', () => {
  const result = extractUniversalMoney('Total spent AUD 15 at Market.');
  assert.equal(result.amount.value?.minorUnits, '1500');
  assert.equal(result.observations[0].role, 'transaction');
});

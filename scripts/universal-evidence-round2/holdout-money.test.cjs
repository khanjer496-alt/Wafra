const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('../universal-test/load-ts.cjs');
const { extractUniversalMoney } = createLoader()('@/lib/universal-money');
const holdout = require('./holdout.json').parser;

// The first evaluation was frozen before this development pass. These
// formerly held-out synthetic cases are now regression data, not fresh or
// real-bank evidence. Original source and expectations remain unchanged.
for (const row of holdout) test(`exposed synthetic holdout money fields: ${row.id}`, () => {
  const result = extractUniversalMoney(row.body, row.context);
  for (const [key, value] of Object.entries(row.expected)) {
    if (!/^(?:amount|statementTotal|minimumDue|balance|creditLimit)\.value$/.test(key)) continue;
    assert.deepEqual(result[key.split('.')[0]].value, value, key);
  }
});
for (const suffix of ['05', '07', '10', '11', '14', '17', '21', '23']) test(`exposed synthetic holdout explicit movement ownership: ${suffix}`, () => {
  const row = holdout.find(row => row.id === `r2-holdout-${suffix}`);
  const result = extractUniversalMoney(row.body);
  assert.equal(result.observations[0].role, 'transaction');
  assert.ok(!result.amount.issues.includes('amount-role-unresolved'));
});
test('exposed synthetic holdout two Italian movements remain distinct', () => {
  const result = extractUniversalMoney(holdout.find(row => row.id === 'r2-holdout-12').body);
  assert.deepEqual(result.observations.map(row => row.role), ['transaction', 'transaction']);
  assert.equal(result.amount.value, null);
  assert.equal(result.amount.evidence, 'ambiguous');
});

// Derived synthetic controls do not establish further template coverage.
for (const [label, role] of [
  ['Total à payer', 'statementTotal'], ['Paiement minimum', 'minimumDue'],
  ['कुल देय राशि', 'statementTotal'], ['न्यूनतम देय राशि', 'minimumDue'],
]) {
  test(`synthetic standalone label remains informational money: ${label}`, () => {
    const result = extractUniversalMoney(`${label}: INR 35.80`);
    assert.equal(result[role].value?.minorUnits, '3580');
    assert.equal(result.amount.value, null);
    assert.equal(result.transactionSpan, null);
    assert.equal(result[role === 'minimumDue' ? 'statementTotal' : 'minimumDue'].value, null);
  });
  test(`synthetic malformed labelled amount is not repaired: ${label}`, () => {
    const result = extractUniversalMoney(`${label}: INR 35.8.0`);
    assert.equal(result[role].value, null);
    assert.equal(result.amount.value, null);
  });
  test(`synthetic three-digit grouping ambiguity retains its labelled role: ${label}`, () => {
    const result = extractUniversalMoney(`${label}: JOD 35.800`);
    assert.equal(result[role].value, null);
    assert.equal(result[role].evidence, 'ambiguous');
    assert.equal(result[role].alternatives.length, 2);
    assert.equal(result.amount.value, null);
  });
  test(`synthetic explicit seller exclusion protects label words: ${label}`, () => {
    const source = `Purchase INR35.80 at ${label}.`;
    const start = source.indexOf(label);
    const result = extractUniversalMoney(source, {}, [{ start, end: start + label.length }]);
    assert.equal(result.amount.value?.minorUnits, '3580');
    assert.equal(result[role].value, null);
  });
}
test('synthetic labels without a figure cannot invent money', () => {
  const result = extractUniversalMoney('Total à payer. Paiement minimum. कुल देय राशि। न्यूनतम देय राशि।');
  assert.equal(result.amount.value, null);
  assert.equal(result.statementTotal.value, null);
  assert.equal(result.minimumDue.value, null);
});
test('synthetic new labels require Unicode word boundaries', () => {
  for (const source of ['XXTotal à payer EUR35.80', 'éTotal à payer EUR35.80', 'XXPaiement minimum EUR35.80', 'अकुल देय राशि INR35.80', 'अन्यूनतम देय राशि INR35.80']) {
    const result = extractUniversalMoney(source);
    assert.equal(result.statementTotal.value, null);
    assert.equal(result.minimumDue.value, null);
  }
});
for (const label of ['Überweisung', 'overboeking', 'acquisto', 'cargado', 'debitados', 'रिफंड', '引き落とされました', '扣款']) test(`synthetic merchant exclusion keeps new movement label out of role discovery: ${label}`, () => {
  const source = `Merchant: ${label} USD35.80`;
  const start = source.indexOf(label);
  const result = extractUniversalMoney(source, {}, [{ start, end: start + label.length }]);
  assert.equal(result.observations[0].role, 'unknown');
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('../../universal-test/load-ts.cjs').createLoader();
const guards = load('@/lib/principal-posting-guards');

// The instrument/merchant may precede, follow or interrupt the predicate.
// Its spelling is not settlement evidence and cannot hide finite wording.
const rows = require('./credit-settlement-review-probes.json').filter(row =>
  row.incompleteExpense && (row.id.startsWith('cross-family-f406-') || row.id.startsWith('owned-descriptor-order:')));
for (const row of rows) test(`${row.id}: owned finite aspect is refused`, () => {
  const start = row.body.indexOf('AED 250.00');
  const span = { start, end: start + 'AED 250.00'.length };
  assert.equal(guards.isIncompletePrincipal(row.body, span, true), true, row.body);
  assert.equal(guards.isCompletedExpensePrincipal(row.body, span), false, row.body);
});

for (const descriptor of ['using card ending 1234', 'at NOT NOW CAFE', 'with your card ending 1234', 'from your account ending 1234']) {
  test(`affirmative descriptor remains complete: ${descriptor}`, () => {
    const body = `A purchase of AED 250.00 ${descriptor} was successfully made.`;
    const start = body.indexOf('AED 250.00');
    assert.equal(guards.isIncompletePrincipal(body, { start, end: start + 'AED 250.00'.length }, true), false);
    assert.equal(guards.isCompletedExpensePrincipal(body, { start, end: start + 'AED 250.00'.length }), true);
  });
}

test('owned transfer completion ends before its account descriptor', () => {
  const body = 'AED 5,000.00 was transferred between your accounts successfully.';
  assert.equal(guards.isIncompletePrincipal(body, { start: 0, end: 'AED 5,000.00'.length }, true), false);
  assert.equal(guards.isCompletedExpensePrincipal(body, { start: 0, end: 'AED 5,000.00'.length }), true);
});

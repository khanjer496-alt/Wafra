'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { evaluateRows, runCapturePath, grade, OBSERVED_AT } = require('../../universal-launch-eval/evaluate.cjs');

// Fictional grammar fixtures test the evaluator boundary. They do not attest
// bank coverage, transport delivery, or final ledger mutation.
const base = { country: 'IN', ledger: 'INR', sender: 'UNLISTED-BANK', provenance: 'synthetic' };
const statement = { ...base, id: 'EVAL-STATEMENT', expect: { post: false },
  body: 'Cedar Bank Credit Card XX7642 statement is available. Total of INR 3,276.50 and minimum of INR 180.25 is due by 2026-11-04.' };
const repayment = { ...base, id: 'EVAL-REPAYMENT', expect: { post: false },
  body: 'Your payment of INR 432.10 towards your Credit Card ending 7642 has been received on 11/10/2026.' };

test('History evaluator uses the real v1 importer and keeps unverified obligations in typed Review', () => {
  for (const [row, family] of [[statement, 'statement'], [repayment, 'card-payment']]) {
    const capture = runCapturePath(row, 'ios-history');
    assert.equal(capture.boundary, 'historical-import');
    assert.deepEqual(capture.accepted, []);
    assert.equal(capture.counts.invalid, 0, 'the synthetic v1 envelope is valid');
    assert.equal(capture.counts.total, 1);
    assert.equal(capture.review.length, 1);
    assert.equal(capture.review[0].family, family);
    assert.equal(capture.review[0].observedAt, OBSERVED_AT);
    assert.equal(JSON.stringify(capture).includes(row.body), false, 'no raw source escapes the importer');
    const result = evaluateRows([row], { onlyPath: 'ios-history' }).results[0];
    assert.equal(result.verdict, 'pass');
    assert.equal(result.acceptedCount, 0);
    assert.equal(result.reviewCount, 1);
    assert.deepEqual(result.reviewFamilies, [family]);
  }
});

test('senderless History uses its own acceptance policy while Android remains a labelled parser seam', () => {
  const android = runCapturePath(repayment, 'android-sms');
  assert.equal(android.boundary, 'launch-alert-session');
  assert.equal(android.accepted.length, 1, 'Android parser can propose a marked repayment');
  assert.equal(android.accepted[0].kind, 'cardPayment');
  assert.equal(grade(repayment, android.accepted[0]).verdict, 'false-post',
    'a non-posting expectation must not hide an accepted settlement');
  assert.equal(runCapturePath(repayment, 'ios-history').accepted.length, 0,
    'History holds that proposal under the shipping importer policy');
});

test('a negative expectation rejects accepted transactions, new debt, and card settlements', () => {
  const row = { ...base, expect: { post: false } };
  assert.equal(grade(row, null).verdict, 'pass');
  for (const kind of ['transaction', 'cardStatement', 'cardPayment']) {
    assert.equal(grade(row, { kind, currency: 'INR', amountFils: 43210 }).verdict, 'false-post', kind);
  }
});

test('only an exact, explicitly expected typed obligation can pass a non-spending expectation', () => {
  for (const kind of ['cardStatement', 'cardPayment']) {
    const obligation = { kind, amountMinor: 43210, currency: 'INR', card: { last4: '7642', kind: 'credit' },
      ...(kind === 'cardPayment' ? { cardPaymentSide: 'receipt' } : {}) };
    const row = { ...base, expect: { post: false, acceptedObligation: obligation } };
    const parsed = { kind, currency: 'INR', amountFils: 43210, card: obligation.card,
      ...(kind === 'cardPayment' ? { cardPaymentSide: 'receipt' } : {}) };
    assert.equal(grade(row, parsed).verdict, 'pass');
    assert.equal(grade(row, null).verdict, 'pass', 'holding an optional obligation is still safe');
    for (const wrong of [
      { ...parsed, amountFils: 12300 },
      { ...parsed, currency: 'USD' },
      { ...parsed, kind: kind === 'cardStatement' ? 'cardPayment' : 'cardStatement' },
      { ...parsed, kind: 'transaction' },
      { ...parsed, card: { last4: '1234', kind: 'credit' } },
      { ...parsed, card: { last4: '7642', kind: 'debit' } },
      ...(kind === 'cardPayment' ? [{ ...parsed, cardPaymentSide: 'debit' }] : []),
    ]) assert.equal(grade(row, wrong).verdict, 'wrong', JSON.stringify(wrong));
    assert.equal(grade({ ...row, expect: { post: false, acceptedObligation: { kind } } }, parsed).verdict, 'error',
      'a type label without exact native money must not become a blanket allowance');
    assert.equal(grade({ ...row, expect: { post: false, acceptedObligation: { kind } } }, null).verdict, 'error',
      'invalid obligation expectations cannot disappear when the parser abstains');
  }
});

test('path-specific receipt allowance never permits History to accept an unverified settlement', () => {
  const row = { ...repayment, expectByPath: {
    'android-sms': { post: false, acceptedObligation: { kind: 'cardPayment', amountMinor: 43210,
      currency: 'INR', card: { last4: '7642', kind: 'credit' }, cardPaymentSide: 'receipt' } },
    'ios-history': { post: false },
  } };
  const results = evaluateRows([row]).results;
  assert.deepEqual(results.map((result) => result.verdict), ['pass', 'pass']);
  assert.deepEqual(results.map((result) => result.acceptedCount), [1, 0]);
  assert.deepEqual(results.map((result) => result.reviewCount), [null, 1]);
});

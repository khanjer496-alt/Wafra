const assert = require('node:assert/strict');
const test = require('node:test');
const { assess, summarize, adjudicate } = require('./evaluate.cjs');
test('wrong amount is an error; a missing amount is an abstention, never a pass', () => {
  const expected = { 'amount.value': { currency: 'CAD', minorUnits: '1274', exponent: 2 } };
  assert.equal(assess(expected, { amount: { value: { currency: 'CAD', minorUnits: '9300', exponent: 2 } } })[0].outcome, 'incorrect');
  assert.equal(assess(expected, { amount: { value: null } })[0].outcome, 'abstention');
});
test('missing statuses do not silently satisfy expectations', () => {
  assert.equal(assess({ status: 'posted' }, {})[0].outcome, 'abstention');
  assert.equal(assess({ status: 'failed' }, { status: 'posted' })[0].outcome, 'incorrect');
});
test('safe abstention remains separate from exact category correctness', () => {
  assert.equal(assess({ category: 'dining' }, { category: 'other', needsReview: true })[0].outcome, 'abstention');
  assert.equal(assess({ category: 'dining' }, { category: 'shopping', needsReview: false })[0].outcome, 'incorrect');
  assert.equal(assess({ needsReview: false }, { category: 'other', needsReview: true })[0].outcome, 'abstention');
});
test('adjudications are explicit, scoped and leave the frozen original intact', () => {
  const original = { id: 'case-one', expected: { direction: 'debit', status: 'failed' }, safety: { mustNotPost: true } };
  const corrected = adjudicate(original, [{ id: 'case-one', omitExpected: ['direction'], reason: 'Attempted direction is unspecified.' }]);
  assert.deepEqual(corrected.expected, { status: 'failed' });
  assert.equal(original.expected.direction, 'debit');
  assert.equal(corrected.safety.mustNotPost, true);
  assert.deepEqual(adjudicate(original, [{ id: 'other', removeNonPostingSafety: true }]).safety, original.safety);
});
test('safety counts expose confirmation gaps even when no automatic posting occurred', () => {
  const result = summarize([{ pass: false, checks: [], safety: { posted: false, importOutcome: 'ready' } }]);
  assert.equal(result.exactCases, 0); assert.equal(result.nonPostingConfirmable, 1); assert.equal(result.falsePostedStatus, 0);
});

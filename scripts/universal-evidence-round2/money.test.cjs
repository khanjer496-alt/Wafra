const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('../universal-test/load-ts.cjs');
const { extractUniversalMoney, inspectUniversalMoneyDraft } = createLoader()('@/lib/universal-money');
const independent = require('../universal-evidence/independent-cases.json').parser;
const publicCases = require('../universal-evidence/public-cases.json').parser;

// Previously frozen synthetic-independent corpus only. These are development
// regressions, not real bank messages or the unseen round-two holdout.
for (const id of ['ind-tr-tr-purchase', 'ind-hi-in-purchase', 'ind-ja-jp-purchase', 'ind-zh-cn-purchase']) {
  test(`existing synthetic corpus amount and balance: ${id}`, () => {
    const row = independent.find(row => row.id === id);
    const result = extractUniversalMoney(row.body, row.context);
    assert.deepEqual(result.amount.value, row.expected['amount.value']);
    assert.deepEqual(result.balance.value, row.expected['balance.value']);
    assert.doesNotMatch(row.body.slice(result.transactionSpan.start, result.transactionSpan.end), /1840,25|12040\.25|85000|3020\.75/);
  });
}
for (const id of ['ind-fr-ch-refund', 'ind-de-de-subscription-paid', 'ind-es-cl-refund-zero-decimal', 'ind-nl-nl-purchase', 'ind-hi-in-refund', 'ind-zh-cn-refund']) {
  test(`existing synthetic source transaction label: ${id}`, () => {
    const row = independent.find(row => row.id === id);
    const result = extractUniversalMoney(row.body);
    assert.deepEqual(result.amount.value, row.expected['amount.value']);
    assert.equal(result.observations[0].role, 'transaction');
  });
}
for (const id of ['ind-fr-be-utility-bill', 'ind-it-it-water-bill', 'ind-hi-in-electricity']) {
  test(`existing synthetic obligation label: ${id}`, () => {
    const row = independent.find(row => row.id === id);
    const result = extractUniversalMoney(row.body);
    assert.deepEqual(result.amount.value, row.expected['amount.value']);
    assert.equal(result.observations[0].role, 'bill-due');
  });
}
test('existing synthetic Spanish statement owns total and minimum separately', () => {
  const row = independent.find(row => row.id === 'ind-es-mx-statement');
  const result = extractUniversalMoney(row.body);
  assert.deepEqual(result.statementTotal.value, row.expected['statementTotal.value']);
  assert.deepEqual(result.minimumDue.value, row.expected['minimumDue.value']);
  assert.equal(result.amount.value, null);
});
test('existing synthetic Arabic statement assigns roles without resolving three-digit ambiguity', () => {
  const row = independent.find(row => row.id === 'ind-ar-jo-statement');
  const result = extractUniversalMoney(row.body);
  for (const field of [result.statementTotal, result.minimumDue]) {
    assert.equal(field.value, null);
    assert.equal(field.evidence, 'ambiguous');
    assert.equal(field.alternatives.length, 2);
  }
  assert.deepEqual(result.statementTotal.alternatives.map(row => row.minorUnits), ['180250', '180250000']);
  assert.deepEqual(result.minimumDue.alternatives.map(row => row.minorUnits), ['10000', '10000000']);
  assert.equal(result.amount.value, null);
});
// Official indexed excerpt, accessed 2026-09-05 (direct retrieval failed):
// https://www.safaricom.co.ke/media-center-landing/terms-and-conditions/terms-and-conditions-for-safaricom-prepay-and-postpay-data-bundles?tmpl=component
test('existing public Safaricom excerpt recognizes documented KSh case variant', () => {
  const row = publicCases.find(row => row.id === 'public-ke-safaricom-bundle');
  const result = extractUniversalMoney(row.body);
  assert.deepEqual(result.amount.value, row.expected['amount.value']);
  assert.equal(row.body.slice(result.amount.spans[0].start, result.amount.spans[0].end), '250Ksh');
});

// Additional synthetic controls; no additional bank-template coverage claim.
for (const [label, currency] of [['Pago mínimo', 'MXN'], ['الحد الأدنى للسداد', 'JOD']]) {
  test(`synthetic minimum-only is never total or principal: ${label}`, () => {
    const result = extractUniversalMoney(`${label}: ${currency} 10`);
    assert.equal(result.minimumDue.value?.minorUnits, currency === 'JOD' ? '10000' : '1000');
    assert.equal(result.statementTotal.value, null);
    assert.equal(result.amount.value, null);
  });
}
test('synthetic Arabic explicit decimal separator permits exact statement facts', () => {
  const result = extractUniversalMoney('إجمالي مبلغ الكشف JOD 180٫250. الحد الأدنى للسداد JOD 10٫000.');
  assert.equal(result.statementTotal.value?.minorUnits, '180250');
  assert.equal(result.minimumDue.value?.minorUnits, '10000');
  assert.equal(result.amount.value, null);
});
for (const separator of ['。', '।']) test(`synthetic sentence separator preserves decimal and domain: ${separator}`, () => {
  const source = `Purchase USD24.50 at shop.example${separator} Available balance USD500.25${separator}`;
  const result = extractUniversalMoney(source);
  assert.equal(result.amount.value?.minorUnits, '2450');
  assert.equal(result.balance.value?.minorUnits, '50025');
  assert.match(source.slice(result.transactionSpan.start, result.transactionSpan.end), /shop\.example$/);
});
test('synthetic merchant-role exclusion protects NEW BALANCE', () => {
  const source = '利用金額 JPY2480 at NEW BALANCE。利用可能残高 JPY85000。';
  const start = source.indexOf('NEW BALANCE');
  const result = extractUniversalMoney(source, {}, [{ start, end: start + 11 }]);
  assert.equal(result.amount.value?.minorUnits, '2480');
  assert.equal(result.balance.value?.minorUnits, '85000');
  assert.equal(result.statementTotal.value, null);
});
for (const source of ['250ksh sent.', 'KSH250 sent.', '250KSh sent.']) test(`synthetic documented alias case: ${source}`, () => {
  assert.equal(extractUniversalMoney(source).amount.value?.minorUnits, '25000');
});
for (const source of ['AB250Ksh sent.', '····250Ksh sent.', 'Ksh250.2.3 sent.', '250Kshell sent.']) test(`synthetic alias cannot recover malformed or identifier money: ${source}`, () => {
  assert.equal(extractUniversalMoney(source).amount.value, null);
});
test('synthetic ambiguous dollar and malformed ISO money stay unresolved', () => {
  assert.equal(extractUniversalMoney('भुगतान $25.50।').amount.evidence, 'ambiguous');
  assert.equal(extractUniversalMoney('利用金額 USD25.2.3。').amount.value, null);
});
test('synthetic aggregate exclusion retains actual merchant total', () => {
  assert.equal(extractUniversalMoney('Total spent AUD15 at Market. Monthly spending total AUD40.').amount.value?.minorUnits, '1500');
  assert.equal(extractUniversalMoney('Monthly spending total AUD40.').amount.value, null);
});
test('synthetic explicit instrument/reference exclusions still remove overlapping money', () => {
  const source = 'Reference JPY1234。利用金額 JPY2480。';
  const start = source.indexOf('JPY1234');
  const result = extractUniversalMoney(source, {}, [], [{ start, end: start + 7 }]);
  assert.equal(result.amount.value?.minorUnits, '2480');
  assert.equal(result.observations.length, 1);
});
test('existing synthetic Japanese renewal retains the amount before evidenced particle で', () => {
  const row = independent.find(row => row.id === 'ind-ja-jp-renewal');
  const result = extractUniversalMoney(row.body);
  assert.deepEqual(result.amount.value, row.expected['amount.value']);
  const span = result.amount.spans[0];
  assert.equal(row.body.slice(span.start, span.end), 'JPY 780');
  assert.equal(result.draft.normalizedText, row.body);
});
for (const token of ['JPY780', 'JPY ７８０', 'USD24.50', 'JOD1٫234']) test(`synthetic exact ISO token before particle: ${token}`, () => {
  const source = `更新予定：${token}で更新予定です。`;
  const result = extractUniversalMoney(source);
  assert.ok(result.amount.value);
  const span = result.amount.spans[0];
  assert.equal(source.slice(span.start, span.end), token);
});
for (const token of ['ABJPY780', '_JPY780', 'éJPY780', 'JPY780.2.3', 'JPY1/780', 'JPY····780', 'JPY1,23', 'JPY780foo', 'ZZZ780']) test(`synthetic particle recovery refuses embedded or malformed tokens: ${token}`, () => {
  assert.equal(extractUniversalMoney(`${token}で更新予定です。`).amount.value, null);
});
test('synthetic particle recovery retains all conflicting exact values', () => {
  const result = extractUniversalMoney('JPY780で更新予定です。JPY980で更新予定です。');
  assert.equal(result.amount.value, null);
  assert.equal(result.amount.evidence, 'ambiguous');
  assert.equal(result.amount.alternatives.length, 2);
});
test('synthetic shared draft keeps source coordinates and explicit reference exclusion', () => {
  const source = 'Reference JPY1234で確認。JPY780で更新予定です。';
  const draft = inspectUniversalMoneyDraft(source);
  assert.equal(draft.normalizedText, source);
  assert.deepEqual(draft.candidates.map(row => source.slice(row.span.start, row.span.end)), ['JPY1234', 'JPY780']);
  const reference = draft.candidates[0].span;
  assert.equal(extractUniversalMoney(source, {}, [], [reference]).amount.value?.minorUnits, '780');
});
test('synthetic particle recovery preserves authentication refusal', () => {
  const source = 'OTP required for JPY780で更新予定です。';
  const result = extractUniversalMoney(source);
  assert.ok(result.draft.reasons.includes('authentication-or-otp'));
  assert.equal(result.amount.value, null);
});
test('synthetic particle recovery preserves three-digit ambiguity', () => {
  const result = extractUniversalMoney('JOD1.234で更新予定です。');
  assert.equal(result.amount.value, null);
  assert.equal(result.amount.evidence, 'ambiguous');
  assert.equal(result.amount.alternatives.length, 2);
});

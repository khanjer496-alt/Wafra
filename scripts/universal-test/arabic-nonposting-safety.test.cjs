'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./load-ts.cjs');
const load = createLoader();
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const { inspectGenericBankEventForReview } = load('@/lib/launch-alert-parser');
const { createLocalParserFamilyAdvisory } = load('@/lib/local-semantic-model');
async function advisoryCalls(event) {
  let calls = 0;
  await createLocalParserFamilyAdvisory({ event, semanticText: 'synthetic movement <money>', sensitiveSpans: [],
    retriever: { retrieve: async () => { calls++; return null; } } });
  return calls;
}
test('explicit Arabic rejected cash withdrawal never becomes a posted advisory candidate', async () => {
  const text = 'تم رفض السحب النقدي بمبلغ SAR ٢٠٠ ولم يتم خصم أي مبلغ من حسابك.';
  const event = inspectUniversalBankEvent(text, { sender: 'UNLISTED-BANK' });
  assert.equal(event.status, 'failed');
  assert.equal(event.decision, 'ignore');
  assert.ok(event.issues.includes('failed-not-posting'));
  assert.equal(inspectGenericBankEventForReview(text, 'UNLISTED-BANK'), null);
  assert.equal(await advisoryCalls(event), 0);
});
test('Arabic account-balance label assigns money to balance, not transaction principal', async () => {
  const text = 'رصيد حسابك الحالي KWD ٣٤٥٫٦٧٨. لا توجد عمليات جديدة.';
  const event = inspectUniversalBankEvent(text, { sender: 'UNLISTED-BANK' });
  assert.equal(event.family, 'balance');
  assert.equal(event.status, 'informational');
  assert.equal(event.amount.evidence, 'missing');
  assert.equal(event.balance.value.minorUnits, '345678');
  assert.equal(event.balance.value.currency, 'KWD');
  assert.equal(await advisoryCalls(event), 0);
});
test('legitimate Arabic posted withdrawal retains its debit and amount', () => {
  const event = inspectGenericBankEventForReview('تم السحب النقدي بنجاح وخصم SAR ٥٠٠ من الحساب.', 'UNLISTED-BANK');
  assert.ok(event);
  assert.equal(event.status, 'posted');
  assert.equal(event.direction, 'debit');
  assert.equal(event.amount.value.minorUnits, '50000');
  assert.equal(event.amount.value.currency, 'SAR');
});
test('Arabic account balance after a mixed-language purchase stays a separate observation', () => {
  const event = inspectGenericBankEventForReview('Purchase posted: AED 84.60 at Cedar Lantern Books. رصيد حسابك الحالي AED 2,430.15.', 'UNLISTED-BANK');
  assert.ok(event);
  assert.equal(event.family, 'purchase');
  assert.equal(event.status, 'posted');
  assert.equal(event.direction, 'debit');
  assert.equal(event.amount.value.minorUnits, '8460');
  assert.equal(event.balance.value.minorUnits, '243015');
});
test('conditional Arabic withdrawal-rejection advice does not cancel a posted purchase', () => {
  const event = inspectGenericBankEventForReview('Card purchase posted: AED 84.60 at Cedar Lantern Books. إذا تم رفض السحب النقدي اتصل بالمصرف.', 'UNLISTED-BANK');
  assert.ok(event);
  assert.equal(event.status, 'posted');
  assert.equal(event.family, 'purchase');
  assert.equal(event.amount.value.minorUnits, '8460');
});

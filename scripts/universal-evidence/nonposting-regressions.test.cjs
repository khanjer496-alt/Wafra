const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('../universal-test/load-ts.cjs');
const load = createLoader();
const inspect = load('@/lib/universal-parser').inspectUniversalBankEvent;
const plan = load('@/lib/universal-import').planConfirmedUniversalImport;
const fixtures = [...require('./public-cases.json').parser, ...require('./independent-cases.json').parser]
  .filter((item) => item.safety?.mustNotPost && item.id !== 'ind-en-ambiguous-dollar');
for (const item of fixtures) test('explicit non-posting source retains its status: ' + item.id, () => {
  const event = inspect(item.body, item.context);
  assert.equal(event.status, item.expected.status);
  const instrument = event.instrument.value;
  const result = plan({ hydrated: true, accounts: [{ id: 'account', kind: instrument?.kind === 'card' ? 'card' : 'bank',
    last4: instrument?.last4, openingFils: 0 }], transactions: [], ledgerMoney: null }, event,
  { confirmed: true, postingStatus: 'posted', amount: event.amount.value ?? event.amount.alternatives[0],
    direction: 'debit', accountId: 'account', title: 'Reviewed source', category: 'other', date: '2026-09-05',
    sourceKey: 'regression_source_123456789', observedAt: 1788602400000 });
  assert.equal(result.outcome, 'refused');
});

// Synthetic contrast cases: status words in sellers/conditional help text are
// not an actual decline, bill obligation, or authorization challenge.
for (const body of [
  'Card purchase USD 12.50 at DECLINED CAFE on 2026-09-05.',
  'Card purchase USD 12.50 at PASSWORD BOOKSHOP on 2026-09-05. Never share your password.',
  'Card purchase USD 12.50 at ABGELEHNT CAFE on 2026-09-05.',
  'Card purchase USD 12.50 at SUBSCRIPTION CAFE on 2026-09-05.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. If your payment was declined, contact support.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. Your next subscription will renew on 2026-10-05.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. Never share your OTP.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. Never use password: 123456.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. If your password: 123456 was shared, call support.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. Wenn Ihre Kartenzahlung abgelehnt wird, kontaktieren Sie uns.',
]) test('posted purchase survives unrelated seller/footer: ' + body, () => {
  const event = inspect(body);
  assert.equal(event.status, 'posted');
  assert.equal(event.amount.value?.minorUnits, '1250');
});

for (const body of [
  'Kartenzahlung über EUR 120.00 bei BERGTAL FAHRRADLADEN abgelehnt. Ihr Konto wurde nicht belastet.',
  'Payment declined. Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05.',
  'Card purchase USD 12.50 at LOCAL CAFE on 2026-09-05. Payment declined. No money debited.',
]) test('direct decline retains authority across decimal and sentence boundaries: ' + body, () => {
  const event = inspect(body);
  assert.equal(event.status, 'failed');
  assert.equal(event.decision, 'ignore');
});

for (const body of [
  'Bank notice CAD 12.50.',
  'TRX USD 12.50 reference 12345.',
  'Bank notice USD 12.50. If your subscription will renew automatically, contact support.',
]) test('unfamiliar status is never upgraded to posted: ' + body, () => {
  assert.equal(inspect(body).status, 'unknown');
});

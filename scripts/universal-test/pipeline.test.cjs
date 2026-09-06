const assert = require('node:assert/strict');
const test = require('node:test');
const { createLoader } = require('./load-ts.cjs');
const load = createLoader();
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const { planConfirmedUniversalImport } = load('@/lib/universal-import');
const { materializeImportBatch, applyMaterializedImportBatch } = load('@/lib/ledger-import');
const base = () => ({
  hydrated: true, marketId: 'AE', ledgerMoney: null,
  accounts: [{ id: 'card', name: 'My card', kind: 'card', cardType: 'credit', last4: '1234', openingFils: 0, color: '#111' }],
  transactions: [], budgets: [], bills: [], cardDues: [], goals: [], accountHints: {},
  merchantOverrides: {}, lastScanTs: 0, parserVersion: 0,
});
const confirm = (event, extra = {}) => ({
  confirmed: true, postingStatus: 'posted', amount: event.amount.value,
  direction: 'debit', accountId: 'card', title: event.merchant.value ?? 'Reviewed payment',
  category: 'other', date: event.transactionDate.value ?? '2026-09-05',
  sourceKey: 'android_message_review_source_a123', observedAt: Date.parse('2026-09-05T10:00:00Z'),
  ...extra,
});

for (const [currency, literal, minor] of [
  ['AED', '24.90', 2490], ['SAR', '24.90', 2490], ['CAD', '24.90', 2490],
  ['JPY', '2400', 2400], ['KWD', '12٫345', 12345],
]) {
  test(currency + ': text to confirmed ledger to reload retains exact money and source identity', () => {
    const source = `Card purchase ${currency} ${literal} at LOCAL CAFE with card ending 1234 on 2026-09-05.`;
    const event = inspectUniversalBankEvent(source, { sender: 'UNLISTED-BANK' });
    assert.equal(event.decision, 'review');
    const state = base(), input = confirm(event);
    const before = JSON.stringify(state);
    const plan = planConfirmedUniversalImport(state, event, input);
    assert.equal(plan.outcome, 'ready');
    let id = 0;
    const committed = applyMaterializedImportBatch(state, materializeImportBatch(plan.batch, state, () => `test-${id++}`));
    assert.equal(committed.transactions.length, 1);
    assert.equal(committed.transactions[0].amountFils, minor);
    assert.equal(committed.ledgerMoney.currency, currency);
    assert.equal(committed.transactions[0].title, 'LOCAL CAFE');
    assert.equal(committed.transactions[0].raw, undefined);
    assert.equal(committed.transactions[0].smsKey, `ha123t${input.observedAt}`);
    assert.equal(JSON.stringify(state), before);
    const restored = JSON.parse(JSON.stringify(committed));
    assert.equal(planConfirmedUniversalImport(restored, event, { ...input, sourceKey: 'ha123' }).outcome, 'duplicate');
    const reused = { ...input, sourceKey: 'ha123', observedAt: input.observedAt + 86400000 };
    assert.equal(planConfirmedUniversalImport(restored, event, reused).outcome, 'ready');
    assert.equal(restored.transactions[0].smsKey, `ha123t${input.observedAt}`);
  });
}

for (const source of [
  'Card purchase AED 24.90 at LOCAL CAFE was declined.',
  'Your card will be charged SAR 24.90 at LOCAL CAFE on 2026-09-05.',
  'Card purchase USD 24.90 at LOCAL CAFE requires OTP123456.',
  'Card purchase USD 24.90 at LOCAL CAFE is pending authorization.',
  'Credit card statement. Minimum due USD 25.00. Due date 2026-09-25.',
  'Available balance CAD 100.00.',
  'Payment of USD 500.00 received towards your Credit Card ending 1234 on 2026-09-05.',
  'Credit card statement. Last payment USD 500.00 received on 2026-09-01. Minimum due USD 25.00.',
  'Your transaction was declined. CAD 24.90.',
  'Notice CAD 24.90. Transaction failed.',
  'Scheduled payment. CAD 24.90.',
  'Available balance\nCAD 500.00',
  'Credit limit notice. CAD 1000.00.',
]) {
  test('non-posting/obligation source cannot cross confirmed ordinary-transaction adapter', () => {
    const event = inspectUniversalBankEvent(source);
    assert.equal(planConfirmedUniversalImport(base(), event, confirm(event)).outcome, 'refused');
  });
}

test('ambiguous currency requires a selected source alternative through the real pipeline', () => {
  const event = inspectUniversalBankEvent('Card purchase $ 24.90 at LOCAL CAFE on 2026-09-05.');
  assert.equal(event.amount.value, null);
  assert.equal(planConfirmedUniversalImport(base(), event, confirm(event)).outcome, 'refused');
  const selected = event.amount.alternatives.find((amount) => amount.currency === 'CAD');
  assert.ok(selected);
  assert.equal(planConfirmedUniversalImport(base(), event, confirm(event, { amount: selected })).outcome, 'ready');
});

test('unknown-format exact money enters only after explicit user posting and field confirmation', () => {
  const event = inspectUniversalBankEvent('Bank notice: SAR 24.90. Details need confirmation.');
  assert.equal(event.status, 'unknown');
  assert.equal(event.direction, 'unknown');
  assert.equal(event.merchant.value, null);
  const input = confirm(event);
  assert.equal(planConfirmedUniversalImport(base(), event, { ...input, confirmed: false }).outcome, 'refused');
  assert.equal(planConfirmedUniversalImport(base(), event, { ...input, postingStatus: 'unknown' }).outcome, 'refused');
  assert.equal(planConfirmedUniversalImport(base(), event, { ...input, title: '' }).outcome, 'refused');
  assert.equal(planConfirmedUniversalImport(base(), event, input).outcome, 'ready');
});

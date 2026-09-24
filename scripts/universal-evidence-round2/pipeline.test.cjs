const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('../universal-test/load-ts.cjs').createLoader();
const inspect = load('@/lib/universal-parser').inspectUniversalBankEvent;
const suggest = load('@/lib/universal-categorization').suggestUniversalCategory;
const plan = load('@/lib/universal-import').planConfirmedUniversalImport;
const { materializeImportBatch, applyMaterializedImportBatch } = load('@/lib/ledger-import');
const { ledgerMoneySpec } = load('@/lib/ledger-money');
const corpus = require('../universal-evidence/independent-cases.json').parser;
const base = (currency, instrument) => ({ hydrated: true, marketId: 'AE', ledgerMoney: ledgerMoneySpec(currency),
  accounts: [{ id: 'account', kind: instrument?.kind === 'card' ? 'card' : 'bank', name: 'Confirmed account',
    last4: instrument?.last4 ?? undefined, openingFils: 0, color: '#111' }],
  transactions: [], budgets: [], bills: [], cardDues: [], goals: [], accountHints: {}, merchantOverrides: {}, lastScanTs: 0, parserVersion: 0 });

for (const item of corpus.filter((item) => item.expected.status === 'posted' && item.expected['amount.value'])) {
  test('reviewed source to ledger preserves money and category: ' + item.id, () => {
    const event = inspect(item.body);
    // Explicitly ambiguous money needs its own user selection; this set tests
    // exact source money only. A separate test verifies ambiguous refusal.
    if (item.id === 'ind-ar-kw-three-decimal') {
      assert.equal(event.amount.value, null); assert.equal(event.amount.evidence, 'ambiguous'); return;
    }
    assert.deepEqual(event.amount.value, item.expected['amount.value']);
    assert.ok(['debit', 'credit'].includes(event.direction));
    const state = base(event.amount.value.currency, event.instrument.value);
    const category = suggest(event);
    const confirmation = { confirmed: true, postingStatus: 'posted', amount: event.amount.value, direction: event.direction,
      accountId: 'account', title: event.merchant.value || 'User supplied seller', category: category.category,
      date: event.transactionDate.value || '2026-08-20', sourceKey: 'round2_review_source_' + item.id,
      observedAt: 1788602400000 };
    // Date/seller fallbacks above are explicit simulated USER entries. This
    // test does not claim they were extracted or that import is automatic.
    const proposal = plan(state, event, confirmation);
    assert.equal(proposal.outcome, 'ready');
    let id = 0;
    const committed = applyMaterializedImportBatch(state, materializeImportBatch(proposal.batch, state, (prefix) => `${prefix}-${++id}`));
    const restored = JSON.parse(JSON.stringify(committed));
    assert.equal(restored.transactions.length, 1);
    assert.equal(restored.transactions[0].amountFils, Number(event.amount.value.minorUnits));
    assert.equal(restored.transactions[0].category, category.category);
    assert.equal(restored.transactions[0].raw, undefined);
    assert.equal(restored.ledgerMoney.currency, event.amount.value.currency);
    assert.equal(plan(restored, event, confirmation).outcome, 'duplicate');
  });
}
test('a French purchase cannot silently enter a USD ledger as dollars', () => {
  const event = inspect(corpus.find((item) => item.id === 'ind-fr-fr-purchase').body);
  const result = plan(base('USD', event.instrument.value), event, { confirmed: true, postingStatus: 'posted',
    amount: event.amount.value, direction: 'debit', accountId: 'account', title: event.merchant.value,
    category: 'dining', date: '2026-08-19', sourceKey: 'round2_currency_mismatch', observedAt: 1788602400000 });
  // Without a dated EUR->USD rate nothing posts; the review stays pending.
  assert.equal(result.outcome, 'refused'); assert.equal(result.reason, 'fx-rate-unavailable');
  // With one, the purchase is converted, never relabelled: the USD amount is
  // the EUR amount at the recorded rate, and EUR stays on the row.
  const converted = plan(base('USD', event.instrument.value), event, { confirmed: true, postingStatus: 'posted',
    amount: event.amount.value, direction: 'debit', accountId: 'account', title: event.merchant.value,
    category: 'dining', date: '2026-08-19', sourceKey: 'round2_currency_mismatch', observedAt: 1788602400000 },
  { base: event.amount.value.currency, quote: 'USD', rate: 1.1, date: '2026-08-19' });
  assert.equal(converted.outcome, 'ready');
  const row = converted.batch.transactions[0];
  assert.equal(converted.batch.importMoney.currency, 'USD');
  assert.equal(row.originalCurrency, event.amount.value.currency);
  assert.equal(row.originalMinorUnits, Number(event.amount.value.minorUnits));
  assert.equal(row.amountFils, Math.round(Number(event.amount.value.minorUnits) * 1.1));
  assert.equal(row.fxSource, 'reference'); assert.equal(row.fxRateDate, '2026-08-19'); assert.equal(row.fxRate, 1.1);
});
test('ambiguous three-decimal money cannot be submitted without selecting a source interpretation', () => {
  const event = inspect(corpus.find((item) => item.id === 'ind-ar-kw-three-decimal').body);
  const result = plan(base('KWD', event.instrument.value), event, { confirmed: true, postingStatus: 'posted',
    amount: event.amount.value, direction: 'debit', accountId: 'account', title: event.merchant.value,
    category: 'dining', date: '2026-08-17', sourceKey: 'round2_money_ambiguity', observedAt: 1788602400000 });
  assert.equal(result.outcome, 'refused');
});

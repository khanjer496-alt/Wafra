const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('../universal-test/load-ts.cjs').createLoader();
const inspect = load('@/lib/universal-parser').inspectUniversalBankEvent;
const categorize = load('@/lib/universal-categorization').categorizeMerchant;
const plan = load('@/lib/universal-import').planConfirmedUniversalImport;
const { adjudicate } = require('../universal-evidence/evaluate.cjs');
const rules = require('./adjudications.json');
const corpus = require('./holdout.json');
// First-run holdout outputs are immutable. These are development regressions
// after exposure, using the documented independent author's oracle review.
for (const original of corpus.parser) {
  const item = adjudicate(original, rules);
  test('exposed source semantics: ' + item.id, () => {
    const event = inspect(item.body);
    assert.equal(event.status, item.expected.status);
    if (item.expected.direction) assert.equal(event.direction, item.expected.direction);
    if (item.safety?.mustNotPost) {
      const result = plan({ hydrated: true, ledgerMoney: null, transactions: [], accounts: [{ id: 'a', kind: 'bank', openingFils: 0 }] }, event,
        { confirmed: true, postingStatus: 'posted', amount: event.amount.value ?? event.amount.alternatives[0], direction: 'debit',
          accountId: 'a', category: 'other', title: 'Explicit user choice', date: '2026-09-05',
          sourceKey: 'exposed_source_' + item.id, observedAt: 1788602400000 });
      assert.equal(result.outcome, 'refused');
    }
  });
}
for (const original of corpus.categorization) {
  const item = adjudicate(original, rules);
  test('exposed category semantics: ' + item.id, () => {
    const actual = categorize(item.input);
    assert.equal(actual.category, item.expected.category);
    assert.equal(actual.needsReview, item.expected.needsReview);
  });
}
for (const body of [
  'Remboursement de EUR 27,64 jamais reçu de Atelier Brume.',
  'नीलकमल पुस्तकालय से INR 249.36 का रिफंड आपके खाते में जमा हो गया है?',
  '您在青藤纸屋的消费已完成吗，金额CNY 63.82。',
  'هل تم خصم SAR 76.38 من حسابك؟',
  'Nar Çiçeği Kırtasiye işyerindeki TRY 184,72 tutarındaki alışveriş tamamlandı mı?',
  'Factura de agua de Arroyo Violeta no pagada. Importe EUR 31,76.',
  'Mensalidade da Trilha Sonora Azul não paga: BRL 37,26.',
  'Factura de agua de Arroyo Violeta será pagada: EUR 31,76.',
  'Mensalidade da Trilha Sonora Azul será paga: BRL 37,26.',
]) test('exposed predicate contrasts remain non-posting: ' + body, () => {
  assert.ok(['failed', 'informational', 'future'].includes(inspect(body).status));
});
test('two principal movements require splitting even without a summary sentence', () => {
  const event = inspect('Acquisto completato di EUR 12,83 presso Caffè Rugiada; rimborso accreditato di EUR 6,47 da Officina Corallo.');
  assert.equal(event.status, 'informational');
  assert.equal(event.amount.value, null);
  assert.equal(event.amount.alternatives.length, 2);
  for (const amount of event.amount.alternatives) {
    const result = plan({ hydrated: true, ledgerMoney: null, transactions: [], accounts: [{ id: 'a', kind: 'bank', openingFils: 0 }] }, event,
      { confirmed: true, postingStatus: 'posted', amount, direction: 'credit', accountId: 'a', category: 'other',
        title: 'User confirmation', date: '2026-09-05', sourceKey: 'multiple_movement_source', observedAt: 1788602400000 });
    assert.equal(result.outcome, 'refused');
  }
});
test('multiple-transaction words in a merchant name are not multiple events', () => {
  const event = inspect('Purchase USD 12 at TWO DISTINCT TRANSACTIONS CAFE.');
  assert.equal(event.status, 'posted');
  assert.equal(event.amount.value.minorUnits, '1200');
});
test('single-candidate currency interpretations are not multiple principal movements', () => {
  const event = inspect('Card purchase $12.50 at LOCAL CAFE.');
  assert.equal(event.status, 'posted');
  assert.equal(event.amount.evidence, 'ambiguous');
});

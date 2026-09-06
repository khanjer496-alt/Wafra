const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('./load-ts.cjs').createLoader();
const { categorizeMerchant: categorize, suggestUniversalCategory } = load('@/lib/universal-categorization');
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const expense = (merchant, extra = {}) => categorize({ merchant, type: 'expense', ...extra });

// Existing corpus names plus labelled cross-template safety controls. No new
// merchant business type is inferred from a processor or bank product name.
for (const market of ['AE', 'SA']) {
  for (const [merchant, expected] of [
    ['LULU EXCHANGE', 'other'], ['DANUBE HOME', 'shopping'], ['STC PAY', 'other'],
    ['Mark & Save', 'groceries'], ['MARK AND SAVE', 'groceries'],
    ['FIVERR GENERAL TRADING', 'shopping'], ['ADOBE INTERIOR DECOR LLC', 'other'],
    ['AL SAAD FURNITURE EST', 'shopping'], ['CARREFOUR', 'groceries'],
    ['NETFLIX', 'entertainment'], ['DEWA', 'utilities'],
  ]) {
    test(`${market}: ${merchant} follows merchant evidence`, () => {
      assert.equal(expense(merchant, { market }).category, expected);
    });
  }
}

for (const merchant of ['PAYPAL *CXIANGHUI01L', 'PAYPAL *FARHANAUSMA', 'PAYPAL', 'STRIPE', '2C2P', 'ZIINA']) {
  test('processor does not prove Shopping: ' + merchant, () => {
    const result = expense(merchant);
    assert.equal(result.category, 'other');
    assert.equal(result.needsReview, true);
  });
}
test('processor plus a known seller retains the seller category', () => {
  const result = expense('PAYPAL *NETFLIX');
  assert.equal(result.category, 'entertainment');
  assert.equal(result.merchant, 'Netflix');
});
test('canonical merchant output is stable under reclassification', () => {
  const first = expense('MARK AND SAVE');
  const second = expense(first.merchant);
  assert.equal(first.category, 'groceries');
  assert.equal(second.category, first.category);
  assert.equal(second.merchant, first.merchant);
});
for (const merchant of ['SALARY SHOP', 'Payroll Software', 'AHMED VIA WISE PAYMENTS LTD']) {
  test('a payer name does not prove earned income: ' + merchant, () => {
    const result = categorize({ merchant, type: 'income' });
    assert.equal(result.category, 'other');
    assert.equal(result.needsReview, true);
  });
}
for (const [meaning, type, category] of [
  ['refund', 'income', 'other'], ['own-transfer', 'expense', 'other'],
  ['card-payment', 'income', 'other'], ['cash-withdrawal', 'expense', 'cash-withdrawal'],
  ['fee', 'expense', 'other'], ['salary', 'income', 'salary'], ['business-income', 'income', 'business'],
]) {
  test('explicit financial meaning wins over incidental seller vocabulary: ' + meaning, () => {
    const result = categorize({ merchant: 'Payroll Software Restaurant', type, meaning });
    assert.equal(result.category, category);
    assert.equal(result.source, 'movement');
  });
}
test('explicit refund cannot inherit a payer-wide Salary rule', () => {
  assert.equal(categorize({ merchant: 'ACME', type: 'income', meaning: 'refund', overrides: { acme: 'salary' } }).category, 'other');
});
test('a deliberate per-transaction category remains the user answer', () => {
  const result = categorize({ merchant: 'ACME', type: 'income', meaning: 'refund', manualCategory: 'business' });
  assert.equal(result.category, 'business');
  assert.equal(result.source, 'manual');
});
test('valid merchant rules beat automatic merchant activity and aliases', () => {
  const result = expense('  Carrefour  ', { overrides: { carrefour: 'shopping' } });
  assert.equal(result.category, 'shopping');
  assert.equal(result.source, 'merchant-rule');
});
test('Other can be a deliberate income rule', () => {
  assert.equal(categorize({ merchant: 'ACME', type: 'income', overrides: { 'income:acme': 'other' } }).source, 'merchant-rule');
});
test('a legacy Other rule does not silently widen to income', () => {
  assert.equal(categorize({ merchant: 'ACME', type: 'income', overrides: { acme: 'other' } }).source, 'unresolved');
});
test('directional rules can retain separate income and expense decisions', () => {
  const rules = [{ merchant: 'ACME', type: 'income', category: 'salary' }, { merchant: 'ACME', type: 'expense', category: 'shopping' }];
  assert.equal(categorize({ merchant: 'ACME', type: 'income', rules }).category, 'salary');
  assert.equal(expense('ACME', { rules }).category, 'shopping');
});
test('conflicting same-direction rules remain unresolved', () => {
  const result = expense('ACME', { rules: [
    { merchant: 'ACME', type: 'expense', category: 'dining' },
    { merchant: 'ACME', type: 'expense', category: 'shopping' },
  ] });
  assert.equal(result.category, 'other');
  assert.equal(result.reason, 'conflicting-merchant-rules');
});
test('invalid or direction-incompatible category cannot be accepted as a rule', () => {
  assert.equal(expense('CARREFOUR', { overrides: { carrefour: 'invented' } }).category, 'groceries');
  assert.equal(expense('CARREFOUR', { overrides: { carrefour: 'salary' } }).category, 'groceries');
});
test('classification is based on extracted seller, not card product branding', () => {
  const event = inspectUniversalBankEvent('Your Etisalat Credit Card ending 1234 was charged AED 100.00 at AL SAAD FURNITURE EST on 2026-09-05.');
  assert.equal(suggestUniversalCategory(event, { market: 'AE' }).category, 'shopping');
});
test('unresolved direction cannot invent an expense category suggestion', () => {
  const event = inspectUniversalBankEvent('Bank notice CAD 24.90. Details need confirmation.');
  assert.equal(suggestUniversalCategory(event).reason, 'direction-unresolved');
});
for (const [merchant, category] of [
  ['WASHMEN LAUNDRY', 'home-services'], ['LULU EXCHANGE LLC', 'other'],
  ['LULU EXCHANGE, DUBAI', 'other'], ['STC PAY WALLET', 'other'],
  ['LINKEDIN MARKETING FZE', 'other'],
]) {
  test('existing protected descriptor remains correct: ' + merchant, () => {
    assert.equal(expense(merchant, { market: 'SA' }).category, category);
  });
}
test('canonicalization cannot erase the category evidence in a Lime ride', () => {
  const first = expense('LIME*RIDE COST');
  assert.equal(first.category, 'transport');
  assert.equal(expense(first.merchant).category, 'transport');
});
test('cleanup depth exhaustion cannot restore a processor-based Shopping guess', () => {
  assert.equal(expense('PAYPAL*PAYPAL*PAYPAL*PAYPAL*FARHANAUSMA').category, 'other');
});
// Synthetic descriptions of explicit activities, not new institution evidence.
for (const [merchant, category] of [
  ['PHARMACIE CENTRALE', 'health'], ['APOTHEKE AM MARKT', 'health'],
  ['RESTAURANTE CASA SOL', 'dining'], ['RISTORANTE ROMA', 'dining'],
  ['BAKKERIJ DE HOEK', 'dining'], ['FARMÁCIA CENTRAL', 'health'],
  ['सुपरमार्केट', 'groceries'], ['東京薬局', 'health'], ['上海餐厅', 'dining'],
]) {
  test('global activity vocabulary: ' + merchant, () => {
    assert.equal(expense(merchant, { market: 'GLOBAL' }).category, category);
  });
}
test('a non-Gulf context never inherits the active Saudi merchant keywords', () => {
  const markets = load('@/lib/markets');
  const prior = markets.getActiveMarket().id;
  try {
    markets.setActiveMarket('SA');
    assert.equal(expense('PANDA', { market: 'CA' }).category, 'other');
    assert.equal(expense('PANDA').category, 'other');
    assert.equal(expense('PANDA', { market: 'SA' }).category, 'groceries');
  } finally { markets.setActiveMarket(prior); }
});
test('the French word du is not automatically the UAE phone company', () => {
  assert.equal(expense('DU PAIN', { market: 'FR' }).category, 'other');
});
test('an accidental whole notification cannot decide a merchant category', () => {
  const result = expense('Your Etisalat Card ending 1234 was charged AED 100 at AL SAAD FURNITURE EST.');
  assert.equal(result.category, 'other');
  assert.equal(result.needsReview, true);
});
for (const merchant of ['FIVERR', 'PAYPAL *FIVERR', 'FIVERR.COM', 'PAYPAL *FIVERR.COM', 'KLARNA', 'TABBY', 'TABBY.AI', 'TAMARA', 'TAMARA.COM']) {
  test('opaque service/payment platform does not prove the purchased category: ' + merchant, () => {
    const result = expense(merchant);
    assert.equal(result.category, 'other');
    assert.equal(result.needsReview, true);
  });
}
test('a user can deliberately classify their own Fiverr activity', () => {
  const result = expense('FIVERR', { overrides: { 'expense:fiverr': 'software' } });
  assert.equal(result.category, 'software');
  assert.equal(result.source, 'merchant-rule');
});
test('casefolding cannot turn a whole notification into merchant evidence', () => {
  const result = expense('your etisalat card ending 1234 was charged aed 100 at mystery store.');
  assert.equal(result.category, 'other');
  assert.equal(result.needsReview, true);
  assert.equal(result.merchant, '');
});

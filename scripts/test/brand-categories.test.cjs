// Curated brand table (src/lib/brand-categories.ts) and its fallback hook in
// universal-categorization.ts. Run: node scripts/test/brand-categories.test.cjs
const assert = require('node:assert/strict');
const test = require('node:test');
const load = require('../universal-test/load-ts.cjs').createLoader();
const brands = load('@/lib/brand-categories');
const { categorizeMerchant } = load('@/lib/universal-categorization');
const { CATEGORIES } = load('@/lib/categories');
const { MERCHANTS } = require('../parser-ai/category/merchants.cjs');
const { DESCRIPTORS } = require('../parser-ai/category/brand-test-descriptors.cjs');

const { matchBrandCategory, compileBrandTable, normalizeBrandDescriptor } = brands;
const expense = (merchant, market, extra = {}) => categorizeMerchant({ merchant, type: 'expense', meaning: 'purchase', market, ...extra });
const corpus = [...MERCHANTS.map((m) => m.descriptor), ...DESCRIPTORS.map((d) => d.descriptor)];

test('every table row compiles to an existing expense category', () => {
  const ids = new Set(CATEGORIES.filter((c) => c.type === 'expense').map((c) => c.id));
  const rows = compileBrandTable();
  assert.ok(rows.length > 1000);
  for (const row of rows) assert.ok(ids.has(row.category), `${row.table} ${row.pattern} -> ${row.category}`);
  assert.equal(new Set(rows.filter((r) => r.table !== 'GLOBAL').map((r) => r.table)).size, 30);
});

test('an ungated pattern text never maps to two categories', () => {
  const seen = new Map();
  for (const row of compileBrandTable()) {
    if (row.gate) continue;
    const prior = seen.get(row.pattern);
    assert.ok(!prior || prior === row.category, `${row.pattern}: ${prior} vs ${row.category}`);
    seen.set(row.pattern, row.category);
  }
});

test('the prefilter index returns exactly what a full scan returns', () => {
  const brute = (descriptor, market) => {
    const text = normalizeBrandDescriptor(descriptor);
    const hits = [];
    for (const b of compileBrandTable()) {
      if (b.gate && b.gate !== market) continue;
      const m = b.regex.exec(text);
      if (m) hits.push({ b, start: m.index, end: m.index + m[0].length });
    }
    if (!hits.length) return null;
    let best = hits[0];
    for (const h of hits) if (h.end - h.start > best.end - best.start) best = h;
    for (const h of hits) {
      if (h.b.category === best.b.category) continue;
      if (!(h.start >= best.start && h.end <= best.end) || h.end - h.start === best.end - best.start) return null;
    }
    return best.b.category;
  };
  for (const market of ['US', 'ES', 'NL', 'TR', 'CH', 'ZZ']) {
    for (const d of corpus) assert.equal(matchBrandCategory(d, market)?.category ?? null, brute(d, market), `${market}: ${d}`);
  }
});

for (const [descriptor, market, want] of [
  ['UBER *EATS PENDING', 'US', 'dining'], ['UBER *TRIP HELP.UBER.COM', 'US', 'transport'], ['UBEREATS 8005928996', 'GB', 'dining'],
  ['APPLE.COM/BILL 866-712-7753', 'FR', 'software'], ['AMZN MKTP US*2K4TR1', 'US', 'shopping'], ['PAYPAL *NETFLIX 4029357733', 'DE', 'entertainment'],
  ['GOOGLE *YOUTUBEPREMIUM', 'IN', 'entertainment'], ['GOOGLE *GOOGLE STORAGE', 'BR', 'software'], ['TESCO MOBILE', 'GB', 'telecom'],
  ['tesco stores 3345 london', 'GB', 'groceries'], ['KROGER0412', 'US', 'groceries'], ['DIA 2231 MADRID ES', 'ES', 'groceries'],
  ['JUMBO 1432 UTRECHT', 'NL', 'groceries'], ['JUMBO 1432 ZURICH', 'CH', 'shopping'], ['ŞOK MARKET KADIKOY', 'TR', 'groceries'],
  ['BİM BİRLEŞİK MAĞAZALAR', 'TR', 'groceries'], ['A101 KADIKOY', 'TR', 'groceries'],
]) {
  test(`brand: ${descriptor} (${market}) -> ${want}`, () => assert.equal(matchBrandCategory(descriptor, market)?.category, want));
}

for (const [descriptor, market] of [
  ['DIA 2231 MADRID', 'US'], ['DIAMOND DRY CLEANERS', 'ES'], ['ACTION PLUMBING', 'US'], ['BIM BAP KOREAN', 'US'], ['D1 MOTORS', 'US'],
  ['TIMBERLAND OUTLET', 'IT'],['COOP BREWING', 'US'], ['A1012 STORE', 'TR'],
  ['MTA NYCT SUBWAY', 'US'], ['PAYPAL *FARHANAUSMA', 'US'], ['ORANGE COUNTY CHOPPERS', 'US'], ['TARGET SHOOTING RANGE', 'GB'],
  ['BOOTS AND SADDLES', 'US'], ['UBERALL GMBH', 'DE'], ['SHELLFISH SHACK', 'US'], ['A'.repeat(300), 'US'], ['', 'US'],
]) {
  test(`no brand claim: ${descriptor.slice(0, 40)} (${market})`, () => assert.equal(matchBrandCategory(descriptor, market), null));
}

test('the fallback never runs for AE/SA, a missing market or a malformed one', () => {
  for (const market of ['AE', 'SA', 'ae', ' sa ', undefined, null, '', 'GENERIC', 'U']) {
    for (const d of corpus) assert.notEqual(expense(d, market).reason, 'curated-brand-table', `${market}: ${d}`);
  }
});

test('the fallback never changes a result the rules already produced', () => {
  for (const market of ['US', 'GB', 'FR', 'ES', 'TR', 'IN', 'ZZ']) {
    for (const d of corpus) {
      const before = expense(d, undefined);
      if (before.source === 'unresolved' || before.category === 'other') continue;
      assert.deepEqual(expense(d, market), before, `${market}: ${d}`);
    }
  }
});

test('a brand hit is labelled as vocabulary and not queued for review', () => {
  const r = expense('DIA 2231 MADRID', 'ES');
  assert.equal(r.category, 'groceries');
  assert.equal(r.source, 'merchant-vocabulary');
  assert.equal(r.reason, 'curated-brand-table');
  assert.equal(r.needsReview, false);
  assert.equal(expense('DIA 2231 MADRID', 'US').category, 'other');
});

test('user merchant rules and overrides still outrank the brand table', () => {
  assert.equal(expense('DIA 2231 MADRID', 'ES', { overrides: { 'expense:dia 2231 madrid': 'shopping' } }).category, 'shopping');
  assert.equal(expense('DIA 2231 MADRID', 'ES', { rules: [{ merchant: 'DIA 2231 MADRID', type: 'expense', category: 'health' }] }).category, 'health');
  assert.equal(expense('DIA 2231 MADRID', 'ES', { manualCategory: 'travel' }).category, 'travel');
});

test('income, refunds and transfers are untouched by the brand table', () => {
  assert.equal(categorizeMerchant({ merchant: 'TESCO STORES', type: 'income', market: 'GB' }).category, 'other');
  for (const meaning of ['refund', 'own-transfer', 'card-payment', 'fee']) {
    assert.equal(categorizeMerchant({ merchant: 'TESCO STORES', type: 'expense', meaning, market: 'GB' }).category, 'other');
  }
});

test('matching stays cheap enough for bulk imports', () => {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) matchBrandCategory(corpus[i % corpus.length], 'GB');
  const perCallMs = Number(process.hrtime.bigint() - t0) / 1e6 / 2000;
  assert.ok(perCallMs < 2, `${perCallMs.toFixed(3)} ms per call`);
});

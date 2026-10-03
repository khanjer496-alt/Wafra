'use strict';
// Frozen synthetic holdout, actual app parser/advisory gates, no model inference.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createLoader } = require('../universal-test/load-ts.cjs');
const root = path.resolve(__dirname, '../..');
const fixture = 'scripts/test/fixtures/local-ai-bank-v2.json';
const output = process.argv[2];
if (!output) throw new Error('Usage: bank-baseline-v2.cjs <new-report-path>');
const outputPath = path.resolve(root, output);
if (fs.existsSync(outputPath)) throw new Error('Refusing to overwrite baseline evidence');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fixtureBytes = fs.readFileSync(path.join(root, fixture));
assert.equal(sha(fixtureBytes), '48ed63f642e0b8de708c82dffc6165a7022761a200e9c7d97ce183318619c711');
const cases = JSON.parse(fixtureBytes);
assert.equal(cases.length, 48);
// Independently normalized gold: bounded fixture currencies, no production money parser.
const exponents = Object.freeze({ AED: 2, USD: 2, EUR: 2, GBP: 2, SAR: 2, KWD: 3, BHD: 3, OMR: 3 });
function goldMoney(expected) {
  if (expected.decision !== 'candidate') return null;
  const exponent = exponents[expected.currency_text];
  assert.notEqual(exponent, undefined);
  let value = expected.amount_text.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6f0))
    .replace(/[\s٬]/gu, '').replace(/٫/g, '.');
  // In this fixture comma-only values are decimal commas; comma-grouped values
  // also contain a decimal point. Mixed punctuation uses the last as decimal.
  const decimalAt = Math.max(value.lastIndexOf('.'), value.lastIndexOf(','));
  let whole = value, fraction = '';
  if (decimalAt >= 0) {
    whole = value.slice(0, decimalAt).replace(/[.,]/g, '');
    fraction = value.slice(decimalAt + 1);
  }
  assert.match(whole, /^\d+$/); assert.match(fraction, /^\d*$/);
  assert.ok(fraction.length <= exponent, 'Gold fractional precision must fit ISO exponent');
  return { currency: expected.currency_text, exponent,
    minorUnits: (BigInt(whole) * (10n ** BigInt(exponent)) + BigInt(fraction.padEnd(exponent, '0') || '0')).toString() };
}
assert.deepEqual(goldMoney({ decision: 'candidate', amount_text: '١٢٫٣٤٥', currency_text: 'KWD' }), { currency: 'KWD', exponent: 3, minorUnits: '12345' });
assert.equal(goldMoney({ decision: 'candidate', amount_text: '1.250,50', currency_text: 'EUR' }).minorUnits, '125050');
assert.equal(goldMoney({ decision: 'candidate', amount_text: '2,100.00', currency_text: 'AED' }).minorUnits, '210000');
assert.equal(goldMoney({ decision: 'candidate', amount_text: '1 234,56', currency_text: 'EUR' }).minorUnits, '123456');
async function main() {
  const load = createLoader();
  const { inspectGenericBankEventForReview } = load('@/lib/launch-alert-parser');
  const { createLocalParserFamilyAdvisory } = load('@/lib/local-semantic-model');
  // These two pure exports share files with unrelated runtime/bundle imports.
  // Isolate those unused boundaries rather than loading model assets/inference.
  const loadSource = require('../test/repair/load-typescript.cjs');
  const policy = load('@/lib/local-semantic-background-policy');
  const { buildLocalParserSemanticWindow } = loadSource(path.join(root, 'src/lib/local-semantic-shadow.ts'), {
    '@/lib/local-semantic-model': load('@/lib/local-semantic-model'),
    '@/lib/local-semantic-background-policy': policy,
    '@/lib/local-semantic-bundle': {},
    '@/lib/local-semantic-runtime': {},
    '@react-native-async-storage/async-storage': {},
  });
  const { eligibleLocalReviewEvent } = loadSource(path.join(root, 'src/lib/local-semantic-review.ts'), {
    '@/lib/local-semantic-review-runtime': { evaluateLocalReviewWindow() { throw new Error('Inference forbidden'); } },
    '@/lib/local-semantic-background-policy': policy,
  });
  const rows = [];
  for (const row of cases) {
    const event = inspectGenericBankEventForReview(row.text, 'UNLISTED-BANK');
    const before = JSON.stringify(event);
    const window = event ? buildLocalParserSemanticWindow(row.text, event) : null;
    let retrieverCalls = 0;
    const result = await createLocalParserFamilyAdvisory({ event, semanticText: window ?? '', sensitiveSpans: [],
      retriever: { retrieve: async () => { retrieverCalls++; return null; } } });
    assert.equal(JSON.stringify(event), before, 'Advisory eligibility must not mutate financial facts');
    assert.ok(retrieverCalls <= 1);
    const gold = goldMoney(row.expected);
    const comparison = gold ? {
      family: event?.family === row.expected.family,
      direction: event?.direction === row.expected.direction,
      amountCurrency: event?.amount.value?.currency === gold.currency,
      amountExponent: event?.amount.value?.exponent === gold.exponent,
      amountMinorUnits: event?.amount.value?.minorUnits === gold.minorUnits,
      statusPosted: event?.status === 'posted',
      explicitAmount: event?.amount.evidence === 'explicit',
    } : null;
    rows.push({ id: row.id, language: row.language, text: row.text, expected: row.expected, normalizedGoldMoney: gold,
      event: event ? { decision: event.decision, family: event.family, status: event.status, direction: event.direction,
        amount: event.amount, issues: event.issues } : null,
      eligibility: { reviewEventEligible: !!event && eligibleLocalReviewEvent(event), semanticWindowPresent: !!window,
        retrieverCalls, wouldReachRetriever: retrieverCalls > 0,
        reason: retrieverCalls ? 'eligible-retriever-invoked-returned-null' : result.reason,
        advisoryResult: result },
      comparison, coreFactsExact: comparison ? Object.values(comparison).every(Boolean) : null });
  }
  const positive = rows.filter(r => r.expected.decision === 'candidate');
  const negative = rows.filter(r => r.expected.decision === 'abstain');
  const ids = list => list.map(r => r.id);
  const sourcePaths = ['src/lib/launch-alert-parser.ts', 'src/lib/universal-parser.ts', 'src/lib/local-semantic-model.ts',
    'src/lib/local-semantic-shadow.ts', 'src/lib/local-semantic-review.ts'];
  const report = {
    generatedAt: new Date().toISOString(), fixture, fixtureSha256: sha(fixtureBytes),
    sourceSha256: Object.fromEntries(sourcePaths.map(p => [p, sha(fs.readFileSync(path.join(root, p)))])),
    scope: 'Synthetic host-only baseline at the generic review seam with UNLISTED-BANK sender. Actual production parser, semantic-window builder, and advisory eligibility execute. Counted retriever always returns null; no LLM or embedding inference, runtime readiness test, device, automatic import or ledger writes.',
    comparisonContract: 'Positive exactness compares family, direction, explicit transaction amount currency/exponent/minor units, and posted status. Merchant, dates, instrument, ownership, source authentication, and final app import/certification are not compared. Negative metric is advisory eligibility blocked, not safe automatic posting. Generic review rejection may arise from missing generic bank context, not from recognized non-posting status.',
    goldNormalization: 'Independent digit/punctuation normalization and BigInt minor-unit conversion; fixed ISO exponent map limited to frozen fixture currencies. Last dot/comma is decimal; spaces and Arabic thousands separator removed. No normalization is applied to model outputs.',
    summary: { cases: rows.length, positives: positive.length, negatives: negative.length,
      positiveCoreFactsExact: ids(positive.filter(r => r.coreFactsExact)),
      positiveCoreFactsNotExact: ids(positive.filter(r => !r.coreFactsExact)),
      positiveWouldReachRetriever: ids(positive.filter(r => r.eligibility.wouldReachRetriever)),
      negativeWouldReachRetriever: ids(negative.filter(r => r.eligibility.wouldReachRetriever)),
      negativeEligibilityBlocked: ids(negative.filter(r => !r.eligibility.wouldReachRetriever)),
      noGenericReviewEvent: ids(rows.filter(r => !r.event)),
      eligibilityReasons: rows.reduce((all,r) => { const key = r.eligibility.reason; all[key] = (all[key] ?? 0) + 1; return all; }, {}),
    }, rows,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report.summary, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });

const assert = require('node:assert/strict');
const { createLoader } = require('../universal-test/load-ts.cjs');

const load = createLoader();
const { inspectUniversalBankEvent } = load('@/lib/universal-parser');
const { prepareUniversalReviewAlert, emptyAlertReviewTray } = load('@/lib/alert-review-tray');
const { ledgerMoneySpec } = load('@/lib/ledger-money');
const independent = require('../universal-evidence/independent-cases.json').parser;
const holdout = require('../universal-evidence-round2/holdout.json').parser;
const specimen = (rows, id) => {
  const row = rows.find((candidate) => candidate.id === id);
  assert.ok(row && row.kind.startsWith('synthetic'), `Expected synthetic specimen ${id}`);
  return row.body;
};

// Synthetic specimens only. Review facts come from the production extractor
// and whitelist constructor, not a hand-written replacement of their output.
const SOURCES = {
  purchase: 'Purchase of AED 89.50 at Cedar Cafe using card ending 4844 on 2026-09-01. Available balance AED 1,000.00.',
  ambiguous: 'Card purchase $ 24.90 at Cedar Cafe on 03/04/2026 with card ending 4844.',
  multiplePurchases: 'Purchase AED 89.50 at Cedar Cafe. Purchase AED 95.00 at Cedar Cafe on 03/04/2026 with card ending 4844.',
  unresolved: 'Account update: AED 42.75 for Cedar Cafe on 2026-09-01.',
  mismatch: 'Purchase of USD 15.00 at Cedar Cafe with card ending 4844 on 2026-09-01.',
  statement: 'Credit card statement. Statement date 2026-08-31. Minimum due AED 50.00. Total amount due AED 500.00. Due date 2026-09-20.',
  minimumOnly: 'Credit card statement. Minimum due AED 50.00. Due date 2026-09-20.',
  frenchPurchase: specimen(independent, 'ind-fr-fr-purchase'),
  japanesePurchase: specimen(holdout, 'r2-holdout-21'),
  spanishStatement: specimen(independent, 'ind-es-mx-statement'),
  jordanStatement: specimen(independent, 'ind-ar-jo-statement'),
  canadianRefund: specimen(independent, 'ind-en-ca-refund'),
};
// Currency is an independently selected ledger fact, not inferred from a
// parser answer. The mismatch specimen deliberately keeps the AED default.
const CURRENCIES = {
  ambiguous: 'USD', frenchPurchase: 'EUR', japanesePurchase: 'JPY',
  spanishStatement: 'MXN', jordanStatement: 'JOD', canadianRefund: 'CAD',
};
const SUPPORTED_PASTE = 'Purchase of AED 17.25 with Debit Card ending 1234 at CARREFOUR MALL OF EMIRATES, DUBAI on 05/09/2026. Avl balance AED 1,000.00';
const STATE_KEY = 'wafra/state/v1';

function createReviewFixture(name, now = Date.now()) {
  const source = SOURCES[name];
  assert.ok(source, 'Unknown synthetic review fixture');
  const event = inspectUniversalBankEvent(source, { sender: 'UNLISTED-BANK' });
  assert.equal(event.decision, 'review', `${name} must remain reviewable`);
  const review = prepareUniversalReviewAlert({
    id: `generic_review_fixture_${name}`,
    sourceKey: `generic_source_fixture_${name}`,
    observedAt: now, channel: 'inbox', event,
  });
  assert.ok(review, `${name} must pass the real review whitelist`);
  return { review, source, currency: CURRENCIES[name] ?? 'AED' };
}

function createWebSeed(review = null, now = Date.now(), currency = 'AED') {
  const state = {
    ledgerMoney: ledgerMoneySpec(currency),
    reviewTray: { ...emptyAlertReviewTray(), pending: review ? [review] : [] },
    accounts: [
      { id: 'qa_review_card_4844', name: 'QA Review Card', kind: 'card', cardType: 'credit', last4: '4844', openingFils: 0, color: '#367A61' },
      // A real opening balance keeps the test ledger pinned before its first
      // transaction; an entirely empty ledger intentionally has no currency.
      { id: 'qa_current_account', name: 'QA Current Account', kind: 'bank', last4: '1234', openingFils: 100000, color: '#637581' },
      { id: 'qa_refund_card_7214', name: 'QA Refund Card', kind: 'card', cardType: 'credit', last4: '7214', openingFils: 0, color: '#637581' },
    ],
    budgets: [], bills: [], cardDues: [], goals: [],
    merchantOverrides: {}, accountHints: {}, notSubscriptions: [],
    localCaptureQualifications: [], iosCaptureWarning: null,
    onboardingPlan: null, onboardingCurrencyEvidence: null,
    onboarded: true, userName: 'QA', appLock: false,
    marketId: 'AE', language: 'en', languagePreference: 'en', themePreference: 'light',
    monthStartDay: 1, pro: false, founderPro: false, trialStartTs: now,
    privateMode: false, captureOptOut: true, dailySummary: false,
    parserVersion: 32, lastScanTs: 0, historyImport: null,
    // The browser adapter's current metadata/chunk wire format. No React
    // store, promotion method, or rendered component is replaced in the test.
    txChunks: 0, txChunkOrder: 'oldest-first',
  };
  return [[STATE_KEY, JSON.stringify(state)]];
}

module.exports = { STATE_KEY, SOURCES, SUPPORTED_PASTE, createReviewFixture, createWebSeed };

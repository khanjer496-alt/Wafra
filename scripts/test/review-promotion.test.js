const { planReviewPromotion } = require('./build/review-promotion.js');
const { emptyAlertReviewTray } = require('./build/alert-review-tray.js');
const { ledgerMoneySpec } = require('./build/ledger-money.js');

let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
  if (condition) { pass += 1; console.log(`✓ ${name}`); }
  else { fail += 1; console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

const NOW = Date.UTC(2026, 7, 11, 12);
const review = (over = {}) => ({
  id: 'opaque_review_id_000001',
  sourceKey: 'opaque_source_key_00001',
  observedAt: NOW,
  expiresAt: NOW + 86_400_000,
  channel: 'inbox',
  parserVersion: 1,
  market: 'IN',
  institution: 'hdfc-bank',
  grammar: {
    id: 'hdfc-bank-sms-v1', version: 1, channel: 'bank-alert',
    status: 'experimental', provenance: 'synthetic-seed',
  },
  amount: { currency: 'INR', minorUnits: '125050', exponent: 2 },
  direction: 'debit',
  family: 'purchase',
  rail: null,
  instrument: { kind: 'card', last4: '1234' },
  ...over,
});
const state = (item, over = {}) => ({
  hydrated: true,
  ledgerMoney: null,
  reviewTray: { ...emptyAlertReviewTray(), pending: [item] },
  accounts: [{ id: 'acc-1', name: 'Card', kind: 'card', openingFils: 0, color: '#000', last4: '1234' }],
  transactions: [], budgets: [], bills: [], cardDues: [], goals: [],
  merchantOverrides: {}, accountHints: {}, notSubscriptions: [], lastScanTs: 0,
  onboarded: true, userName: 'Test', appLock: false, monthStartDay: 1,
  pro: false, privateMode: false, dailySummary: false, trialStartTs: NOW,
  marketId: 'AE', language: 'en', themePreference: 'system',
  ...over,
});
const command = (item, over = {}) => ({
  reviewId: item.id,
  type: item.direction === 'debit' ? 'expense' : 'income',
  title: 'Card purchase',
  category: item.direction === 'debit' ? 'other' : 'business',
  accountId: 'acc-1',
  date: '2026-08-11',
  betweenOwnAccounts: false,
  ...over,
});

for (const [currency, exponent, minorUnits] of [
  ['JPY', 0, '12345'], ['USD', 2, '12345'], ['KWD', 3, '12345'],
]) {
  const item = review({ amount: { currency, exponent, minorUnits } });
  const result = planReviewPromotion(state(item), command(item), `tx-${currency}`, NOW + 1);
  ok(`${currency} exact minor units become one ledger row without floating point`,
    result.outcome === 'added' && result.transaction.amountFils === 12345 &&
      result.ledgerMoney.currency === currency && result.ledgerMoney.exponent === exponent &&
      result.reviewTray.pending.length === 0 &&
      result.reviewTray.tombstones[0]?.outcome === 'added', JSON.stringify(result));
}

{
  const item = review();
  const result = planReviewPromotion(
    state(item, { ledgerMoney: ledgerMoneySpec('AED') }), command(item), 'tx-mismatch', NOW + 1,
  );
  ok('review money can never be relabelled into a different ledger currency',
    result.outcome === 'refused' && result.reason === 'currency-mismatch', JSON.stringify(result));
}

{
  const item = review({ amount: { currency: 'INR', exponent: 2, minorUnits: '9007199254740992' } });
  const result = planReviewPromotion(state(item), command(item), 'tx-overflow', NOW + 1);
  ok('unsafe integer amounts are refused before entering Transaction.number',
    result.outcome === 'refused' && result.reason === 'invalid-money', JSON.stringify(result));
}

{
  const item = review();
  const wrongCategory = planReviewPromotion(
    state(item), command(item, { category: 'salary' }), 'tx-category', NOW + 1,
  );
  const wrongInstrument = planReviewPromotion(
    state(item, { accounts: [{ id: 'acc-1', name: 'Other', kind: 'card', openingFils: 0, color: '#000', last4: '9999' }] }),
    command(item), 'tx-account', NOW + 1,
  );
  ok('direction/category and grounded instrument mismatches fail closed',
    wrongCategory.outcome === 'refused' && wrongCategory.reason === 'invalid-category' &&
      wrongInstrument.outcome === 'refused' && wrongInstrument.reason === 'instrument-mismatch',
    `${JSON.stringify(wrongCategory)} | ${JSON.stringify(wrongInstrument)}`);
}

{
  const item = review();
  const result = planReviewPromotion(state(item, {
    transactions: [{
      id: 'existing', type: 'expense', amountFils: 125050, category: 'other',
      accountId: 'acc-1', title: 'Existing', date: '2026-08-11', smsKey: item.sourceKey,
    }],
  }), command(item), 'tx-duplicate', NOW + 1);
  ok('retrying an already-added source resolves the tray without duplicating money',
    result.outcome === 'duplicate' && result.reviewTray.pending.length === 0 &&
      result.reviewTray.tombstones[0]?.outcome === 'duplicate', JSON.stringify(result));
}

console.log(`\nreview-promotion: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

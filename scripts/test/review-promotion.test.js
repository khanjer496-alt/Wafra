const { planReviewPromotion, reviewTemplateRuleFor } = require('./build/review-promotion.js');
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
  templateKey: 'opaque_template_key_0001',
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
  const item = review({
    direction: 'credit', family: 'transfer',
    amount: { currency: 'AED', exponent: 2, minorUnits: '850000' },
    market: 'AE', institution: 'first-abu-dhabi-bank',
    instrument: { kind: 'account', last4: '1234' },
  });
  const base = state(item, {
    ledgerMoney: ledgerMoneySpec('AED'),
    accounts: [{
      id: 'acc-1', name: 'Salary account', kind: 'bank', openingFils: 0,
      color: '#000', last4: '1234',
    }],
  });
  const correction = command(item, {
    type: 'income', title: 'Talabat sales', category: 'business',
    accountId: 'acc-1', betweenOwnAccounts: false,
  });
  const promoted = planReviewPromotion(base, correction, 'tx-memory', NOW + 1);
  const nextItem = review({
    ...item,
    id: 'opaque_review_id_000002', sourceKey: 'opaque_source_key_00002',
    amount: { currency: 'AED', exponent: 2, minorUnits: '910000' },
    observedAt: NOW + 86_400_000,
  });
  const nextState = promoted.outcome === 'added' ? {
    ...base,
    reviewTray: { ...promoted.reviewTray, pending: [nextItem] },
  } : base;
  const remembered = reviewTemplateRuleFor(nextState, nextItem);
  ok('one explicit correction becomes a device-local template default for the next matching alert',
    promoted.outcome === 'added' && promoted.reviewTray.templateRules.length === 1 &&
      remembered?.title === 'Talabat sales' && remembered?.category === 'business' &&
      remembered?.accountId === 'acc-1' && remembered?.confirmations === 1,
    JSON.stringify({ promoted, remembered }));

  const conflicting = reviewTemplateRuleFor(nextState, {
    ...nextItem, institution: 'another-bank',
  });
  ok('an opaque template rule cannot cross institution evidence',
    conflicting === null, JSON.stringify(conflicting));
}

{
  const item = review({
    direction: 'credit', family: 'transfer',
    amount: { currency: 'AED', exponent: 2, minorUnits: '200000' },
    market: 'AE', institution: 'first-abu-dhabi-bank',
    instrument: { kind: 'account', last4: '0044' },
  });
  const ownAccounts = [
    { id: 'acc-1', name: 'Destination', kind: 'bank', openingFils: 0, color: '#000', last4: '0044' },
    { id: 'acc-2', name: 'Source', kind: 'bank', openingFils: 0, color: '#111', last4: '0021' },
  ];
  const funding = {
    id: 'funding-leg', type: 'expense', amountFils: 200000, category: 'other',
    accountId: 'acc-2', title: 'Unclassified payment', date: '2026-08-11',
    ts: NOW - 60_000, source: 'sms',
  };
  const base = state(item, {
    ledgerMoney: ledgerMoneySpec('AED'), accounts: ownAccounts, transactions: [funding],
  });
  const result = planReviewPromotion(base, command(item, {
    type: 'income', title: 'Own account transfer', category: 'business',
    accountId: 'acc-1', betweenOwnAccounts: true,
  }), 'tx-own-transfer', NOW + 1);
  ok('an explicit own-transfer decision confirms only the reviewed row, never an amount-only partner',
    result.outcome === 'added' && result.counterpartId === undefined &&
      result.transaction.isTransfer === true && result.transaction.transferDecision.ownership === 'own' &&
      base.transactions[0].transferDecision === undefined,
    JSON.stringify(result));

  const ambiguous = planReviewPromotion({
    ...base,
    transactions: [funding, { ...funding, id: 'second-leg', ts: NOW - 30_000 }],
  }, command(item, {
    type: 'income', title: 'Own account transfer', category: 'business',
    accountId: 'acc-1', betweenOwnAccounts: true,
  }), 'tx-ambiguous-transfer', NOW + 1);
  ok('multiple possible opposite legs are never rewritten by a guess',
    ambiguous.outcome === 'added' && ambiguous.counterpartId === undefined,
    JSON.stringify(ambiguous));

  const categorizedPurchase = planReviewPromotion({
    ...base,
    transactions: [{ ...funding, id: 'groceries', category: 'groceries', title: 'Carrefour' }],
  }, command(item, {
    type: 'income', title: 'Own account transfer', category: 'business',
    accountId: 'acc-1', betweenOwnAccounts: true,
  }), 'tx-purchase-coincidence', NOW + 1);
  ok('a coincidental categorized purchase is never rewritten as the opposite transfer leg',
    categorizedPurchase.outcome === 'added' && categorizedPurchase.counterpartId === undefined,
    JSON.stringify(categorizedPurchase));

  const staleCoincidence = planReviewPromotion({
    ...base,
    transactions: [{ ...funding, id: 'old-transfer', ts: NOW - 16 * 60_000 }],
  }, command(item, {
    type: 'income', title: 'Own account transfer', category: 'business',
    accountId: 'acc-1', betweenOwnAccounts: true,
  }), 'tx-old-coincidence', NOW + 1);
  ok('an equal transfer outside the alert window is never rewritten by amount alone',
    staleCoincidence.outcome === 'added' && staleCoincidence.counterpartId === undefined,
    JSON.stringify(staleCoincidence));
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

// Registered and universal reviews share the canonical provider identity.
for (const [alias, canonical] of [
  ['apple_message_review_source_' + 'b'.repeat(64), 'h' + 'b'.repeat(64)],
  ['android_message_review_source_a123', `ha123t${NOW}`],
]) {
  const item = review({ sourceKey: alias });
  const existing = state(item, { ledgerMoney: ledgerMoneySpec('INR'), transactions: [
    { id: 'native-existing', smsKey: canonical, ts: item.observedAt },
  ] });
  ok('registered review cannot duplicate a canonical native source',
    planReviewPromotion(existing, command(item), 'duplicate-alias', NOW).outcome === 'duplicate');
  const added = planReviewPromotion(state(item), command(item), 'new-canonical', NOW);
  ok('registered review saves the canonical source for later native reparse',
    added.outcome === 'added' && added.transaction.smsKey === canonical);
}

// Registered reviews preserve instrument kind, not merely matching card tails.
{
  const item = review();
  const wrong = state(item, { accounts: [{ ...state(item).accounts[0], kind: 'bank' }] });
  ok('a registered card cannot promote into a bank account sharing its last four digits',
    planReviewPromotion(wrong, command(item), 'wrong-kind', NOW).reason === 'instrument-mismatch');
  const accountItem = review({ instrument: { kind: 'account', last4: '1234' } });
  ok('a registered account cannot promote into a card sharing its last four digits',
    planReviewPromotion(state(accountItem), command(accountItem), 'wrong-kind', NOW).reason === 'instrument-mismatch');
  const noInstrument = review({ instrument: null });
  ok('registered unknown instrument still allows the explicit account choice',
    planReviewPromotion(state(noInstrument), command(noInstrument), 'chosen-account', NOW).outcome === 'added');
}

{
  const { prepareUniversalReviewAlert, normalizeAlertReviewTray } = require('./build/alert-review-tray.js');
  const { inspectUniversalBankEvent } = require('./build/universal-parser.js');
  const make = (currency = 'CAD', literal = '24.90') => prepareUniversalReviewAlert({
    id: 'universal_review_id_00001', sourceKey: 'android_message_review_source_a123',
    observedAt: NOW, channel: 'inbox', parserVersion: 32,
    event: inspectUniversalBankEvent(`Card purchase ${currency} ${literal} at MAPLE CAFE on 2026-09-05.`),
  });
  const confirm = (item, changes = {}) => ({
    reviewId: item.id, type: 'expense', title: 'Maple Cafe', category: 'dining',
    accountId: 'acc-1', date: '2026-09-05', betweenOwnAccounts: false,
    universal: { confirmed: true, postingStatus: 'posted', amount: item.event.amount.value,
      expectedSourceKey: item.sourceKey, expectedObservedAt: item.observedAt },
    ...changes,
  });
  for (const [currency, literal, expected, exponent] of [
    ['CAD', '24.90', 2490, 2], ['JPY', '2400', 2400, 0], ['KWD', '12٫345', 12345, 3],
  ]) {
    const item = make(currency, literal);
    const base = state(item);
    base.reviewTray = normalizeAlertReviewTray(JSON.parse(JSON.stringify(base.reviewTray)), NOW);
    const result = planReviewPromotion(base, confirm(item), `universal-${currency}`, NOW + 1);
    ok(`${currency} universal confirmation after reload preserves native minor units`,
      result.outcome === 'added' && result.transaction.amountFils === expected &&
      result.ledgerMoney.currency === currency && result.ledgerMoney.exponent === exponent,
      JSON.stringify(result));
    ok(`${currency} universal promotion binds the native source and creates no template rule`,
      result.outcome === 'added' && result.transaction.smsKey === `ha123t${NOW}` &&
      result.transaction.ts === NOW && result.reviewTray.templateRules.length === 0 &&
      result.reviewTray.pending.length === 0);
  }
  const item = make();
  const pasted = { ...item, channel: 'paste', sourceKey: 'paste_source_00000001' };
  const pastedBase = state(pasted);
  pastedBase.reviewTray = normalizeAlertReviewTray(JSON.parse(JSON.stringify(pastedBase.reviewTray)), NOW);
  const pastedResult = planReviewPromotion(pastedBase, confirm(pasted), 'pasted-transaction', NOW + 1);
  ok('confirmed paste preserves opaque proposal identity without inventing a provider key',
    pastedResult.outcome === 'added' && pastedResult.transaction.smsKey === pasted.sourceKey &&
    !pastedResult.transaction.viaPush && pastedResult.reviewTray.templateRules.length === 0);
  const pasteRetry = planReviewPromotion({ ...pastedBase, ledgerMoney: pastedResult.ledgerMoney,
    transactions: [pastedResult.transaction] }, confirm(pasted), 'paste-retry', NOW + 2);
  ok('reconfirming the same pasted proposal is idempotent after the first commit', pasteRetry.outcome === 'duplicate');
  const base = state(item);
  const run = (commandChanges = {}, stateChanges = {}) =>
    planReviewPromotion({ ...base, ...stateChanges }, confirm(item, commandChanges), 'new-universal-tx', NOW + 1);
  ok('generic review requires explicit posting confirmation',
    run({ universal: undefined }).reason === 'confirmation-required' &&
    run({ universal: { ...confirm(item).universal, confirmed: false } }).reason === 'confirmation-required');
  ok('generic review refuses stale displayed source identity',
    run({ universal: { ...confirm(item).universal, expectedSourceKey: 'different_source_0001' } }).reason === 'source-changed');
  ok('generic review refuses stale displayed source observation time',
    run({ universal: { ...confirm(item).universal, expectedObservedAt: NOW - 1 } }).reason === 'source-changed');
  ok('same review id rebound in authoritative state cannot accept an old screen confirmation',
    run({}, { reviewTray: { ...base.reviewTray, pending: [{ ...item, sourceKey: 'different_source_0001' }] } }).reason === 'source-changed');
  ok('universal source metadata supplied outside its confirmation cannot override host identity',
    run({ sourceKey: 'different_source_0001', observedAt: 1 }).transaction?.smsKey === `ha123t${NOW}`);
  ok('expired generic evidence cannot promote',
    planReviewPromotion(base, confirm(item), 'expired', item.expiresAt).reason === 'expired');
  ok('resolved generic evidence cannot promote again from stale state',
    run({}, { reviewTray: emptyAlertReviewTray() }).reason === 'not-found');
  ok('a changed ledger currency is rechecked at confirmation time',
    run({}, { ledgerMoney: ledgerMoneySpec('AED') }).reason === 'currency-mismatch');
  ok('an unhydrated ledger cannot receive a confirmed generic posting',
    run({}, { hydrated: false }).reason === 'not-hydrated');
  ok('ungrounded user-entered money cannot become a generic transaction',
    run({ universal: { ...confirm(item).universal,
      amount: { currency: 'CAD', minorUnits: '99999', exponent: 2 } } }).reason === 'ungrounded-money');
  ok('generic currency exponent cannot be changed at confirmation',
    run({ universal: { ...confirm(item).universal,
      amount: { currency: 'CAD', minorUnits: '2490', exponent: 3 } } }).reason === 'invalid-money');
  ok('generic direction cannot contradict the source posting', run({ type: 'income', category: 'business' }).reason === 'direction-conflict');
  ok('generic category must match confirmed direction', run({ category: 'salary' }).reason === 'invalid-category');
  const longMerchant = { ...item, event: { ...item.event, merchant: {
    ...item.event.merchant, value: 'M'.repeat(96),
  } } };
  ok('a long extracted merchant requires an edited ledger title at confirmation',
    planReviewPromotion(state(longMerchant), confirm(longMerchant, { title: 'M'.repeat(96) }),
      'long-title', NOW).reason === 'invalid-title');
  ok('shortening a long merchant suggestion preserves its valid monetary proposal',
    planReviewPromotion(state(longMerchant), confirm(longMerchant, { title: 'M'.repeat(80) }),
      'shortened-title', NOW).outcome === 'added');
  ok('generic unknown categories cannot silently fall back to Other', run({ category: 'made-up' }).reason === 'invalid-category');
  ok('generic corrupt expiry fails closed before confirmation',
    run({}, { reviewTray: { ...base.reviewTray, pending: [{ ...item, expiresAt: NaN }] } }).reason === 'invalid-event');
  ok('generic source envelope rejects an unknown capture channel',
    run({}, { reviewTray: { ...base.reviewTray, pending: [{ ...item, channel: 'raw-message' }] } }).reason === 'invalid-event');
  ok('generic impossible dates are refused', run({ date: '2026-02-30' }).reason === 'invalid-date');
  ok('generic deleted account cannot receive money', run({ accountId: 'deleted' }).reason === 'invalid-account');
  ok('generic purchase cannot become an own-account transfer', run({ betweenOwnAccounts: true }).reason === 'invalid-transfer');
  ok('generic invalid type fails closed', run({ type: 'invented' }).reason === 'confirmation-required');
  const duplicate = run({}, { ledgerMoney: ledgerMoneySpec('CAD'),
    transactions: [{ id: 'native-before-review', smsKey: 'ha123', ts: NOW }] });
  ok('native canonical source already imported resolves generic review as duplicate',
    duplicate.outcome === 'duplicate' && duplicate.reviewTray.pending.length === 0 &&
    duplicate.reviewTray.tombstones[0].outcome === 'duplicate');
  const first = run();
  const retry = run({}, { ledgerMoney: first.ledgerMoney, transactions: [first.transaction] });
  ok('fresh re-planning after the first commit cannot duplicate its source', retry.outcome === 'duplicate');
  const ambiguity = { ...item, event: { ...item.event,
    amount: { ...item.event.amount, value: null, evidence: 'ambiguous',
      alternatives: [item.event.amount.value, { currency: 'CAD', minorUnits: '2500', exponent: 2 }] },
  } };
  const selected = confirm(ambiguity, { universal: { ...confirm(item).universal,
    amount: { currency: 'CAD', minorUnits: '2500', exponent: 2 } } });
  ok('an explicit supported money alternative can be confirmed',
    planReviewPromotion(state(ambiguity), selected, 'selected-alternative', NOW).transaction?.amountFils === 2500);
  const explicit = { ...item, event: { ...item.event, instrument: {
    value: { kind: 'card', last4: '1234' }, evidence: 'explicit', alternatives: [], spans: [], issues: [],
  } } };
  ok('a generic explicit card cannot use a bank account with the same tail',
    planReviewPromotion(state(explicit, { accounts: [{ ...base.accounts[0], kind: 'bank' }] }),
      confirm(explicit), 'wrong-kind', NOW).reason === 'instrument-mismatch');
  const uncertainInstrument = { ...item, event: { ...item.event, instrument: {
    value: null, evidence: 'ambiguous', alternatives: [
      { kind: 'card', last4: '1234' }, { kind: 'account', last4: '9876' },
    ], spans: [], issues: [],
  } } };
  ok('ambiguous instruments require an explicit choice',
    planReviewPromotion(state(uncertainInstrument), confirm(uncertainInstrument), 'choose-instrument', NOW).reason === 'instrument-ambiguous');
  ok('an explicitly selected grounded instrument can use a compatible account',
    planReviewPromotion(state(uncertainInstrument), confirm(uncertainInstrument, {
      universal: { ...confirm(uncertainInstrument).universal, instrument: { kind: 'card', last4: '1234' } },
    }), 'selected-instrument', NOW).outcome === 'added');
  ok('an instrument not among the source alternatives cannot be selected',
    planReviewPromotion(state(uncertainInstrument), confirm(uncertainInstrument, {
      universal: { ...confirm(uncertainInstrument).universal, instrument: { kind: 'card', last4: '9999' } },
    }), 'invented-instrument', NOW).reason === 'instrument-mismatch');
  ok('generic items never reuse registered template defaults',
    reviewTemplateRuleFor(base, { ...item, templateKey: 'opaque_template_key_0001' }) === null);
  for (const [family, status] of [['statement', 'informational'], ['balance', 'informational'],
    ['card-payment', 'posted'], ['bill', 'future'], ['purchase', 'future']]) {
    const informational = { ...item, event: { ...item.event, family, status } };
    ok(`${family}/${status} facts cannot promote as an ordinary posting`,
      planReviewPromotion(state(informational), confirm(informational), 'not-a-posting', NOW).outcome === 'refused');
  }
}

console.log(`\nreview-promotion: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

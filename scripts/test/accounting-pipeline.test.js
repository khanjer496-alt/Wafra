/**
 * Golden end-to-end accounting scenarios.
 *
 * These cross the same seams as a real Android history reread: bank text ->
 * parser -> import plan -> id materialisation -> reducer reconciliation ->
 * spending/income/cash-out summaries. Isolated regex tests cannot catch an
 * event-identity collision that only corrupts totals after dedupe.
 */
const assert = require('assert');
const { isDeepStrictEqual } = require('util');

const { summarizeCashOutflow } = require('./build/cash-flow.js');
const { summarizeMonth } = require('./build/insights.js');
const { buildImportPlan } = require('./build/import-plan.js');
const { createLaunchAlertSession } = require('./build/launch-alert-parser.js');
const {
  applyMaterializedImportBatch,
  materializeImportBatch,
} = require('./build/ledger-import.js');
const { setActiveMarket, setLedgerCurrency } = require('./build/markets.js');
const { parseSms, PARSER_VERSION } = require('./build/sms-parser.js');

let pass = 0;
const ok = (name, condition, detail) => {
  assert.ok(condition, detail);
  pass += 1;
  console.log(`✓ ${name}`);
};

const accounts = [
  {
    id: 'liv-bank', name: 'Liv bank', kind: 'bank', bankName: 'Liv', last4: '0002',
    openingFils: 0, color: '#111111',
  },
  {
    id: 'fab-bank', name: 'FAB bank', kind: 'bank', bankName: 'FAB', last4: '0004',
    openingFils: 0, color: '#222222',
  },
  {
    id: 'fab-card', name: 'FAB card', kind: 'card', cardType: 'credit', bankName: 'FAB',
    last4: '5444', openingFils: 0, color: '#333333',
  },
];
const BASE = {
  hydrated: true,
  onboarded: true,
  accounts,
  transactions: [],
  budgets: [],
  bills: [],
  goals: [],
  cardDues: [],
  accountHints: { '0002': 'liv-bank', '0004': 'fab-bank', '5444': 'fab-card' },
  merchantOverrides: {},
  reviewTray: { schemaVersion: 1, pending: [], tombstones: [] },
  lastScanTs: 0,
  parserVersion: 0,
  marketId: 'AE',
  monthStartDay: 1,
  privateMode: false,
  captureOptOut: false,
};

const NOW = new Date('2026-08-12T12:00:00Z');
const messages = [
  {
    id: 101,
    ts: Date.parse('2026-08-01T14:25:32Z'),
    sender: 'Liv',
    body: 'Dear Customer, AED 12,168.00 has been debited from your account 0002 towards instant transfer. The available balance is AED 15,000.00.',
  },
  {
    id: 102,
    ts: Date.parse('2026-08-01T14:27:27Z'),
    sender: 'FAB',
    body: 'Dear Customer, Your payment instructions of AED 12168.00 to Fishbasket for consumer number 1318124036 has been processed on 01/08/2026 18:27',
  },
  {
    id: 103,
    ts: Date.parse('2026-08-11T08:00:00Z'),
    sender: 'Liv',
    body: 'AED 1,165.33 has been credited to your account. B/O DELIVERY HERO TALABAT DB LLC Talabat Biweekly Payment till 10-Aug-2026.',
  },
  {
    id: 104,
    ts: Date.parse('2026-08-08T09:00:00Z'),
    sender: 'FAB',
    body: 'Purchase of AED 25.00 at STORE ONE with Credit Card ending 5444',
  },
  {
    id: 105,
    ts: Date.parse('2026-08-08T09:00:00Z'),
    sender: 'FAB',
    body: 'Purchase of AED 25.00 at STORE TWO with Credit Card ending 5444',
  },
  {
    id: 106,
    ts: Date.parse('2026-08-10T10:00:00Z'),
    sender: 'FAB',
    body: 'AED 1,000.00 has been deducted from your account 0002 towards payment of your Credit Card ending 5444.',
  },
  {
    id: 107,
    ts: Date.parse('2026-08-10T10:00:00Z'),
    sender: 'FAB',
    body: 'Payment of AED 1,000.00 received towards your Credit Card ending 5444. Thank you.',
  },
  {
    id: 108,
    ts: Date.parse('2026-08-10T08:00:00Z'),
    sender: 'Etisalat',
    body: 'Dear Customer, The due date for your e& bill is nearing. A total amount of AED 775.81 including VAT is due on 15-08-2026.',
  },
  {
    id: 109,
    ts: Date.parse('2026-08-08T08:00:00Z'),
    sender: 'SEWA',
    body: 'Dear Customer, Bill amount for your account 9992442 is AED 200.00, billed on 08-Aug-26. Please pay by 23-Aug-26. https://sewa.gov.ae',
  },
];

setLedgerCurrency(null);
setActiveMarket('AE');
const parsed = messages.flatMap((message) => {
  const result = parseSms(message.body, {}, { sender: message.sender });
  return result
    ? [{
        ...result,
        date: result.date ?? new Date(message.ts).toISOString().slice(0, 10),
        smsTs: message.ts,
        sender: message.sender,
        channel: 'inbox',
        sourceEventId: `a${message.id}`,
      }]
    : [];
});
ok('every golden bank alert is understood', parsed.length === messages.length, parsed.length);

const newestTs = Math.max(...messages.map((message) => message.ts));
const plan = buildImportPlan(parsed, BASE, newestTs, NOW);
{
  let incrementalId = 0;
  const restoredState = { ...BASE, parserVersion: 18 };
  const incremental = materializeImportBatch(
    plan.batch,
    restoredState,
    (prefix) => `incremental-${prefix}-${++incrementalId}`,
  );
  const afterIncremental = applyMaterializedImportBatch(restoredState, incremental);
  ok('an incremental import cannot claim an older restored ledger was fully reread',
    afterIncremental.parserVersion === 18,
    afterIncremental.parserVersion);

  let rereadId = 0;
  const reread = materializeImportBatch(
    { ...plan.batch, parserRereadComplete: true },
    restoredState,
    (prefix) => `reread-${prefix}-${++rereadId}`,
  );
  const afterReread = applyMaterializedImportBatch(restoredState, reread);
  ok('only a completed full-history batch advances the durable parser version',
    afterReread.parserVersion === PARSER_VERSION,
    afterReread.parserVersion);

  const pageProgress = {
    status: 'running',
    cursor: { beforeDateMs: 1_700_000_000_000, beforeId: 900 },
    scanned: 1000,
    found: 9,
    startedAt: 10,
    updatedAt: 20,
    error: null,
  };
  const pageBatch = materializeImportBatch(
    { ...plan.batch, historyImport: pageProgress },
    restoredState,
    (prefix) => `history-page-${prefix}-${++rereadId}`,
  );
  const afterPage = applyMaterializedImportBatch(restoredState, pageBatch);
  ok('one ledger batch applies page rows and the next history cursor atomically',
    isDeepStrictEqual(afterPage.historyImport, pageProgress),
    JSON.stringify(afterPage.historyImport));
}
{
  let proofId = 0;
  const pendingState = {
    ...BASE,
    onboardingPlan: { goalIds: ['emergency'], budgetId: 'balanced' },
  };
  const proofBatch = materializeImportBatch(
    plan.batch,
    pendingState,
    (prefix) => `proof-${prefix}-${++proofId}`,
  );
  const provedState = applyMaterializedImportBatch(pendingState, proofBatch);
  ok('a bank-alert batch durably records its observed onboarding currency',
    provedState.onboardingCurrencyEvidence === 'AED',
    provedState.onboardingCurrencyEvidence);
}
let id = 0;
const batch = materializeImportBatch(plan.batch, BASE, (prefix) => `gold-${prefix}-${++id}`);
let state = applyMaterializedImportBatch(BASE, batch);

ok('same-time same-value card purchases remain two real events',
  state.transactions.filter((row) => row.amountFils === 2500).length === 2);
ok('Talabat settlement is countable business income, not an internal transfer',
  state.transactions.some((row) =>
    row.title === 'Talabat sales' && row.type === 'income' && row.category === 'business' &&
    row.isTransfer !== true));
ok('linked utility funding and receipt collapse to one named payment',
  state.transactions.filter((row) => row.amountFils === 1216800).length === 1 &&
    state.transactions.some((row) => row.title === 'Fishbasket'));
ok('e& and SEWA become separate current fixed obligations',
  state.bills.length === 2 && new Set(state.bills.map((bill) => bill.title)).size === 2);

// The user identifies that the named utility purchase was made on the card.
// It remains spending now; cash leaves only when that card is repaid.
state = {
  ...state,
  transactions: state.transactions.map((row) =>
    row.title === 'Fishbasket'
      ? { ...row, accountId: 'fab-card', category: 'utilities', userEdited: true }
      : row),
};
const month = { mode: 'month', key: '2026-08' };
const summary = summarizeMonth(state.transactions, month);
const cashOut = summarizeCashOutflow(state, month);
ok('card-funded utility purchase counts once in spending', summary.expenseFils === 1221800,
  summary.expenseFils);
ok('Talabat settlement reaches income totals', summary.incomeFils === 116533,
  summary.incomeFils);
ok('the two-sided credit-card repayment contributes to cash out exactly once',
  cashOut.totalFils === 100000 && cashOut.cardPaymentsFils === 100000,
  JSON.stringify({
    cashOut,
    settlements: state.transactions
      .filter((row) => row.amountFils === 100000)
      .map((row) => ({
        type: row.type,
        accountId: row.accountId,
        isTransfer: row.isTransfer,
        cardPaymentSide: row.cardPaymentSide,
        date: row.date,
        ts: row.ts,
      })),
  }));

const replayPlan = buildImportPlan(parsed, state, newestTs, NOW);
const replayBatch = materializeImportBatch(
  replayPlan.batch,
  state,
  (prefix) => `gold-replay-${prefix}-${++id}`,
);
const replayState = applyMaterializedImportBatch(state, replayBatch);
ok('replaying the complete bank history makes no ledger or accounting change',
  isDeepStrictEqual(replayState, state));

// Semantic fallback crosses the same durable accounting path. These messages
// are intentionally not bank-template fixtures: their status, direction,
// exact money and meaning are stated in ordinary banking language.
const semanticMessages = [
  {
    id: 201,
    ts: Date.parse('2026-08-12T08:00:00Z'),
    sender: 'FAB',
    body: 'Payroll credit: AED 7,500.00 was posted to your account 1234.',
  },
  {
    id: 202,
    ts: Date.parse('2026-08-12T09:00:00Z'),
    sender: 'ADCB',
    body: 'AED 5,000.00 moved from your account 002 to your own account 004 successfully.',
  },
  {
    id: 203,
    ts: Date.parse('2026-08-12T09:10:00Z'),
    sender: 'FAB',
    body: 'Merchant payout of AED 1,250.00 was credited to your account 0004 successfully.',
  },
  {
    id: 204,
    ts: Date.parse('2026-08-12T09:20:00Z'),
    sender: 'FAB',
    body: 'Refund of AED 125.00 was credited to your account 0004 successfully.',
  },
  {
    id: 205,
    ts: Date.parse('2026-08-12T09:30:00Z'),
    sender: 'ADCB',
    body: 'AED 700.00 was transferred from your account 0002 to AHMED successfully.',
  },
  {
    id: 206,
    ts: Date.parse('2026-08-12T09:40:00Z'),
    sender: 'ADCB',
    body: 'Your electricity bill payment of AED 410.00 was processed successfully for account 7777.',
  },
  {
    id: 207,
    ts: Date.parse('2026-08-12T09:50:00Z'),
    sender: 'ENBD',
    body: 'Cash withdrawal of AED 600.00 was completed at ATM using card ending 6666.',
  },
  {
    id: 208,
    ts: Date.parse('2026-08-12T10:00:00Z'),
    sender: 'FAB',
    body: 'Annual card fee of AED 250.00 was debited from your card ending 5555.',
  },
  {
    id: 209,
    ts: Date.parse('2026-08-12T10:10:00Z'),
    sender: 'FAB',
    body: 'Payment of AED 900.00 was received for your credit card ending 5444.',
  },
];
const semanticSession = createLaunchAlertSession({
  overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE',
});
const semanticParsed = semanticMessages.flatMap((message) => {
  const inspection = semanticSession.inspect(message.body, message.sender);
  const result = semanticSession.parse(message.body, message.sender, inspection);
  return result ? [{
    ...result,
    date: result.date ?? new Date(message.ts).toISOString().slice(0, 10),
    smsTs: message.ts,
    sender: message.sender,
    channel: 'inbox',
    sourceEventId: `a${message.id}`,
  }] : [];
});
ok('semantic salary and own transfer both survive the launch capture seam',
  semanticParsed.length === semanticMessages.length && semanticParsed[0].type === 'income' &&
    semanticParsed[0].categoryGuess === 'salary' &&
    semanticParsed[1].type === 'expense' && semanticParsed[1].transferHint === true &&
    semanticParsed[2].categoryGuess === 'business' &&
    semanticParsed[3].merchant === 'Refund' &&
    semanticParsed[4].transferHint === false &&
    semanticParsed[5].paymentFlowSide === 'receipt' &&
    semanticParsed[6].categoryGuess === 'cash-withdrawal' &&
    semanticParsed[7].merchant === 'Annual card fee' &&
    semanticParsed[8].kind === 'cardPayment' &&
    semanticParsed[8].cardPaymentSide === 'receipt',
  JSON.stringify(semanticParsed));
const semanticPlan = buildImportPlan(
  semanticParsed,
  BASE,
  Math.max(...semanticMessages.map((message) => message.ts)),
  NOW,
);
const semanticBatch = materializeImportBatch(
  semanticPlan.batch,
  BASE,
  (prefix) => `semantic-${prefix}-${++id}`,
);
const semanticState = applyMaterializedImportBatch(BASE, semanticBatch);
const semanticSummary = summarizeMonth(semanticState.transactions, month);
const semanticCashOut = summarizeCashOutflow(semanticState, month);
ok('semantic meanings produce one reconciled set of income, spending and cash movement',
  semanticSummary.incomeFils === 887500 && semanticSummary.expenseFils === 196000 &&
    semanticCashOut.totalFils === 286000 && semanticCashOut.cardPaymentsFils === 90000 &&
    semanticCashOut.accountOutflowFils === 196000,
  JSON.stringify({ semanticSummary, semanticCashOut, rows: semanticState.transactions }));
const semanticReplayPlan = buildImportPlan(
  semanticParsed,
  semanticState,
  Math.max(...semanticMessages.map((message) => message.ts)),
  NOW,
);
const semanticReplayBatch = materializeImportBatch(
  semanticReplayPlan.batch,
  semanticState,
  (prefix) => `semantic-replay-${prefix}-${++id}`,
);
ok('semantic accounting replay is idempotent',
  isDeepStrictEqual(
    applyMaterializedImportBatch(semanticState, semanticReplayBatch),
    semanticState,
  ));

// Compact bank shorthand must cross the same launch and accounting boundary.
// These deliberately use field-list order, abbreviations and no prose. The
// semantic matrix proves each interpretation in isolation; this block proves
// that import, account resolution, transfer exclusion and cash-out reporting
// preserve those meanings together.
const compactMessages = [
  ['FAB', 'SAL PAY AED 7,500.00 CR TO AC 0004'],
  ['FAB', 'TALABAT PAYOUT AED 1,250.00 CR TO A/C 0004'],
  ['Liv', 'OWN A/C TRF AED 5,000.00 DR A/C 0002 CR A/C 0004'],
  ['Liv', 'TRF AED 700.00 DR A/C 0002 BEN AHMED'],
  ['FAB', 'POS AED 47.99 DR CARD 5444 CANVA'],
  ['FAB', 'CC 5444 CR AED 900.00 CARD PYMT RECEIVED'],
  ['FAB', 'BILLPAY AED 410.00 DR A/C 0002 SEWA CONSUMER 9999'],
  ['Liv', 'ATM WDL AED 600.00 DR A/C 0002'],
  ['FAB', 'ANNUAL FEE DR AED 250.00 CARD 5444'],
  ['FAB', 'REFUND CR AED 125.00 TO CARD 5444'],
].map(([sender, body], index) => ({
  id: 301 + index,
  ts: Date.parse('2026-08-12T11:00:00Z') + index,
  sender,
  body,
}));
const compactSession = createLaunchAlertSession({
  overrides: {}, pinnedCurrency: 'AED', activeMarket: 'AE',
});
const compactParsed = compactMessages.flatMap((message) => {
  const inspection = compactSession.inspect(message.body, message.sender);
  const result = compactSession.parse(message.body, message.sender, inspection);
  return result ? [{
    ...result,
    date: result.date ?? new Date(message.ts).toISOString().slice(0, 10),
    smsTs: message.ts,
    sender: message.sender,
    channel: 'inbox',
    sourceEventId: `a${message.id}`,
  }] : [];
});
ok('every compact bank shorthand alert survives the launch parser',
  compactParsed.length === compactMessages.length, compactParsed.length);
ok('compact meanings retain their accounting roles before import',
  compactParsed[0].type === 'income' && compactParsed[0].categoryGuess === 'salary' &&
    compactParsed[1].type === 'income' && compactParsed[1].categoryGuess === 'business' &&
    compactParsed[2].transferHint === true && compactParsed[3].transferHint === false &&
    compactParsed[4].type === 'expense' && compactParsed[4].transferHint === false &&
    compactParsed[5].kind === 'cardPayment' && compactParsed[5].cardPaymentSide === 'receipt' &&
    compactParsed[6].categoryGuess === 'utilities' &&
    compactParsed[6].paymentFlowSide === 'receipt' &&
    compactParsed[7].categoryGuess === 'cash-withdrawal' &&
    compactParsed[8].merchant === 'Annual card fee' &&
    compactParsed[9].type === 'income' && compactParsed[9].merchant === 'Refund');
const compactPlan = buildImportPlan(
  compactParsed,
  BASE,
  Math.max(...compactMessages.map((message) => message.ts)),
  NOW,
);
const compactBatch = materializeImportBatch(
  compactPlan.batch,
  BASE,
  (prefix) => `compact-${prefix}-${++id}`,
);
const compactState = applyMaterializedImportBatch(BASE, compactBatch);
const compactSummary = summarizeMonth(compactState.transactions, month);
const compactCashOut = summarizeCashOutflow(compactState, month);
ok('compact bank shorthand produces exact income, spending and cash-out totals',
  compactSummary.incomeFils === 887500 && compactSummary.expenseFils === 200799 &&
    compactCashOut.totalFils === 261000 && compactCashOut.cardPaymentsFils === 90000 &&
    compactCashOut.accountOutflowFils === 171000,
  JSON.stringify({ compactSummary, compactCashOut }));
const compactReplayPlan = buildImportPlan(
  compactParsed,
  compactState,
  Math.max(...compactMessages.map((message) => message.ts)),
  NOW,
);
const compactReplayBatch = materializeImportBatch(
  compactReplayPlan.batch,
  compactState,
  (prefix) => `compact-replay-${prefix}-${++id}`,
);
ok('compact bank shorthand replay is idempotent',
  isDeepStrictEqual(
    applyMaterializedImportBatch(compactState, compactReplayBatch),
    compactState,
  ));

// A preview can outlive a restore or currency selection. Validate the same
// parsed-money proof again where the actual ledger mutation happens.
{
  const materialized = materializeImportBatch(plan.batch, BASE, (prefix) => `money-${prefix}`);
  ok('materialization preserves the parser-validated batch currency and exponent',
    materialized.importMoney?.currency === 'AED' && materialized.importMoney?.exponent === 2);
  for (const [currency, exponent] of [['USD', 2], ['KWD', 3], ['JPY', 0], ['SAR', 2], ['AED', 3]]) {
    const target = { ...BASE, ledgerMoney: { schemaVersion: 2, currency, exponent } };
    assert.throws(() => applyMaterializedImportBatch(target, materialized), /currency|money/i);
    ok(`${currency}/${exponent}: a stale import preview cannot mutate a differently denominated ledger`,
      target.transactions.length === 0);
  }
  const unproven = { ...materialized }; delete unproven.importMoney;
  assert.throws(() => applyMaterializedImportBatch(BASE, unproven), /currency|money/i);
  ok('monetary batches without denomination evidence fail closed', BASE.transactions.length === 0);
  const fresh = applyMaterializedImportBatch({ ...BASE, ledgerMoney: null }, materialized);
  ok('first accepted batch pins its explicit currency rather than a display preference',
    fresh.ledgerMoney?.currency === 'AED' && fresh.ledgerMoney?.exponent === 2);
}

// Empty progress writes are not evidence of a money system, even if a
// caller accidentally retains a previous preview's metadata.
{
  for (const importMoney of [undefined,
    { schemaVersion: 2, currency: 'AED', exponent: 2 },
    { schemaVersion: 2, currency: 'USD', exponent: 2 },
    { schemaVersion: 2, currency: 'AED', exponent: 3 },
    { schemaVersion: 2, currency: 'UNKNOWN', exponent: 8 }]) {
    const input = { transactions: [], newAccounts: [], newHints: {}, newDues: [],
      newBills: [], snapshots: {}, bankNames: {}, cardTypes: {}, updates: [],
      lastScanTs: 1234, importMoney };
    const materialized = materializeImportBatch(input, BASE, (prefix) => `cursor-${prefix}`);
    const empty = { ...BASE, ledgerMoney: null };
    const result = applyMaterializedImportBatch(empty, materialized);
    ok('cursor-only metadata never pins a new ledger currency',
      result.ledgerMoney === null && result.lastScanTs === 1234 && result.transactions.length === 0,
      JSON.stringify({ importMoney, ledgerMoney: result.ledgerMoney }));
    const pinned = { ...BASE, ledgerMoney: { schemaVersion: 2, currency: 'SAR', exponent: 2 } };
    const sameLedger = applyMaterializedImportBatch(pinned, materialized);
    ok('cursor-only metadata never replaces a pinned ledger currency',
      sameLedger.ledgerMoney === pinned.ledgerMoney && sameLedger.lastScanTs === 1234);
  }
}

// Tracking a reminder is a monetary import too. Reuse the existing golden
// bill row; the body-free SAR variant exercises transport denomination only,
// not a claim of a new Saudi bank format.
{
  const { buildTrackedBillBatch } = require('./build/import-plan.js');
  ok('independent bill tracking has a currency-validated import boundary', typeof buildTrackedBillBatch === 'function');
  const reminder = parsed.find((row) => row.kind === 'billDue');
  const sarReminder = { ...reminder, raw: undefined, currency: 'SAR' };
  const blank = { ...BASE, ledgerMoney: null, lastScanTs: 445 };
  const tracked = buildTrackedBillBatch(sarReminder, blank, NOW);
  ok('tracking only adds the selected bill and preserves its currency without moving the scan cursor',
    tracked.importMoney.currency === 'SAR' && tracked.importMoney.exponent === 2 &&
      tracked.newBills.length === 1 && tracked.newBills[0].amountFils === reminder.amountFils &&
      tracked.transactions.length === 0 && tracked.updates.length === 0 &&
      tracked.newAccounts.length === 0 && Object.keys(tracked.snapshots).length === 0 &&
      tracked.lastScanTs === 445);
  const materialized = materializeImportBatch(tracked, blank, (prefix) => `tracked-${prefix}`);
  const result = applyMaterializedImportBatch(blank, materialized);
  ok('the first tracked reminder pins its explicit currency rather than default AED',
    result.ledgerMoney.currency === 'SAR' && result.bills[0].amountFils === reminder.amountFils);
  const restored = { ...BASE, ledgerMoney: { schemaVersion: 2, currency: 'KWD', exponent: 3 } };
  assert.throws(() => buildTrackedBillBatch(reminder, restored, NOW), /currency|money/i);
  assert.throws(() => applyMaterializedImportBatch(restored, materialized), /currency|money/i);
  ok('a stale tracked reminder cannot be relabelled into a restored KWD ledger', restored.bills.length === 0);
}

// A yearless statement must not acquire its deadline from Message receipt
// time. Exercise both real source-free capture wrappers and the reducer.
{
  const { parseHistoricalMessageRecords } = require('./build/historical-import.js');
  const { parseLocalMessageRecord } = require('./build/local-message-record.js');
  const body = 'Your Credit Card ending 4821 statement is generated. Total due AED 3,240.00, minimum due AED 162.00. Payment due on 25 Aug.';
  const observedAt = '2026-08-10T10:00:00.000Z';
  const now = new Date(observedAt);
  const history = parseHistoricalMessageRecords([JSON.stringify({
    v: 1, id: 'e'.repeat(64), text: body, sender: 'ENBD', receivedAt: observedAt,
  })], {}, now);
  const local = parseLocalMessageRecord(JSON.stringify({
    v: 1, id: 'f'.repeat(64), text: body, sender: 'ENBD', observedAt, source: 'message',
  }), now, 'AE', createLaunchAlertSession({ overrides: {}, pinnedCurrency: 'AED' }));
  for (const [channel, row] of [['historical', history.parsed[0]], ['local live', local.row]]) {
    ok(`${channel}: a yearless statement retains an unknown full deadline`,
      row?.kind === 'cardStatement' && row.date === null, JSON.stringify(row));
    const plan = buildImportPlan([row], BASE, now.getTime(), now);
    let nextId = 0;
    const batch = materializeImportBatch(plan.batch, BASE, (prefix) => `deadline-${prefix}-${nextId++}`);
    const result = applyMaterializedImportBatch(BASE, batch);
    ok(`${channel}: Message receipt cannot create a fabricated card payment deadline`,
      result.cardDues.length === BASE.cardDues.length && plan.txCount === 0);
  }
}

console.log(`\naccounting-pipeline: ${pass} passed, 0 failed`);

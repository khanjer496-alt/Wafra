/**
 * Heavy-ledger stress for the Android JS thread.
 *
 * The tester diagnostic (14,781 rows, 44 accounts, ~30k SMS) is the size that
 * actually ships after a full inbox import. Unit tests hide that cost. This
 * suite builds a newest-first 15,000-row ledger and times every hot path that
 * painted as a stall: Home totals, Home insight, Wallet, Flow's 8-row preview,
 * recurrence, transfer receipts, and a 128-row capture page.
 *
 * Numbers are Node, not Hermes. Absolute budgets are therefore loose. The
 * relative gates are the real protection: a current-month pass that is no
 * faster than an all-history pass means the newest-first early-exit is gone,
 * and that is exactly the 157ms Home hitch.
 */
'use strict';
const insights = require('./build/insights');
const fmt = require('./build/format');
const cards = require('./build/cards');
const balances = require('./build/balances');
const ledger = require('./build/ledger');
const parser = require('./build/sms-parser');
const subscriptions = require('./build/subscriptions');
const leavingSoon = require('./build/leaving-soon');
const periodLib = require('./build/period');
const transfers = require('./build/transfer-reconciliation');
const billsLib = require('./build/bills');
const dailySummary = require('./build/daily-summary');
const reminders = require('./build/reminders');
const corpus = require('./fixtures/uae-bank-formats');

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`✓ ${name}`);
  } else {
    fail += 1;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function fastest(fn, runs = 5) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (ms < best) best = ms;
  }
  return best;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Identity caches make a second call free. Clone the arrays that are the cache key. */
function timeCold(run, runs = 3) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const isolated = {
      ...state,
      transactions: state.transactions.slice(),
      accounts: state.accounts.slice(),
    };
    const t0 = process.hrtime.bigint();
    run(isolated);
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return median(samples);
}

const ROW_COUNT = 15_000;
const ACCOUNT_COUNT = 44;
const NOW = new Date(Date.UTC(2026, 8, 20, 12, 0, 0));
const NOW_MS = NOW.getTime();
const MERCHANTS = [
  'Carrefour', 'Starbucks', 'Netflix', 'DEWA', 'Salik',
  'Amazon', 'Noon', 'Etisalat', 'Spinneys', 'Talabat',
];
const CATEGORIES = [
  'groceries', 'dining', 'entertainment', 'utilities', 'transport',
  'shopping', 'shopping', 'telecom', 'groceries', 'dining',
];

function isoDaysAgo(days) {
  const d = new Date(NOW_MS);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function buildLedger(rowCount) {
  const accounts = [];
  for (let i = 0; i < ACCOUNT_COUNT; i++) {
    const credit = i < 12 && i % 3 === 0;
    accounts.push({
      id: `acc-${i}`,
      name: i < 12 ? `Card ${i}` : `Account ${i}`,
      kind: i < 12 ? 'card' : 'bank',
      cardType: i < 12 ? (credit ? 'credit' : 'debit') : undefined,
      last4: String(1000 + i),
      bankName: ['FAB', 'ENBD', 'ADCB', 'Liv'][i % 4],
      openingFils: 0,
      color: '#1F6B52',
      archived: false,
    });
  }
  const transactions = [];
  for (let i = 0; i < rowCount; i++) {
    const dayOffset = Math.floor(i / 14);
    const date = isoDaysAgo(dayOffset);
    const merchantIndex = i % MERCHANTS.length;
    const account = accounts[i % ACCOUNT_COUNT];
    const isIncome = i % 97 === 0;
    const isXfer = !isIncome && i % 17 === 0;
    transactions.push({
      id: `tx-${i}`,
      type: isIncome ? 'income' : 'expense',
      amountFils: isIncome ? 2_000_000 : 1_000 + (i % 50_000),
      category: isIncome ? 'salary' : isXfer ? 'other' : CATEGORIES[merchantIndex],
      accountId: account.id,
      title: isIncome ? 'Salary' : isXfer ? 'Card payment' : MERCHANTS[merchantIndex],
      date,
      ts: NOW_MS - i * 3_600_000,
      source: 'sms',
      isTransfer: isXfer || undefined,
      smsKey: `s${NOW_MS - i}-${1_000 + (i % 50_000)}`,
      fxSource: i < 20 ? 'fallback' : undefined,
      originalCurrency: i < 20 ? 'USD' : undefined,
    });
  }
  for (let month = 0; month < 18; month++) {
    const date = isoDaysAgo(6 + month * 30);
    transactions.push({
      id: `dewa-${month}`,
      type: 'expense',
      amountFils: 28_000,
      category: 'utilities',
      accountId: accounts[0].id,
      title: 'DEWA',
      date,
      ts: NOW_MS - (6 + month * 30) * 86_400_000,
      source: 'sms',
      smsKey: `dewa-${month}`,
    });
    transactions.push({
      id: `etisalat-${month}`,
      type: 'expense',
      amountFils: 12_500,
      category: 'telecom',
      accountId: accounts[0].id,
      title: 'Etisalat',
      date,
      ts: NOW_MS - (6 + month * 30) * 86_400_000 + 1,
      source: 'sms',
      smsKey: `etisalat-${month}`,
    });
  }
  transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const cardDues = accounts
    .filter((account) => account.cardType === 'credit')
    .map((account) => ({
      id: `due-${account.id}`,
      accountId: account.id,
      totalDueFils: 120_000,
      minDueFils: 12_000,
      dueDate: '2026-09-28',
      paidFils: 0,
    }));
  const state = {
    hydrated: true,
    onboarded: true,
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
    reviewTray: { pending: [], declined: [] },
    accounts,
    transactions,
    budgets: [],
    bills: [
      { id: 'bill-dewa', title: 'DEWA', amountFils: 28_000, category: 'utilities', dueDay: 15, paidMonths: [] },
      { id: 'bill-etisalat', title: 'Etisalat', amountFils: 12_500, category: 'telecom', dueDay: 5, paidMonths: [] },
      { id: 'bill-rent', title: 'Rent', amountFils: 550_000, category: 'rent', dueDay: 1, paidMonths: [] },
    ],
    cardDues,
    statementCoverage: [],
    goals: [],
    onboardingPlan: null,
    onboardingProfile: null,
    onboardingCurrencyEvidence: null,
    merchantOverrides: {},
    billAliases: {},
    accountHints: {},
    trustedNotificationPackages: [],
    notSubscriptions: [],
    lastScanTs: NOW_MS,
    historyImport: { status: 'complete' },
    transferNormalizationVersion: transfers.TRANSFER_NORMALIZATION_VERSION,
    transferInternalIds: [],
    monthStartDay: 1,
    marketId: 'AE',
    language: 'en',
    parserVersion: 51,
  };
  return state;
}

const parseBodies = corpus
  .filter((row) => typeof row.body === 'string' && row.body.length > 20)
  .map((row) => row.body)
  .slice(0, 12);
if (parseBodies.length === 0) {
  parseBodies.push(
    'Purchase of AED 89.50 with Credit Card ending 4844 at CARREFOUR, DUBAI. Avl Cr. Limit AED 14,671.30',
  );
}

console.log(`building ${ROW_COUNT} newest-first rows across ${ACCOUNT_COUNT} accounts…`);
fmt.setMonthStartDay(1);
const state = buildLedger(ROW_COUNT);
const period = { mode: 'month', key: '2026-09' };
const live = ledger.liveAccountIds(state.accounts);
const internal = ledger.internalTransferIdsForState(state);

ok('fixture is newest-first and the tester-scale size',
  state.transactions.length >= ROW_COUNT &&
    state.accounts.length === ACCOUNT_COUNT &&
    state.transactions[0].date >= state.transactions[state.transactions.length - 1].date,
  `${state.transactions.length} rows, first ${state.transactions[0].date}, last ${state.transactions[state.transactions.length - 1].date}`);

const septemberOnly = state.transactions.filter((tx) => tx.date.startsWith('2026-09'));
ok('September 2026 is a small slice of a 15k history',
  septemberOnly.length > 50 && septemberOnly.length < 2_000,
  `${septemberOnly.length} September rows`);

const monthMs = timeCold((isolated) => insights.summarizeMonth(isolated.transactions, period, live, internal));
const allMs = timeCold((isolated) => insights.summarizeMonth(isolated.transactions, 'all', live, internal));
const monthTotal = insights.summarizeMonth(state.transactions, period, live, internal);
const septemberTotal = insights.summarizeMonth(septemberOnly, period, live, internal);

ok('current-month summary matches a September-only ledger',
  monthTotal.expenseFils === septemberTotal.expenseFils &&
    monthTotal.incomeFils === septemberTotal.incomeFils,
  `full ${monthTotal.expenseFils}/${monthTotal.incomeFils} vs slice ${septemberTotal.expenseFils}/${septemberTotal.incomeFils}`);

ok('newest-first current-month summary is much cheaper than an all-history walk',
  monthMs * 2.5 < allMs || (monthMs < 2 && allMs < 8),
  `month ${monthMs.toFixed(2)}ms vs all ${allMs.toFixed(2)}ms — early-exit is gone if a cold month pass costs as much as all-history`);

ok('current-month 15k summary stays inside one long frame on Node',
  monthMs < 80,
  `${monthMs.toFixed(2)}ms`);

ok('all-history 15k summary stays bounded on Node',
  allMs < 400,
  `${allMs.toFixed(2)}ms`);

const shuffled = [...state.transactions].sort((a, b) => (a.id < b.id ? -1 : 1));
const shuffledMonth = insights.summarizeMonth(shuffled, period, live, internal);
ok('a non-newest-first ledger still totals the same month (early-exit disabled, not wrong)',
  shuffledMonth.expenseFils === monthTotal.expenseFils &&
    shuffledMonth.incomeFils === monthTotal.incomeFils);

const insightMs = timeCold((isolated) =>
  insights.buildInsights(isolated.transactions, isolated.budgets, period, NOW, isolated.notSubscriptions, live, internal, { includeRecurringAnalysis: false }));
ok('Home insight without recurrence stays inside two long frames on Node',
  insightMs < 150,
  `${insightMs.toFixed(2)}ms`);

const homeWalkMs = fastest(() => {
  const rows = [];
  for (const transaction of state.transactions) {
    if (ledger.countsInCashflowTotals(transaction, live, internal) && periodLib.inPeriod(transaction.date, period)) {
      rows.push(transaction);
      if (rows.length === 6) break;
    }
  }
  return rows;
});
ok('Home activity preview stops after six matches instead of copying the month',
  homeWalkMs < 40,
  `${homeWalkMs.toFixed(2)}ms`);

const previewLimit = 8;
const previewMs = fastest(() => {
  const out = [];
  let previousDate = null;
  let newestFirst = true;
  let seenInPeriod = false;
  for (const tx of state.transactions) {
    if (newestFirst && previousDate !== null && tx.date > previousDate) newestFirst = false;
    previousDate = tx.date;
    const inside = periodLib.inPeriod(tx.date, period);
    if (!inside) {
      if (seenInPeriod && newestFirst) break;
      continue;
    }
    seenInPeriod = true;
    if (!ledger.isSpending(tx, live, internal)) continue;
    out.push(tx);
    if (out.length >= previewLimit) break;
  }
  return out;
});
const fullFilterMs = fastest(() =>
  state.transactions.filter((tx) => ledger.isSpending(tx, live, internal) && periodLib.inPeriod(tx.date, period)));
ok('Flow 8-row preview is much cheaper than filtering the whole period',
  previewMs * 2 < fullFilterMs,
  `preview ${previewMs.toFixed(2)}ms vs filter ${fullFilterMs.toFixed(2)}ms`);

const balanceMs = timeCold((isolated) => balances.netWorthBreakdown(isolated));
const balanceAgain = fastest(() => balances.netWorthBreakdown(state));
ok('Wallet balances scan 15k rows inside one long frame',
  balanceMs < 80,
  `${balanceMs.toFixed(2)}ms`);
ok('Wallet balances cache hits on the same immutable arrays',
  balanceAgain * 8 < balanceMs || balanceAgain < 1,
  `first ${balanceMs.toFixed(2)}ms, cached ${balanceAgain.toFixed(2)}ms`);

const duesMs = fastest(() => cards.openDues(state, NOW));
ok('Wallet open dues stay cheap on 15k rows',
  duesMs < 80,
  `${duesMs.toFixed(2)}ms`);

const reissueFirst = timeCold((isolated) => cards.reissueSuggestions(isolated, NOW));
const reissueCached = fastest(() => cards.reissueSuggestions(state, NOW));
ok('Wallet reissue first pass stays bounded',
  reissueFirst < 150,
  `${reissueFirst.toFixed(2)}ms`);
ok('Wallet reissue suggestions cache the immutable ledger snapshot',
  reissueCached * 8 < reissueFirst || reissueCached < 1,
  `first ${reissueFirst.toFixed(2)}ms, cached ${reissueCached.toFixed(2)}ms`);

const upcomingMs = fastest(() => leavingSoon.leavingSoon(state, NOW, { withinDays: 9, kinds: ['card', 'bill'] }));
ok('Home upcoming cards/bills stay inside one long frame after month-windowing',
  upcomingMs < 40,
  `${upcomingMs.toFixed(2)}ms`);

const billsCold = timeCold((isolated) => billsLib.billsForMonth(isolated.bills, isolated.transactions, NOW, live, internal));
const billsCached = fastest(() => billsLib.billsForMonth(state.bills, state.transactions, NOW, live, internal));
const billRows = billsLib.billsForMonth(state.bills, state.transactions, NOW, live, internal);
const dewa = billRows.find((row) => row.bill.id === 'bill-dewa');
const rent = billRows.find((row) => row.bill.id === 'bill-rent');
ok('September DEWA charge still settles the bill on a 15k newest-first ledger',
  dewa && dewa.status === 'paid');
ok('Rent without a matching charge stays unpaid',
  rent && rent.status !== 'paid');
ok('Bills month window stays inside one long frame on Node',
  billsCold < 40,
  `${billsCold.toFixed(2)}ms`);
ok('Bills month projection caches the immutable ledger/day',
  billsCached * 8 < billsCold || billsCached < 1,
  `first ${billsCold.toFixed(2)}ms, cached ${billsCached.toFixed(2)}ms`);

const shuffledBills = [...state.transactions].sort((a, b) => (a.date < b.date ? -1 : 1));
const shuffledBillRows = billsLib.billsForMonth(state.bills, shuffledBills, NOW, live, internal);
ok('newest-first month window settles the same bills as a full oldest-first scan',
  billRows.map((row) => `${row.bill.id}:${row.status}`).join(',') ===
    shuffledBillRows.map((row) => `${row.bill.id}:${row.status}`).join(','));

const summaryMs = timeCold((isolated) => dailySummary.buildDailySummary(isolated, '2026-09-20'));
ok('daily summary stops after leaving today on a newest-first ledger',
  summaryMs < 20,
  `${summaryMs.toFixed(2)}ms`);

const reminderMs = fastest(() => reminders.buildPaymentReminders(state, NOW, 12, []), 3);
ok('reminder plan with supplied recurrences does not rescan 15k rows for subscriptions',
  reminderMs < 40,
  `${reminderMs.toFixed(2)}ms`);

const transferReceiptMs = fastest(() => ledger.internalTransferIdsForState(state));
ok('transfer ids with a persisted receipt stay O(1) on 15k rows',
  transferReceiptMs < 20,
  `${transferReceiptMs.toFixed(2)}ms`);

const noReceipt = { ...state, transferInternalIds: undefined, transferNormalizationVersion: undefined };
const transferRebuildMs = fastest(() => ledger.internalTransferIdsForState(noReceipt), 1);
ok('rebuilding the transfer graph on 15k rows is maintenance, not a tab press',
  transferRebuildMs < 2_500,
  `${transferRebuildMs.toFixed(2)}ms — if this is multi-second, a missed receipt freezes launch`);

const subsMs = fastest(() =>
  subscriptions.detectSubscriptions(state.transactions, state.notSubscriptions, NOW, live, internal), 1);
ok('synchronous recurrence on 15k rows stays off the render path and finishes',
  subsMs < 2_500,
  `${subsMs.toFixed(2)}ms`);

function parsePage(size) {
  let parsed = 0;
  for (let i = 0; i < size; i++) {
    const body = parseBodies[i % parseBodies.length];
    const result = parser.parseSms(body);
    if (result) parsed += 1;
  }
  return parsed;
}
const parse128 = fastest(() => parsePage(128), 3);
const parse1000 = fastest(() => parsePage(1_000), 1);
ok('a 128-row routine capture page parses without monopolising Node',
  parse128 < 250,
  `${parse128.toFixed(2)}ms`);
ok('a 1,000-row capture page is the slow path we no longer take on the UI',
  parse1000 < 2_000 && parse128 * 4 < parse1000,
  `128 → ${parse128.toFixed(2)}ms, 1000 → ${parse1000.toFixed(2)}ms`);

const fxPendingMs = fastest(() => {
  const pending = [];
  for (const transaction of state.transactions) {
    if (transaction.fxSource !== 'fallback') continue;
    pending.push(transaction);
    if (pending.length === 16) break;
  }
  return pending;
});
const fxFilterMs = fastest(() =>
  state.transactions.filter((transaction) => transaction.fxSource === 'fallback').slice(0, 16));
ok('FX repair stops after 16 fallback rows instead of filtering 15k',
  fxPendingMs * 2 < fxFilterMs || fxPendingMs < 0.5,
  `early-break ${fxPendingMs.toFixed(2)}ms vs filter ${fxFilterMs.toFixed(2)}ms`);

console.log('\n--- 15k timings (Node, fastest of repeats) ---');
console.log(`  summarizeMonth month     ${monthMs.toFixed(2)} ms`);
console.log(`  summarizeMonth all       ${allMs.toFixed(2)} ms`);
console.log(`  home insight             ${insightMs.toFixed(2)} ms`);
console.log(`  home 6-row walk          ${homeWalkMs.toFixed(2)} ms`);
console.log(`  flow 8-row preview       ${previewMs.toFixed(2)} ms`);
console.log(`  flow full filter         ${fullFilterMs.toFixed(2)} ms`);
console.log(`  wallet balances          ${balanceMs.toFixed(2)} ms (cached ${balanceAgain.toFixed(2)})`);
console.log(`  wallet dues              ${duesMs.toFixed(2)} ms`);
console.log(`  wallet reissues          ${reissueFirst.toFixed(2)} ms (cached ${reissueCached.toFixed(2)})`);
console.log(`  upcoming cards/bills     ${upcomingMs.toFixed(2)} ms`);
console.log(`  billsForMonth            ${billsCold.toFixed(2)} ms (cached ${billsCached.toFixed(2)})`);
console.log(`  daily summary            ${summaryMs.toFixed(2)} ms`);
console.log(`  payment reminders        ${reminderMs.toFixed(2)} ms`);
console.log(`  transfer receipt         ${transferReceiptMs.toFixed(2)} ms`);
console.log(`  transfer rebuild         ${transferRebuildMs.toFixed(2)} ms`);
console.log(`  detectSubscriptions      ${subsMs.toFixed(2)} ms`);
console.log(`  parseSms 128             ${parse128.toFixed(2)} ms`);
console.log(`  parseSms 1000            ${parse1000.toFixed(2)} ms`);

console.log(`\nledger-stress: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

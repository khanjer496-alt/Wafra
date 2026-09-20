'use strict';
/**
 * Heavy host stress of the screens that froze on the 14,781-row OnePlus
 * diagnostic (CPH2653, build 318). This is Node, not Hermes, so budgets are
 * algorithmic guards: they catch a full-history walk coming back, not a
 * 16 ms frame on that phone.
 *
 * Shape matches the report: 44 accounts, 14,781 newest-first SMS rows over
 * ~3 years, credit cards with statements, a handful of bills, transfer
 * receipt present so UI totals do not rebuild the graph.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('module');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const originalResolveFilename = Module._resolveFilename;
const originalTsLoader = require.extensions['.ts'];

require.extensions['.ts'] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

Module._resolveFilename = function resolveWafraAlias(request, parent, isMain, options) {
  if (request.startsWith('@/lib/')) {
    const filename = path.join(root, 'src/lib', `${request.slice('@/lib/'.length)}.ts`);
    return originalResolveFilename.call(this, filename, parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const { projectDashboard, projectDashboardInsight } = require('../../src/lib/dashboard-projection.ts');
const { summarizeMonth, buildInsights } = require('../../src/lib/insights.ts');
const { netWorthBreakdown } = require('../../src/lib/balances.ts');
const { openDues, reissueSuggestions, isInactiveAccount } = require('../../src/lib/cards.ts');
const { detectSubscriptions } = require('../../src/lib/subscriptions.ts');
const { leavingSoon } = require('../../src/lib/leaving-soon.ts');
const { hasRecapActivity, recapCandidates } = require('../../src/lib/recap.ts');
const { liveAccountIds, internalTransferIdsForState, isSpending } = require('../../src/lib/ledger.ts');
const { inPeriod } = require('../../src/lib/period.ts');
const { setMonthStartDay } = require('../../src/lib/format.ts');
const { setActiveMarket, setLedgerCurrency } = require('../../src/lib/markets.ts');
const { TRANSFER_NORMALIZATION_VERSION } = require('../../src/lib/transfer-reconciliation.ts');
const { parseSms } = require('../../src/lib/sms-parser.ts');

Module._resolveFilename = originalResolveFilename;
if (originalTsLoader) require.extensions['.ts'] = originalTsLoader;
else delete require.extensions['.ts'];

const ROW_COUNT = 14_781;
const ACCOUNT_COUNT = 44;
const NOW = new Date('2026-09-20T12:00:00Z');
const PERIOD = { mode: 'month', key: '2026-09' };
const CATEGORIES = [
  'groceries', 'dining', 'transport', 'shopping', 'health', 'entertainment',
  'utilities', 'telecom', 'software', 'other',
];
const RECURRING = [
  { title: 'Netflix', category: 'entertainment', amount: 49_00 },
  { title: 'Spotify', category: 'entertainment', amount: 19_99 },
  { title: 'DEWA', category: 'utilities', amount: 280_00 },
  { title: 'Etisalat', category: 'telecom', amount: 125_00 },
  { title: 'Salik', category: 'transport', amount: 50_00 },
];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const measure = (fn, runs = 5) => {
  fn();
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    fn();
    samples.push(performance.now() - started);
  }
  return { median: median(samples), max: Math.max(...samples), samples };
};

const isoDaysAgo = (days) =>
  new Date(Date.UTC(2026, 8, 20) - days * 86_400_000).toISOString().slice(0, 10);

function buildLedger() {
  const accounts = Array.from({ length: ACCOUNT_COUNT }, (_, index) => {
    const credit = index < 8;
    return {
      id: `account-${index}`,
      name: credit ? `Card ${index}` : `Account ${index}`,
      kind: credit ? 'card' : 'bank',
      cardType: credit ? 'credit' : undefined,
      bankName: index % 3 === 0 ? 'Emirates NBD' : index % 3 === 1 ? 'ADCB' : 'FAB',
      last4: String(1000 + index),
      openingFils: 0,
      color: '#1F6B52',
      archived: index === ACCOUNT_COUNT - 1,
      snapshotKind: credit ? 'outstanding' : 'balance',
      snapshotFils: credit ? 120_000 + index * 1000 : 500_000,
    };
  });

  const transactions = [];
  for (let index = 0; index < ROW_COUNT; index++) {
    const daysAgo = Math.floor(index / 14);
    const transfer = index % 11 === 0;
    const income = !transfer && index % 23 === 0;
    transactions.push({
      id: `row-${index}`,
      date: isoDaysAgo(daysAgo),
      ts: Date.UTC(2026, 8, 20, 12) - index * 3_600_000,
      title: transfer ? 'Outgoing transfer' : income ? 'Salary' : `Merchant ${index % 900}`,
      amountFils: 100 + (index % 8_000),
      category: income ? 'salary' : transfer ? 'other' : CATEGORIES[index % CATEGORIES.length],
      type: income ? 'income' : 'expense',
      accountId: `account-${index % (ACCOUNT_COUNT - 1)}`,
      source: 'sms',
      smsKey: `s${1_700_000_000_000 + index}-${index}`,
      isTransfer: transfer || undefined,
      viaPush: index < 7 || undefined,
    });
  }
  for (const rec of RECURRING) {
    for (let month = 0; month < 18; month++) {
      transactions.push({
        id: `rec-${rec.title}-${month}`,
        date: isoDaysAgo(6 + month * 30),
        ts: Date.UTC(2026, 8, 20, 12) - (6 + month * 30) * 86_400_000,
        title: rec.title,
        amountFils: rec.amount,
        category: rec.category,
        type: 'expense',
        accountId: 'account-0',
        source: 'sms',
        smsKey: `rec-${rec.title}-${month}`,
      });
    }
  }
  transactions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const cardDues = accounts.filter((account) => account.cardType === 'credit').slice(0, 4).map((account, index) => ({
    id: `due-${account.id}`,
    accountId: account.id,
    dueDate: '2026-09-28',
    totalDueFils: 80_000 + index * 5_000,
    minDueFils: 8_000,
    paidFils: 0,
  }));

  const bills = [
    { id: 'bill-dewa', title: 'DEWA', amountFils: 280_00, category: 'utilities', dueDay: 15, paidMonths: [] },
    { id: 'bill-etisalat', title: 'Etisalat', amountFils: 125_00, category: 'telecom', dueDay: 5, paidMonths: [] },
    { id: 'bill-rent', title: 'Rent', amountFils: 5500_00, category: 'rent', dueDay: 1, paidMonths: [] },
  ];

  return {
    hydrated: true,
    onboarded: true,
    accounts,
    transactions,
    bills,
    cardDues,
    budgets: [{ id: 'dining', category: 'dining', limitFils: 200_000 }],
    goals: [],
    merchantOverrides: {},
    accountHints: {},
    notSubscriptions: [],
    lastScanTs: Date.UTC(2026, 8, 20, 12),
    historyImport: { status: 'complete' },
    transferNormalizationVersion: TRANSFER_NORMALIZATION_VERSION,
    transferInternalIds: [],
    monthStartDay: 1,
    marketId: 'AE',
    language: 'en',
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 },
    reviewTray: { pending: [] },
    privateMode: false,
    captureOptOut: false,
  };
}

const FAB_PURCHASE = 'Purchase of AED 25.00 with Debit Card ending 1234 at STARBUCKS, DUBAI.';

test('14.7k-row Home, Wallet, Flow and Bills projections stay bounded', () => {
  setLedgerCurrency(null);
  setActiveMarket('AE');
  setMonthStartDay(1);

  const state = buildLedger();
  assert.equal(state.accounts.length, ACCOUNT_COUNT);
  assert.ok(state.transactions.length >= ROW_COUNT);
  assert.ok(state.transactions[0].date >= state.transactions[ROW_COUNT - 1].date,
    'fixture must be newest-first like the persisted ledger');

  const live = liveAccountIds(state.accounts);
  const internal = internalTransferIdsForState(state);
  const report = {};
  const timeOnce = (fn) => {
    const started = performance.now();
    const value = fn();
    return { value, ms: performance.now() - started };
  };
  const isolate = () => ({ ...state, transactions: state.transactions.slice() });
  const cold = (label, fn, budget) => {
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const isolated = isolate();
      samples.push(timeOnce(() => fn(isolated)).ms);
    }
    const ms = median(samples);
    report[label] = +ms.toFixed(2);
    assert.ok(ms < budget, `${label} ${ms.toFixed(1)}ms (budget ${budget}ms)`);
    return ms;
  };

  cold('summarizeMonthColdMs', (isolated) =>
    summarizeMonth(isolated.transactions, PERIOD, live, internal), 15);

  const julyOnly = state.transactions.filter((row) => row.date.startsWith('2026-09'));
  const windowed = summarizeMonth(state.transactions, PERIOD, live, internal);
  const sliced = summarizeMonth(julyOnly, PERIOD, live, internal);
  assert.equal(windowed.expenseFils, sliced.expenseFils,
    'newest-first early-exit must total the same money as a September-only ledger');

  cold('homeDashboardColdMs', (isolated) => projectDashboard({
    state: isolated, period: PERIOD, now: NOW, surface: 'home',
    includeInsights: false, includeCleanupPrompts: false,
  }), 80);
  const painted = projectDashboard({
    state, period: PERIOD, now: NOW, surface: 'home',
    includeInsights: false, includeCleanupPrompts: false,
  });
  assert.ok(painted.activityRows.length <= 6);
  assert.ok(painted.hero.expenseFils > 0);
  const dashboardCached = measure(() => projectDashboard({
    state, period: PERIOD, now: NOW, surface: 'home',
    includeInsights: false, includeCleanupPrompts: false,
  }));
  report.homeDashboardCachedMs = +dashboardCached.median.toFixed(2);
  assert.ok(dashboardCached.median < 8, `cached home dashboard ${dashboardCached.median.toFixed(1)}ms`);

  cold('homeInsightColdMs', (isolated) => projectDashboardInsight(isolated, PERIOD, NOW), 25);

  cold('walletBalancesColdMs', (isolated) => netWorthBreakdown(isolated), 30);
  cold('walletDuesColdMs', (isolated) => openDues(isolated, NOW), 15);
  cold('walletReissuesColdMs', (isolated) => reissueSuggestions(isolated, NOW), 40);
  const reissueAgain = measure(() => reissueSuggestions(state, NOW));
  report.walletReissuesCachedMs = +reissueAgain.median.toFixed(2);
  assert.ok(reissueAgain.median < 5, `cached reissues ${reissueAgain.median.toFixed(1)}ms`);

  cold('walletActivityColdMs', (isolated) => {
    const active = [];
    const inactive = [];
    for (const account of isolated.accounts) {
      (isInactiveAccount(isolated, account, NOW) ? inactive : active).push(account);
    }
    let smsCount = 0;
    for (const row of isolated.transactions) if (row.source === 'sms') smsCount += 1;
    return { active, inactive, smsCount };
  }, 30);

  const flowPreview = (rows) => {
    const out = [];
    let previousDate = null;
    let newestFirst = true;
    let seenInPeriod = false;
    for (const tx of rows) {
      if (newestFirst && previousDate !== null && tx.date > previousDate) newestFirst = false;
      previousDate = tx.date;
      const inside = inPeriod(tx.date, PERIOD);
      if (!inside) {
        if (seenInPeriod && newestFirst) break;
        continue;
      }
      seenInPeriod = true;
      if (!isSpending(tx, live, internal)) continue;
      out.push(tx);
      if (out.length >= 8) break;
    }
    return out;
  };
  assert.equal(flowPreview(state.transactions).length, 8);
  cold('flowPreviewColdMs', (isolated) => flowPreview(isolated.transactions), 15);

  cold('leavingSoonColdMs', (isolated) =>
    leavingSoon(isolated, NOW, { withinDays: 9, kinds: ['card', 'bill'] }), 50);

  const recap = measure(() => recapCandidates(NOW).filter((descriptor) =>
    hasRecapActivity(state.transactions, descriptor)));
  report.recapMs = +recap.median.toFixed(2);
  assert.ok(recap.median < 40, `recap eligibility ${recap.median.toFixed(1)}ms`);

  const tabSwitch = isolate();
  const tabStarted = performance.now();
  projectDashboard({
    state: tabSwitch, period: PERIOD, now: NOW, surface: 'home',
    includeInsights: false, includeCleanupPrompts: false,
  });
  projectDashboardInsight(tabSwitch, PERIOD, NOW);
  netWorthBreakdown(tabSwitch);
  openDues(tabSwitch, NOW);
  reissueSuggestions(tabSwitch, NOW);
  leavingSoon(tabSwitch, NOW, { withinDays: 9, kinds: ['card', 'bill'] });
  const tabMs = performance.now() - tabStarted;
  report.allTabsColdMs = +tabMs.toFixed(2);
  assert.ok(tabMs < 120, `first visit to Home+Wallet+Bills ${tabMs.toFixed(1)}ms`);

  const subs = timeOnce(() =>
    detectSubscriptions(state.transactions, state.notSubscriptions, NOW, live, internal));
  report.detectSubscriptionsMs = +subs.ms.toFixed(2);
  assert.ok(subs.value.some((sub) => sub.title === 'Netflix'),
    `expected Netflix recurrence, got ${subs.value.map((sub) => sub.title).join(',') || 'none'}`);
  assert.ok(subs.ms < 150, `sync subscription scan ${subs.ms.toFixed(1)}ms`);

  const cachedSubs = measure(() =>
    detectSubscriptions(state.transactions, state.notSubscriptions, NOW, live, internal));
  report.detectSubscriptionsCachedMs = +cachedSubs.median.toFixed(2);
  assert.ok(cachedSubs.median < 5, `cached subscriptions ${cachedSubs.median.toFixed(1)}ms`);

  let mutated = state;
  const captureBurst = [];
  for (let i = 0; i < 40; i++) {
    const next = {
      ...mutated,
      transactions: [{
        id: `live-${i}`,
        date: '2026-09-20',
        ts: Date.UTC(2026, 8, 20, 18) + i,
        title: 'Live coffee',
        amountFils: 1500,
        category: 'dining',
        type: 'expense',
        accountId: 'account-0',
        source: 'sms',
        smsKey: `live-${i}`,
      }, ...mutated.transactions],
    };
    const started = performance.now();
    projectDashboard({
      state: next, period: PERIOD, now: NOW, surface: 'home',
      includeInsights: false, includeCleanupPrompts: false,
    });
    netWorthBreakdown(next);
    captureBurst.push(performance.now() - started);
    mutated = next;
  }
  const burstMedian = median(captureBurst);
  report.liveCapturePaintMs = +burstMedian.toFixed(2);
  assert.ok(burstMedian < 80, `live capture Home+Wallet paint ${burstMedian.toFixed(1)}ms`);

  const parse = measure(() => {
    for (let i = 0; i < 128; i++) parseSms(FAB_PURCHASE);
  }, 3);
  report.parse128SmsMs = +parse.median.toFixed(2);
  assert.ok(parse.median < 50, `128 FAB parses ${parse.median.toFixed(1)}ms`);

  const shuffled = [...state.transactions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const newestPass = timeOnce(() => summarizeMonth(state.transactions.slice(), PERIOD, live, internal));
  const shuffledPass = timeOnce(() => summarizeMonth(shuffled, PERIOD, live, internal));
  report.newestFirstMonthMs = +newestPass.ms.toFixed(2);
  report.shuffledMonthMs = +shuffledPass.ms.toFixed(2);
  assert.equal(newestPass.value.expenseFils, shuffledPass.value.expenseFils);
  assert.ok(newestPass.ms <= shuffledPass.ms * 1.25 + 8,
    `newest-first ${newestPass.ms.toFixed(1)}ms should not lose to shuffled ${shuffledPass.ms.toFixed(1)}ms`);

  cold('buildInsightsNoRecurringColdMs', (isolated) =>
    buildInsights(isolated.transactions, isolated.budgets, PERIOD, NOW, isolated.notSubscriptions, live, internal, {
      includeRecurringAnalysis: false,
    }), 25);

  console.log(JSON.stringify({
    scope: 'host 14.7k-row UI projections; not Hermes/Android frames',
    rows: ROW_COUNT,
    accounts: ACCOUNT_COUNT,
    runtime: process.version,
    report,
  }));
});

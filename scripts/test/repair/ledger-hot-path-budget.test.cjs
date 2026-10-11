'use strict';
/**
 * Host budgets for every synchronous step a 15k/30k-row ledger runs per screen
 * render, per capture and per launch, plus the cooperative recurrence job.
 *
 * The owner's phone (14,821 rows) froze the JS thread for 3-6 s on each
 * capture: the import path re-ran an O(receipts x purchases) bill-bundle scan,
 * re-validated every stored source identity with several regexes, and planned
 * and applied the batch in one turn; Bills and reminders meanwhile each ran
 * their own recurrence scan, restarted from row zero on every capture. None of
 * that showed in unit tests, which use a handful of rows.
 *
 * Numbers are desktop V8, not Hermes (a phone is ~4-6x slower). Budgets carry
 * generous headroom over measured medians so a busy CI host does not flake;
 * each step is timed as the best of several runs on fresh array identities
 * (the post-capture situation), and linear-scaling checks catch an
 * accidentally quadratic pass that a fixed budget alone could miss.
 *
 * Set WAFRA_HOT_PATH_REPORT=1 to print the measured table.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { hotPathLedger, NOW } = require('../fixtures/hot-path-ledger.cjs');

const BUILD = process.env.WAFRA_HOT_PATH_BUILD ?? path.resolve(__dirname, '../build');
const lib = (name) => require(path.join(BUILD, name));
const markets = lib('markets');
const ledger = lib('ledger');
const tr = lib('transfer-reconciliation');
const li = lib('ledger-import');
const planLib = lib('import-plan');
const parser = lib('sms-parser');
const dedupe = lib('dedupe');
const pf = lib('payment-flow');
const subs = lib('subscriptions');
const dash = lib('dashboard-projection');
const insights = lib('insights');
const analytics = lib('analytics');
const balances = lib('balances');
const cards = lib('cards');
const bills = lib('bills');
const tf = lib('transaction-filter');
const ta = lib('transfer-activity');
const unc = lib('uncategorised');
const acc = lib('accuracy');
const cash = lib('cash-flow');
const reminders = lib('reminders');
const daily = lib('daily-summary');
const fmt = lib('format');
const fg = lib('foreground-history-priority');

markets.setActiveMarket('AE');
const REPORT = process.env.WAFRA_HOT_PATH_REPORT === '1';
const report = {};
const today = new Date(NOW);
const period = { mode: 'month', key: fmt.monthKey(today) };

/** Best of `runs` timings; `prepare` supplies a fresh input identity each run. */
function best(label, rows, prepare, run, runs = 3) {
  let min = Infinity;
  let value;
  for (let i = 0; i < runs; i += 1) {
    const input = prepare();
    const started = performance.now();
    value = run(input);
    min = Math.min(min, performance.now() - started);
  }
  (report[rows] ??= {})[label] = +min.toFixed(1);
  return { ms: min, value };
}

/**
 * Doubling the ledger should about double a linear step (~2x); a pass that is
 * quadratic in the rows, like the receipts x purchases scan this file guards
 * against, comes out near 4x. The check allows up to 3x plus `slackMs`.
 *
 * Measuring each size as one best-of batch, back to back, could not tell those
 * apart on a shared CI runner: a lucky fast 15k batch lowered the bar while a
 * collector pause or a busy neighbour landed in the 30k batch (58 -> 223 ms on
 * one hosted run of the card-purchase apply, against 1.5-2.3x on every local
 * run). So the two sizes are timed alternately, round by round, under the same
 * host conditions, and a super-linear reading is re-measured from fresh
 * samples before it fails: noise rarely repeats, while a real quadratic is
 * super-linear on every attempt.
 *
 * `measure(rows)` times one run at that size and returns milliseconds.
 */
function scalesLinearly(label, measure, slackMs, { rounds = 4, attempts = 3 } = {}) {
  const tries = [];
  let fastestSmall = Infinity;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let small = Infinity;
    let large = Infinity;
    for (let round = 0; round < rounds; round += 1) {
      small = Math.min(small, measure(15000));
      large = Math.min(large, measure(30000));
    }
    fastestSmall = Math.min(fastestSmall, small);
    tries.push(`${small.toFixed(1)} -> ${large.toFixed(1)} ms`);
    if (large < 3 * small + slackMs) {
      (report[15000] ??= {})[label] = +small.toFixed(1);
      (report[30000] ??= {})[label] = +large.toFixed(1);
      return { linear: true, small: fastestSmall, tries };
    }
  }
  return { linear: false, small: fastestSmall, tries };
}

/** One timed run of `run` on a fresh input from `prepare`. */
function timeOnce(prepare, run) {
  const input = prepare();
  const started = performance.now();
  const value = run(input);
  return { ms: performance.now() - started, value };
}

const cache = new Map();
/** A hydrated snapshot as the store holds it: normalized links + receipt. */
function snapshot(count) {
  if (cache.has(count)) return cache.get(count);
  const base = hotPathLedger(count);
  // Hydration has already run the capture/payment clean-up and transfer
  // normalisation over a stored ledger; a capture starts from that state.
  const transactions = tr.normalizeTransferLinks(
    pf.reconcilePaymentFlows(dedupe.reconcileCaptureDuplicates(base.transactions)), base.accounts);
  const state = {
    ...base, transactions, hydrationFinalizeVersion: 1, parserVersion: parser.PARSER_BACKFILL_VERSION,
    transferNormalizationVersion: tr.TRANSFER_NORMALIZATION_VERSION,
    transferInternalIds: [...tr.reconciliationInternalIds(tr.reconcileTransfers(transactions, base.accounts))],
  };
  cache.set(count, state);
  return state;
}
/** The same ledger under new array identities, as after any capture. */
const fresh = (state) => {
  const next = { ...state, transactions: [...state.transactions], transferInternalIds: [...state.transferInternalIds] };
  ledger.primeInternalTransferIds(next.transactions, next.accounts, next.transferInternalIds, true);
  return next;
};

const cardPurchase = (state, i) => {
  const card = state.accounts.find((a) => a.id === 'card-3');
  const at = NOW + 60_000 * (i + 1);
  return { type: 'expense', amountFils: 4321 + i, category: 'dining', accountId: card.id, title: 'Sample merchant 7',
    date: new Date(at).toISOString().slice(0, 10), ts: at, source: 'sms', smsKey: `s${at}-${4321 + i}`,
    captureInstrument: { last4: card.last4, kind: 'credit', bankIdentity: card.bankName } };
};
const batchOf = (state, rows) => ({ transactions: rows.map((row, i) => ({ ...row, id: `new-${i}-${row.ts}` })),
  newAccounts: [], newHints: {}, newDues: [], newBills: [], snapshots: {}, bankNames: {}, cardTypes: {},
  parserRereadComplete: false, historyImport: undefined, lastScanTs: state.lastScanTs + 1, updates: [],
  importMoney: state.ledgerMoney });

/** Every synchronous step a screen runs on render/focus after a capture. */
const SCREEN_STEPS = {
  'home projectDashboard': (s) => dash.projectDashboard({ state: s, period, now: today, surface: 'home',
    includeInsights: false, includeCleanupPrompts: false }),
  'home insight': (s) => dash.projectDashboardInsight(s, period, today),
  'spending summarizeMonth': (s) => insights.summarizeMonth(s.transactions, period,
    ledger.liveAccountIds(s.accounts), ledger.internalTransferIdsForState(s)),
  'spending trends': (s) => {
    const live = ledger.liveAccountIds(s.accounts); const internal = ledger.internalTransferIdsForState(s);
    return [analytics.topMerchants(s.transactions, period, 8, live, internal),
      analytics.categoryMovers(s.transactions, period, 5, live, internal),
      analytics.dayOfWeekSpend(s.transactions, period, live, internal)];
  },
  'spending categoryTrend': (s) => analytics.categoryTrend(s.transactions, 'groceries', 6, period.key,
    ledger.liveAccountIds(s.accounts), ledger.internalTransferIdsForState(s)),
  'wallet netWorthBreakdown': (s) => balances.netWorthBreakdown(s),
  'wallet reissueSuggestions': (s) => cards.reissueSuggestions(s, today),
  'wallet/cards openDues': (s) => cards.openDues(s, today),
  'bills recentlySettledDues': (s) => cards.recentlySettledDues(s, today),
  'bills billsForMonth': (s) => bills.billsForMonth(s.bills, s.transactions, today,
    ledger.liveAccountIds(s.accounts), ledger.internalTransferIdsForState(s)),
  'transactions index': (s) => tf.createTransactionFilterIndex(s.transactions, 'en'),
  'transactions search': (s) => {
    const index = tf.createTransactionFilterIndex(s.transactions, 'en');
    return tf.projectTransactionFilter(index, { type: null, accountId: null, categories: new Set(), datePreset: 'all',
      dateFrom: null, dateTo: null, minFils: null, sort: 'newest' }, { query: 'sample', merchant: null, smsOnly: false,
      currentKey: period.key, period, live: ledger.liveAccountIds(s.accounts), internal: ledger.internalTransferIdsForState(s),
      corroborating: ledger.corroboratingTransferIdsForState(s) });
  },
  'transfers activity': (s) => ta.getTransferActivity(s.transactions, s.accounts, ledger.transferReconciliationForState(s)),
  'categorise uncategorised': (s) => unc.uncategorisedMerchants(s),
  'accuracy parserCoverage': (s) => acc.parserCoverage({ transactions: s.transactions, merchantOverrides: s.merchantOverrides }),
  'flow cash outflow': (s) => cash.summarizeCashOutflow(s, period),
  'reminders plan': (s) => reminders.buildPaymentReminders(s, today, 24, []),
  'daily summary': (s) => daily.buildDailySummary(s, fmt.toISODate(today)),
};
// Host budgets (ms) at 15k rows, doubled at 30k. Each is about three times
// the best-of-three measured on a developer host, so a slow CI runner passes
// while a new full-ledger pass or an accidental quadratic still fails.
const SCREEN_BUDGET_MS = 60;
const SCREEN_BUDGET_OVERRIDES_MS = {
  'spending trends': 100,
  'transactions search': 90,
  'transfers activity': 150,
  'flow cash outflow': 150,
};

for (const count of [15000, 30000]) {
  test(`${count} rows: every screen step stays inside its host budget`, () => {
    const state = snapshot(count);
    for (const [label, step] of Object.entries(SCREEN_STEPS)) {
      const { ms } = best(label, count, () => fresh(state), step);
      const budget = (SCREEN_BUDGET_OVERRIDES_MS[label] ?? SCREEN_BUDGET_MS) * (count / 15000);
      assert.ok(ms < budget, `${label} took ${ms.toFixed(1)} ms at ${count} rows (budget ${budget} ms)`);
    }
  });
}

test('the scaling check flags a quadratic step and forgives one noisy attempt', () => {
  // Synthetic timings at the hosted runner's speed (58 ms at 15k rows).
  const linear = (rows) => (rows / 15000) * 58;
  const quadratic = (rows) => (rows / 15000) ** 2 * 58;
  let calls = 0;
  // The whole first attempt sees a slow 30k host, the hosted run's 3.8x.
  const noisy = (rows) => { calls += 1; return linear(rows) * (calls <= 8 && rows === 30000 ? 1.92 : 1); };
  assert.equal(scalesLinearly('probe linear', linear, 20).linear, true);
  const quad = scalesLinearly('probe quadratic', quadratic, 20);
  assert.equal(quad.linear, false);
  assert.equal(quad.tries.length, 3, 'a real quadratic is re-measured, then fails');
  assert.equal(scalesLinearly('probe noisy', noisy, 20).linear, true);
  for (const label of ['probe linear', 'probe quadratic', 'probe noisy']) {
    delete report[15000]?.[label];
    delete report[30000]?.[label];
  }
});

test('capture: applying one card purchase is bounded and scales linearly', () => {
  let i = 0;
  const apply = (count) => {
    const state = snapshot(count);
    const { ms, value } = timeOnce(() => fresh(state),
      (s) => li.applyMaterializedImportBatch(s, batchOf(s, [cardPurchase(s, i++)])));
    assert.equal(value.transactions.length, state.transactions.length + 1);
    return ms;
  };
  const scaling = scalesLinearly('capture apply (card purchase)', apply, 20);
  assert.ok(scaling.small < 250, `capture apply at 15k took ${scaling.small.toFixed(1)} ms (budget 250)`);
  assert.ok(scaling.linear, `capture apply grew super-linearly on every attempt: ${scaling.tries.join('; ')}`);
});

test('capture: the whole-ledger repair passes are linear, not receipts x purchases', () => {
  const rowsOf = (count) => () => [...snapshot(count).transactions];
  const flows = scalesLinearly('reconcilePaymentFlows',
    (count) => timeOnce(rowsOf(count), (rows) => pf.reconcilePaymentFlows(rows)).ms, 10);
  const dup = scalesLinearly('reconcileCaptureDuplicates',
    (count) => timeOnce(rowsOf(count), (rows) => dedupe.reconcileCaptureDuplicates(rows)).ms, 10);
  assert.ok(flows.small < 40, `payment-flow repair took ${flows.small.toFixed(1)} ms at 15k (budget 40)`);
  assert.ok(dup.small < 120, `duplicate repair took ${dup.small.toFixed(1)} ms at 15k (budget 120)`);
  assert.ok(flows.linear, `payment-flow repair grew super-linearly on every attempt: ${flows.tries.join('; ')}`);
  assert.ok(dup.linear, `duplicate repair grew super-linearly on every attempt: ${dup.tries.join('; ')}`);
});

test('capture: planning one new message against the ledger is bounded', () => {
  const body = 'Purchase of AED 43.21 with Credit Card ending 4103 at SAMPLE CAFE, DUBAI. Avl Cr. Limit AED 14,671.30';
  const parsed = parser.parseSms(body, {}, { sender: 'ADCBAlert', observedAt: NOW + 5_000 });
  assert.ok(parsed, 'fixture message must parse');
  const scanned = [{ ...parsed, smsTs: NOW + 5_000, sender: 'ADCBAlert', channel: 'sms' }];
  const state = snapshot(15000);
  const { ms, value } = best('capture plan (1 message)', 15000, () => fresh(state),
    (s) => planLib.buildImportPlan(scanned, s, s.lastScanTs + 1, today, []), 4);
  assert.equal(value.txCount, 1);
  assert.ok(ms < 250, `planning one message took ${ms.toFixed(1)} ms at 15k (budget 250)`);
});

test('recurrence: longest cooperative slice stays short and the answer matches the synchronous one', async () => {
  const state = snapshot(30000);
  const s = fresh(state);
  const live = ledger.liveAccountIds(s.accounts);
  const internal = ledger.internalTransferIdsForState(s);
  const original = fg.waitForForegroundHistoryIdle;
  const slices = [];
  let started = performance.now();
  fg.waitForForegroundHistoryIdle = async () => {
    slices.push(performance.now() - started);
    await new Promise((resolve) => setImmediate(resolve));
    started = performance.now();
  };
  try {
    started = performance.now();
    const value = await subs.detectSubscriptionsCooperatively(s.transactions, s.notSubscriptions, today, live, internal);
    slices.push(performance.now() - started);
    const longest = Math.max(...slices);
    (report[30000] ??= {})['recurrence longest slice'] = +longest.toFixed(1);
    (report[30000] ??= {})['recurrence slices'] = slices.length;
    assert.ok(longest < 25, `longest recurrence slice ${longest.toFixed(1)} ms (budget 25)`);
    const copy = [...s.transactions];
    assert.deepEqual(value, subs.detectSubscriptions(copy, s.notSubscriptions, today, live, internal));
    assert.ok(value.some((sub) => sub.group === 'subscription' && sub.status === 'active'),
      'the fixture must actually exercise subscription detection');
  } finally {
    fg.waitForForegroundHistoryIdle = original;
  }
});

test('recurrence: Bills, reminders and Ask share one job for equal live/internal sets', async () => {
  const s = fresh(snapshot(15000));
  const liveA = ledger.liveAccountIds(s.accounts);
  const internalA = ledger.internalTransferIdsForState(s);
  const first = subs.detectSubscriptionsCooperatively(s.transactions, s.notSubscriptions, today, liveA, internalA);
  // A second caller building its own, equal sets joins the running job.
  assert.equal(subs.subscriptionDetectionRunning(s.transactions, s.notSubscriptions, today,
    new Set(liveA), new Set(internalA)), true);
  const second = subs.detectSubscriptionsCooperatively(s.transactions, s.notSubscriptions, new Date(NOW + 3_600_000),
    new Set(liveA), new Set(internalA));
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b, 'both callers receive the one shared result');
  assert.equal(subs.peekSubscriptionDetection(s.transactions, s.notSubscriptions, today, new Set(liveA),
    new Set(internalA)), a, 'a later screen paints the finished answer without starting work');
  // Different membership is a different question.
  assert.equal(subs.peekSubscriptionDetection(s.transactions, s.notSubscriptions, today, new Set(), internalA), null);
});

test('recurrence: a scan of a replaced ledger stops once nobody waits for it', async () => {
  const older = fresh(snapshot(15000));
  const newer = fresh(snapshot(15000));
  const live = ledger.liveAccountIds(older.accounts);
  const internal = ledger.internalTransferIdsForState(older);
  let olderCancelled = false;
  const stale = subs.detectSubscriptionsCooperatively(older.transactions, older.notSubscriptions, today, live, internal,
    () => olderCancelled);
  olderCancelled = true;
  const current = subs.detectSubscriptionsCooperatively(newer.transactions, newer.notSubscriptions, today, live, internal);
  assert.equal(await stale, null);
  assert.equal(subs.subscriptionDetectionRunning(older.transactions, older.notSubscriptions, today, live, internal), false);
  assert.equal(subs.peekSubscriptionDetection(older.transactions, older.notSubscriptions, today, live, internal), null,
    'an abandoned scan must not be cached as if it had finished');
  assert.ok(Array.isArray(await current));
});

test('recurrence: a caller still waiting keeps a superseded scan alive', async () => {
  const older = fresh(snapshot(15000));
  const newer = fresh(snapshot(15000));
  const live = ledger.liveAccountIds(older.accounts);
  const internal = ledger.internalTransferIdsForState(older);
  const kept = subs.detectSubscriptionsCooperatively(older.transactions, older.notSubscriptions, today, live, internal);
  const current = subs.detectSubscriptionsCooperatively(newer.transactions, newer.notSubscriptions, today, live, internal);
  const [a, b] = await Promise.all([kept, current]);
  assert.ok(Array.isArray(a) && Array.isArray(b));
  assert.deepEqual(a, b);
});

test.after(() => {
  if (REPORT) console.log(JSON.stringify({ node: process.version, hostMs: report }, null, 1));
});

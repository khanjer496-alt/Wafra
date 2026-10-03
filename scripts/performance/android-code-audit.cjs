#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createLoader } = require('../universal-test/load-ts.cjs');
const { performanceLedger, now } = require('../test/fixtures/performance-ledger.cjs');
const load = createLoader();
const analytics = load('@/lib/analytics');
const transactions = load('@/lib/transaction-filter');
const cards = load('@/lib/cards');
const assistant = load('@/lib/wafra-assistant');
const dashboard = load('@/lib/dashboard-projection');
const merchant = load('@/lib/merchant-spending');
const { TRANSFER_NORMALIZATION_VERSION } = load('@/lib/transfer-reconciliation');
const period = { mode: 'month', key: '2026-09' };
const filters = { type: null, accountId: null, categories: new Set(), datePreset: 'selected',
  dateFrom: null, dateTo: null, minFils: null, sort: 'newest' };
const results = [];
function measure(label, prepare, run) {
  const samples = [];
  for (let i = 0; i < 7; i++) {
    const input = prepare();
    const start = performance.now();
    run(input);
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  return { label, medianMs: sorted[3], maxMs: sorted[6], samplesMs: samples };
}
for (const count of [15000, 30000]) {
  const base = performanceLedger(count);
  const state = () => ({ ...base, transactions: [...base.transactions], accounts: [...base.accounts],
    transferNormalizationVersion: TRANSFER_NORMALIZATION_VERSION, transferInternalIds: [] });
  const live = new Set(base.accounts.filter(a => !a.archived).map(a => a.id));
  const internal = new Set();
  const options = { query: '', merchant: null, smsOnly: false, currentKey: period.key, period,
    live, internal, corroborating: new Set() };
  const cases = [
    measure('home-first-projection', state, s => dashboard.projectDashboard({ state: s, period, now, surface: 'home', includeInsights: false, includeCleanupPrompts: false })),
    measure('category-six-month-trend', state, s => analytics.categoryTrend(s.transactions, 'groceries', 6, period.key, live, internal)),
    measure('spending-trends-analytics', state, s => {
      analytics.topMerchants(s.transactions, period, 5, live, internal);
      analytics.categoryMovers(s.transactions, period, 4, live, internal, now);
      analytics.dayOfWeekSpend(s.transactions, period, live, internal);
    }),
    measure('transaction-index', state, s => transactions.createTransactionFilterIndex(s.transactions, 'en')),
    measure('current-month-largest-sort', () => transactions.createTransactionFilterIndex([...base.transactions], 'en'),
      index => transactions.projectTransactionFilter(index, { ...filters, sort: 'largest' }, options)),
    measure('current-month-oldest-sort', () => transactions.createTransactionFilterIndex([...base.transactions], 'en'),
      index => transactions.projectTransactionFilter(index, { ...filters, sort: 'oldest' }, options)),
    measure('merchant-detail', state, s => merchant.projectMerchantSpending(s.transactions, 'Sample merchant 1', period, live, internal)),
    measure('card-payment-rows', state, s => cards.cardPaymentRows(s)),
    measure('ask-suggestions', state, s => assistant.suggestedAssistantQuestions(s, period, now)),
  ];
  results.push({ count, cases });
}
const report = { runtime: process.version, platform: process.platform, arch: process.arch,
  scope: 'Synthetic host JS costs on fresh immutable arrays; not Android/Hermes, React rendering, native I/O or phone smoothness.',
  repetitions: 7, results };
const output = process.argv[2];
if (!output) throw new Error('Pass a report output path');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
for (const r of results) for (const c of r.cases) console.log(`${r.count} ${c.label}: ${c.medianMs.toFixed(2)} ms median`);

'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');

function harness(rows = [], options = {}) {
  let insightCalls = 0;
  let periodChecks = 0;
  const calls = { unread: 0, cashOut: 0, comparison: 0, foreign: 0, upcomingKinds: [] };
  const state = { transactions: rows, accounts: [{ id: 'bank' }], budgets: [], notSubscriptions: [],
    reviewTray: { pending: options.pending ?? [] } };
  // Row-local transfer facts are fixture fields; the projection must never
  // rebuild the transfer graph, so reconciliation itself throws.
  const reconciliation = { isTransferCandidate: row => row.ownership !== undefined,
    transferOwnership: row => row.ownership ?? null,
    reconcileTransfers: () => { throw new Error('dashboard projection rebuilt the transfer graph'); } };
  const transferActivity = load(path.resolve(__dirname, '../../../src/lib/transfer-activity.ts'), {
    '@/lib/transfer-reconciliation': reconciliation });
  const { projectDashboard } = load(path.resolve(__dirname, '../../../src/lib/dashboard-projection.ts'), {
    '@/lib/transfer-reconciliation': reconciliation, '@/lib/transfer-activity': transferActivity,
    '@/lib/accuracy': { unreadFormatCount: () => { calls.unread++; return options.unread ?? 0; }, REPORT_PROMPT_THRESHOLD: 5 },
    '@/lib/analytics': { periodComparison: () => { calls.comparison++; return null; } },
    '@/lib/cash-flow': { summarizeCashOutflow: () => { calls.cashOut++; return { totalFils: 120, cardPaymentsFils: 20, accountOutflowFils: 100 }; } },
    '@/lib/fx-summary': { summarizeForeignActivity: () => { calls.foreign++; return { count: 0 }; } },
    '@/lib/insights': { summarizeMonth: () => ({ incomeFils: 1000, expenseFils: 120 }),
      buildInsights: () => { insightCalls += 1; return [{ id: 'one' }, { id: 'two' }]; } },
    '@/lib/leaving-soon': { leavingSoon: (_state, _now, opts) => { calls.upcomingKinds.push(opts.kinds);
      return ['card', 'bill', 'subscription'].filter(kind => !opts.kinds || opts.kinds.includes(kind)).map(kind => ({ kind })); } },
    '@/lib/ledger': { countsInTotals: (row, live, internal) => !row.isTransfer && live.has(row.accountId) && !internal.has(row.id), countsInCashflowTotals: (row, live, internal) => !row.isTransfer && live.has(row.accountId) && !internal.has(row.id), liveAccountIds: () => new Set(['bank']), internalTransferIds: () => new Set(['internal']), internalTransferIdsForState: () => new Set(['internal']) },
    '@/lib/period': { inPeriod: (date) => { periodChecks += 1; return date === '2026-09-06'; }, isCurrentMonth: () => true },
    '@/lib/uncategorised': { uncategorisedMerchants: () => ({ merchants: [], paymentPurposes: [], rowCount: 0, totalFils: 0 }), worthPrompting: () => !!options.needsCategory },
  });
  return { project: (extra = {}) => projectDashboard({ state, period: {}, now: new Date(), ...extra }),
    counts: () => ({ insightCalls, periodChecks, ...calls }) };
}

test('insights remain opt-out, preserving existing callers and dismissal semantics', () => {
  const h = harness();
  assert.equal(h.project().insight.id, 'one');
  assert.equal(h.project({ dismissedInsightId: 'one' }).insight.id, 'two');
  assert.equal(h.counts().insightCalls, 2);
});
test('Home can skip invisible insights without changing the monetary projection', () => {
  const h = harness();
  const full = h.project();
  const lean = h.project({ includeInsights: false });
  assert.equal(lean.insight, null);
  assert.deepEqual(lean.hero, full.hero);
  assert.deepEqual(lean.upcoming, full.upcoming);
  assert.equal(h.counts().insightCalls, 1);
});
test('activity selection stops at six visible rows and preserves display order', () => {
  const rows = Array.from({ length: 10000 }, (_, i) => ({ id: `${i}`, date: '2026-09-06', accountId: 'bank' }));
  const h = harness(rows);
  assert.deepEqual(Array.from(h.project().activityRows, (r) => r.id), ['0', '1', '2', '3', '4', '5']);
  assert.equal(h.counts().periodChecks, 6);
});
test('transfer, archived, internal and other-period rows cannot displace visible activity', () => {
  const rows = [
    { id: 'transfer', date: '2026-09-06', accountId: 'bank', isTransfer: true },
    { id: 'internal', date: '2026-09-06', accountId: 'bank' },
    { id: 'archived', date: '2026-09-06', accountId: 'hidden' },
    { id: 'old', date: '2026-08-06', accountId: 'bank' },
    { id: 'visible', date: '2026-09-06', accountId: 'bank' },
  ];
  assert.deepEqual(Array.from(harness(rows).project().activityRows, (r) => r.id), ['visible']);
});

test('Home requests cards and bills without evaluating discarded financial sections or insights', () => {
  const h = harness();
  const lean = h.project({ surface: 'home' });
  assert.deepEqual(Object.keys(lean.hero).sort(), ['expenseFils', 'incomeFils', 'netFils']);
  assert.equal(lean.hero.incomeFils - lean.hero.expenseFils, lean.hero.netFils);
  assert.deepEqual(Array.from(lean.upcoming.items, item => item.kind), ['card', 'bill']);
  assert.deepEqual(Array.from(h.counts().upcomingKinds[0]), ['card', 'bill']);
  assert.deepEqual([h.counts().cashOut, h.counts().comparison, h.counts().foreign, h.counts().insightCalls], [0, 0, 0, 0]);
  for (const key of ['comparison', 'foreignActivity', 'insight']) assert.equal(Object.hasOwn(lean, key), false);
});

test('Home does not scan retained SMS when a category prompt already takes priority', () => {
  const h = harness([], { needsCategory: true, unread: 8 });
  assert.equal(h.project({ surface: 'home' }).unreadFormats, null, 'null means not computed, not zero formats');
  assert.equal(h.counts().unread, 0);
  const full = h.project();
  assert.equal(full.unreadFormats.count, 8, 'existing full projection still includes every section');
  assert.equal(h.counts().unread, 1);
});

test('parser review state no longer hides Home unread-format work', () => {
  const h = harness([], { pending: [{ expiresAt: Date.now() + 60000 }], unread: 8 });
  const projected = h.project({ surface: 'home' });
  assert.equal(projected.unreadFormats.count, 8);
  assert.equal(projected.unreadFormats.shouldPrompt, true);
  assert.equal(h.counts().unread, 1);
});

test('Home leaves only row-locally settled external transfers to the Transfers screen', () => {
  const rows = [
    { id: 'sent', date: '2026-09-06', accountId: 'bank', ownership: 'external' },
    { id: 'unknown', date: '2026-09-06', accountId: 'bank', ownership: 'unknown' },
    { id: 'dup', date: '2026-09-06', accountId: 'bank', ownership: 'external' },
    { id: 'dup', date: '2026-09-06', accountId: 'bank', ownership: 'external' },
    { id: 'coffee', date: '2026-09-06', accountId: 'bank' },
  ];
  const home = harness(rows).project({ surface: 'home' });
  // Unknown ownership may be a likely card repayment that Transfers does not
  // list; duplicate ids are left to review. Both stay visible here.
  assert.deepEqual(Array.from(home.activityRows, r => r.id), ['unknown', 'dup', 'dup', 'coffee']);
  assert.equal(home.hasPeriodTransfers, true);
  assert.deepEqual(Array.from(harness(rows).project().activityRows, r => r.id), ['sent', 'unknown', 'dup', 'dup', 'coffee'],
    'the full dashboard surface keeps its existing activity rows');
  assert.equal(harness([{ id: 'coffee', date: '2026-09-06', accountId: 'bank' },
    { id: 'old-sent', date: '2026-08-06', accountId: 'bank', ownership: 'external' },
    { id: 'hidden-sent', date: '2026-09-06', accountId: 'hidden', ownership: 'external' }])
    .project({ surface: 'home' }).hasPeriodTransfers, false, 'other periods and hidden accounts do not count');
});

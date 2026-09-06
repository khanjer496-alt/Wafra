'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');

function harness(rows = []) {
  let insightCalls = 0;
  let periodChecks = 0;
  const state = { transactions: rows, accounts: [{ id: 'bank' }], budgets: [], notSubscriptions: [] };
  const { projectDashboard } = load(path.resolve(__dirname, '../../../src/lib/dashboard-projection.ts'), {
    '@/lib/accuracy': { unreadFormatCount: () => 0, REPORT_PROMPT_THRESHOLD: 5 },
    '@/lib/analytics': { periodComparison: () => null },
    '@/lib/cash-flow': { summarizeCashOutflow: () => ({ totalFils: 120, cardPaymentsFils: 20, accountOutflowFils: 100 }) },
    '@/lib/fx-summary': { summarizeForeignActivity: () => ({ count: 0 }) },
    '@/lib/insights': { summarizeMonth: () => ({ incomeFils: 1000, expenseFils: 120 }),
      buildInsights: () => { insightCalls += 1; return [{ id: 'one' }, { id: 'two' }]; } },
    '@/lib/leaving-soon': { leavingSoon: () => [] },
    '@/lib/ledger': { liveAccountIds: () => new Set(['bank']), internalTransferIds: () => new Set(['internal']) },
    '@/lib/period': { inPeriod: (date) => { periodChecks += 1; return date === '2026-09-06'; }, isCurrentMonth: () => true },
    '@/lib/uncategorised': { uncategorisedMerchants: () => ({ merchants: [] }), worthPrompting: () => false },
  });
  return { project: (extra = {}) => projectDashboard({ state, period: {}, now: new Date(), ...extra }),
    counts: () => ({ insightCalls, periodChecks }) };
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

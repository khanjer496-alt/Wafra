'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('./load-typescript.cjs');

function harness(options = {}) {
  const events = [];
  let dependencies;
  let allowed = true;
  let state = { historyImport: { status: 'paused' }, marketId: 'AE', merchantOverrides: {},
    hydrated: true, onboarded: true, captureOptOut: false };
  const store = {
    state, getStateSnapshot: () => state, getStateGeneration: () => 1,
    setHistoryImportProgress: async () => {},
    setMarket: () => options.marketAllowed !== false,
    stageReviewAlerts: () => {
      events.push('review');
      return { durable: options.reviewFailure ? Promise.reject(new Error('review write failed')) : Promise.resolve() };
    },
    importBatch: (batch) => {
      events.push('ledger');
      assert.equal(batch.historyImport, next);
      if (options.pauseOnWrite) allowed = false;
      return { durable: options.ledgerFailure ? Promise.reject(new Error('ledger write failed')) : Promise.resolve() };
    },
  };
  const native = { Platform: { OS: 'android' }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } };
  const hook = load(path.resolve(__dirname, '../../../src/hooks/use-history-import.ts'), {
    react: { useMemo: (factory) => factory(), useCallback: (fn) => fn, useEffect() {} },
    'react-native': native,
    '@/lib/review-source-bindings': { collectLegacyReviewSourceKeys: () => [] },
    '@/lib/auto-import': {
      isSmsInboxAccessError: () => false, scanInbox: async () => page,
      buildImportPlan: () => { events.push('plan'); return { batch: { transactions: [] } }; },
    },
    '@/lib/history-import': { subscribeHistoryImportRequest: () => () => {}, createHistoryImportCoordinator: (value) => { dependencies = value; return { run() {} }; } },
    '@/lib/android-history-background': { historyBackground: { canContinue: () => allowed, run: (job) => job(), cancel() {} } },
    '@/lib/purchases': { isProActive: () => true },
    '@/lib/launch-performance': { markLaunchPhase: () => events.push('mark') },
    '@/lib/store': { useStore: () => store },
  }, { setTimeout: (fn) => { events.push('yield'); if (options.pauseOnYield) allowed = false; fn(); return 1; } });
  hook.useHistoryImport();
  const next = { status: 'running', cursor: { beforeDateMs: 100, beforeId: 7 } };
  const page = {
    reviewCandidates: options.reviews ?? [], reviewSourceBindings: options.bindings ?? [],
    detectedLaunchMarket: options.market ?? null, parsed: [], declined: [], newestTs: 200,
    inboxHistoryComplete: false, scannedCount: 1000,
    commit: async () => { events.push('ack'); },
  };
  return { events, dependencies, page, next, commit: () => dependencies.commitPage(page, next, () => allowed),
    pause: () => { allowed = false; }, replace: (value) => { state = value; } };
}

test('empty-review page saves only the ledger/cursor, after a UI yield', async () => {
  const h = harness();
  assert.equal(await h.commit(), true);
  assert.deepEqual(h.events, ['yield', 'plan', 'ledger', 'mark', 'ack']);
});
test('review candidates retain their required durability before ledger planning', async () => {
  const h = harness({ reviews: [{ id: 'review' }] });
  await h.commit();
  assert.deepEqual(h.events, ['review', 'yield', 'plan', 'ledger', 'mark', 'ack']);
});
test('source-identity migration is NOT skipped when the review list is empty', async () => {
  const h = harness({ bindings: [{ legacyId: 'old', id: 'new' }] });
  await h.commit();
  assert.equal(h.events[0], 'review');
});
test('pause or generation invalidation before work leaves the cursor untouched', async () => {
  const h = harness(); h.pause();
  assert.equal(await h.commit(), false);
  assert.deepEqual(h.events, []);
});
test('pause during UI yield is rechecked before planning or writing', async () => {
  const h = harness({ pauseOnYield: true });
  assert.equal(await h.commit(), false);
  assert.deepEqual(h.events, ['yield']);
});
test('review write failure cannot advance ledger or acknowledge captured messages', async () => {
  const h = harness({ reviews: [{ id: 'review' }], reviewFailure: true });
  await assert.rejects(h.commit(), /review write failed/);
  assert.deepEqual(h.events, ['review']);
});
test('ledger write failure cannot acknowledge captured messages', async () => {
  const h = harness({ ledgerFailure: true });
  await assert.rejects(h.commit(), /ledger write failed/);
  assert.deepEqual(h.events, ['yield', 'plan', 'ledger']);
});
test('pause during durable write leaves the native queue unacknowledged', async () => {
  const h = harness({ pauseOnWrite: true });
  assert.equal(await h.commit(), true);
  assert.deepEqual(h.events, ['yield', 'plan', 'ledger', 'mark']);
});
test('currency-market rejection cannot stage, write, or acknowledge', async () => {
  const h = harness({ market: 'SA', marketAllowed: false });
  await assert.rejects(h.commit(), /market_mismatch/);
  assert.deepEqual(h.events, []);
});

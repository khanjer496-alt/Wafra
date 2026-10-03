'use strict';
// Every collector stages a plan's possible Apple Pay duplicates as durable
// Review items and acknowledges (or commits) the source only afterwards.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = path.join(root, 'scripts/test/build');
const tray = require(path.join(build, 'alert-review-tray.js'));
const health = load(path.join(root, 'src/lib/ios-capture-health.ts'));

const observedAt = Date.now() - 60_000;
const review = {
  kind: 'universal', id: 'apple_message_review_id_' + 'a'.repeat(64),
  sourceKey: 'apple_message_review_source_' + 'a'.repeat(64), observedAt,
  expiresAt: observedAt + tray.REVIEW_ALERT_TTL_MS, channel: 'inbox', parserVersion: 1,
  attentionReason: 'possible-apple-pay-duplicate',
  event: { version: 1, decision: 'review', family: 'purchase', status: 'posted', direction: 'debit',
    amount: { value: { currency: 'AED', minorUnits: '25000', exponent: 2 }, evidence: 'explicit', alternatives: [], spans: [], issues: [] },
    ...Object.fromEntries(['statementTotal', 'minimumDue', 'balance', 'creditLimit', 'dueDate', 'statementDate', 'instrument']
      .map(key => [key, { value: null, evidence: 'missing', alternatives: [], spans: [], issues: [] }])),
    merchant: { value: 'CARREFOUR MOE DXB', evidence: 'explicit', alternatives: [], spans: [], issues: [] },
    transactionDate: { value: null, evidence: 'missing', alternatives: [], spans: [], issues: [] },
    observations: [{ role: 'transaction', field: { value: { currency: 'AED', minorUnits: '25000', exponent: 2 }, evidence: 'explicit', alternatives: [], spans: [], issues: [] } }],
    issues: [] },
};
const posting = { type: 'expense', amountFils: 25000, accountId: 'card', title: 'CARREFOUR MOE DXB', date: '2026-09-23',
  category: 'groceries', source: 'sms', smsKey: 'h' + 'a'.repeat(64), ts: observedAt };
const nearPlan = row => ({ txCount: 0, dueCount: 0, healedCount: 0, newAccountCount: 0,
  declineReconciledCount: 0, declineReconciledIds: [], declineReconciliations: [], billDues: [],
  batch: { transactions: [], newAccounts: [], newHints: {}, newDues: [], newBills: [], snapshots: {}, bankNames: {}, cardTypes: {}, lastScanTs: 0, updates: [] },
  walletNearMatches: [{ row, review, walletTransactionId: 'wallet', transaction: posting }] });
assert.equal(tray.admitPreparedReviewAlert(tray.emptyAlertReviewTray(), review, Date.now()).outcome, 'admitted', 'fixture is admissible');

function iosHarness({ retain = true } = {}) {
  const calls = [];
  const row = { smsTs: observedAt, channel: 'inbox', kind: 'transaction', amountFils: 25000 };
  const state = { hydrated: true, captureOptOut: false, marketId: 'AE', lastScanTs: 0,
    transactions: [], accounts: [], localCaptureQualifications: [], reviewTray: tray.emptyAlertReviewTray() };
  let pending = ['record'];
  const api = load(path.join(root, 'src/lib/ios-local-capture.ts'), {
    '@/lib/ios-capture-health': health,
    '@/lib/ios-notification-replay': { createIosNotificationReplayGuard: () => outcome => outcome },
    '@/lib/import-plan': { buildImportPlan: () => nearPlan(row) },
    '@/lib/launch-alert-parser': { createLaunchAlertSession: () => ({}) },
    '@/lib/alert-review-tray': tray,
    '@/lib/ledger-money': require(path.join(build, 'ledger-money.js')),
    '@/lib/local-message-record': {
      preflightLocalMessageRecord: () => ({ id: 'event-id', valid: true, market: 'AE', observedAt }),
      parseLocalMessageRecord: () => ({ kind: 'parsed', market: 'AE', milestone: 'financial', row }),
    },
    '@/lib/types': { normalizeLocalCaptureQualifications: () => [], isLocalCaptureQualificationCandidate: () => true },
  }, { setTimeout });
  let firstCapturedAt = null;
  const native = { notificationCaptureSupported: true,
    getCaptureStatus: async () => ({ firstCapturedAt }), purgeExpired: async () => 0,
    listPendingRecords: async () => [...pending],
    listPendingRecordsIncludingNotifications: async () => [...pending],
    recordFirstCapturedAt: async value => { firstCapturedAt = value; },
    acknowledgeRecords: async ids => { calls.push(['ack', ids]); pending = []; },
  };
  const coordinator = api.createIosLocalCaptureCoordinator({ native, ledger: {
    getState: () => state, getStateGeneration: () => 1,
    importBatch: batch => { calls.push(['save', batch.transactions.length]); return { durable: Promise.resolve(), ids: [] }; },
    ensureDurable: async () => { calls.push(['barrier']); },
    stageReviewAlerts: items => {
      calls.push(['stage', items.map(item => item.id)]);
      let admitted = 0;
      if (retain) for (const item of items) {
        const result = tray.admitPreparedReviewAlert(state.reviewTray, item, Date.now());
        state.reviewTray = result.state; if (result.outcome === 'admitted') admitted += 1;
      }
      return { admitted, qualificationIds: [], durable: new Promise(resolve => setTimeout(() => { calls.push(['staged']); resolve(); }, 5)) };
    },
  }, retireShortcutCapture: async () => 'complete' });
  return { calls, coordinator, state };
}

test('iOS live capture: the near-match is staged, never posted, and acknowledged only after durable staging', async () => {
  const h = iosHarness();
  const result = await h.coordinator.drain();
  assert.equal(result.imported, 0);
  assert.equal(result.reviews, 1);
  assert.equal(h.state.reviewTray.pending[0].attentionReason, 'possible-apple-pay-duplicate');
  const names = h.calls.map(call => call[0]);
  assert.ok(!h.calls.some(call => call[0] === 'save' && call[1] > 0), 'no ledger row');
  assert.ok(names.indexOf('stage') < names.indexOf('staged'));
  assert.ok(names.indexOf('staged') < names.indexOf('ack'), 'ACK waits for the durable review');
  assert.equal(JSON.stringify(h.calls.find(call => call[0] === 'ack')[1]), '["event-id"]');
});

test('iOS live capture: an unretained review keeps the native record queued', async () => {
  const h = iosHarness({ retain: false });
  const result = await h.coordinator.drain();
  assert.equal(result.imported, 0);
  assert.ok(!h.calls.some(call => call[0] === 'ack'), 'record stays in the native queue');
  assert.equal(result.deferredReviews, 1);
});

function executorHarness({ retain = true, source = 'relay' } = {}) {
  const events = [];
  const state = { hydrated: true, captureOptOut: false, privateMode: false, lastScanTs: 0, marketId: 'AE',
    transactions: [], accounts: [], reviewTray: tray.emptyAlertReviewTray() };
  const { createCaptureExecutor } = load(path.join(root, 'src/lib/capture-executor.ts'), {
    '@/lib/auto-import': {}, '@/lib/capture': {}, '@/lib/relay': {},
    '@/lib/capture-trace': { captureTrace: () => {}, captureTraceEnabled: () => false },
  });
  const collected = { source, parsed: [{ smsTs: observedAt }], declined: [], newestTs: observedAt,
    reviewCandidates: [], commit: async () => { events.push('commit'); } };
  const executor = createCaptureExecutor({ ledger: {
    getState: () => state, ensureDurable: async () => { events.push('barrier'); },
    importBatch: batch => { events.push(`save:${batch.transactions.length}`); return { ids: [], durable: Promise.resolve() }; },
    stageReviewAlerts: items => {
      events.push('stage');
      if (retain) for (const item of items) state.reviewTray = tray.admitPreparedReviewAlert(state.reviewTray, item, Date.now()).state;
      return { admitted: retain ? items.length : 0, durable: new Promise(resolve => setTimeout(() => { events.push('staged'); resolve(); }, 5)) };
    },
  }, dependencies: { collectRoutine: async () => collected, planRows: () => nearPlan(collected.parsed[0]),
    getRelay: async () => null } });
  return { events, executor, state };
}

test('capture executor: stages before the source is committed and posts nothing', async () => {
  const h = executorHarness();
  const outcome = await h.executor.execute('routine');
  assert.equal(outcome.reviewAlerts, 1);
  assert.ok(!h.events.some(event => /^save:[1-9]/.test(event)));
  assert.ok(h.events.indexOf('staged') < h.events.indexOf('commit'), JSON.stringify(h.events));
  assert.equal(h.state.reviewTray.pending.length, 1);
});

test('capture executor: a review the tray refuses is posted with the cursor, never dropped behind it', async () => {
  for (const source of ['relay', 'sms']) {
    const h = executorHarness({ retain: false, source });
    await h.executor.execute('routine');
    assert.ok(h.events.includes('save:1'), `${source}: the alert posts visibly instead`);
    assert.ok(h.events.indexOf('save:1') < h.events.indexOf('commit'));
  }
});

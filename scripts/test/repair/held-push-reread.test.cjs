'use strict';
// A held informational push row is never re-read forever (CEO efca3b75): when
// the Message lane is full of money reviews, an informational review the tray
// does not keep is acknowledged at once (re-read 0 more times), exactly as iOS
// does since #181. Money reviews keep their source held as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const tray = require(path.join(root, 'scripts/test/build', 'alert-review-tray.js'));

const now = Date.now();
const missing = () => ({ value: null, evidence: 'missing', alternatives: [], spans: [], issues: [] });
const aed = minorUnits => ({ value: { currency: 'AED', minorUnits, exponent: 2 }, evidence: 'explicit', alternatives: [], spans: [], issues: [] });
const event = (kind) => {
  const amount = aed('8000');
  return kind === 'money'
    ? { version: 1, decision: 'review', family: 'purchase', status: 'posted', direction: 'debit', amount,
      statementTotal: missing(), minimumDue: missing(), balance: missing(), creditLimit: missing(),
      merchant: { ...missing(), value: 'SHOP', evidence: 'explicit' }, transactionDate: missing(), dueDate: missing(),
      statementDate: missing(), instrument: missing(), observations: [{ role: 'transaction', field: amount }], issues: [] }
    : { version: 1, decision: 'review', family: 'balance', status: 'informational', direction: 'none', amount, balance: amount,
      statementTotal: missing(), minimumDue: missing(), creditLimit: missing(), merchant: missing(), instrument: missing(),
      transactionDate: missing(), dueDate: missing(), statementDate: missing(), observations: [], issues: [] };
};
const review = (kind, index) => tray.prepareUniversalReviewAlert({ id: `push_${kind}_review_id_${String(index).padStart(6, '0')}`,
  sourceKey: `android_notification_review_source_${kind}${String(index).padStart(6, '0')}`,
  observedAt: now - 60_000 + index, channel: 'inbox', event: event(kind) });

function routine(candidate) {
  let reviewTray = tray.emptyAlertReviewTray();
  for (let i = 0; i < 50; i += 1) reviewTray = tray.admitPreparedReviewAlert(reviewTray, review('money', 1000 + i), now).state;
  assert.equal(reviewTray.pending.length, 50, 'fixture fills the Message lane with money');
  const state = { hydrated: true, captureOptOut: false, privateMode: false, lastScanTs: 0, marketId: 'AE',
    transactions: [], accounts: [], reviewTray };
  const commits = [];
  const { createCaptureExecutor } = load(path.join(root, 'src/lib/capture-executor.ts'), {
    '@/lib/auto-import': {}, '@/lib/capture': {}, '@/lib/relay': {},
    '@/lib/capture-trace': { captureTrace: () => {}, captureTraceEnabled: () => false },
  });
  const collected = { source: 'push', parsed: [], declined: [], newestTs: now, reviewCandidates: [candidate],
    commit: async (deferred = []) => { commits.push([...deferred]); } };
  const executor = createCaptureExecutor({ ledger: {
    getState: () => state, ensureDurable: async () => {},
    importBatch: () => ({ ids: [], durable: Promise.resolve() }),
    stageReviewAlerts: (items, _qualifications, _bindings, mode) => {
      const batch = tray.admitPreparedReviewAlerts(state.reviewTray, items, Date.now(), mode);
      state.reviewTray = batch.state;
      return { admitted: batch.outcomes.filter(value => value === 'admitted').length, durable: Promise.resolve(),
        retention: () => tray.reviewRetentionReceipts(state.reviewTray, items, Date.now()) };
    },
  }, dependencies: { collectRoutine: async () => collected,
    planRows: () => ({ txCount: 0, dueCount: 0, healedCount: 0, newAccountCount: 0, billDues: [],
      batch: { transactions: [], newAccounts: [], newHints: {}, newDues: [], newBills: [], snapshots: {}, bankNames: {},
        cardTypes: {}, lastScanTs: 0, updates: [] } }),
    getRelay: async () => null } });
  return { executor, commits, state };
}

test('an informational push review the full lane does not keep is acknowledged, never held for re-reading', async () => {
  const informational = review('info', 1);
  const h = routine(informational);
  await h.executor.execute('routine');
  assert.equal(h.commits.length, 1, 'the push source was committed');
  assert.ok(!h.commits[0].some(key => key.includes('info')), JSON.stringify(h.commits));
  assert.equal(h.state.reviewTray.pending.length, 50, 'it never displaced kept money');
});

test('a money push review into the full lane still keeps its source held', async () => {
  const money = review('money', 1);
  const h = routine(money);
  await h.executor.execute('routine');
  assert.equal(h.commits.length, 1);
  assert.ok(h.commits[0].some(key => key.includes('money000001')), JSON.stringify(h.commits));
  assert.equal(h.state.reviewTray.pending.length, 50);
});

// Change Reviewer 747b8ade: the supplemental relay sync builds its own ACK list.
function supplemental(candidate) {
  const h = routine(candidate);
  const acked = [];
  const { createCaptureExecutor } = load(path.join(root, 'src/lib/capture-executor.ts'), {
    '@/lib/auto-import': {}, '@/lib/capture': {}, '@/lib/relay': {},
    '@/lib/capture-trace': { captureTrace: () => {}, captureTraceEnabled: () => false },
  });
  const state = h.state;
  const queued = { parsed: [], declined: [], reviewCandidates: [candidate], ids: ['relay-review-row'],
    reviewIds: ['relay-review-row'], testIds: [], reviewSourceKeysById: new Map([['relay-review-row', candidate.sourceKey]]) };
  const executor = createCaptureExecutor({ ledger: {
    getState: () => state, getStateGeneration: () => 0, ensureDurable: async () => {},
    importBatch: () => ({ ids: [], durable: Promise.resolve() }),
    stageReviewAlerts: (items, _qualifications, _bindings, mode) => {
      const batch = tray.admitPreparedReviewAlerts(state.reviewTray, items, Date.now(), mode);
      state.reviewTray = batch.state;
      return { admitted: batch.outcomes.filter(value => value === 'admitted').length, durable: Promise.resolve(),
        retention: () => tray.reviewRetentionReceipts(state.reviewTray, items, Date.now()) };
    },
  }, dependencies: { getRelay: async () => ({ baseUrl: 'https://relay.invalid', syncToken: 't', privateKey: 'k', market: 'AE' }),
    sync: async () => queued, acknowledge: async (_cfg, ids) => { acked.push(...ids); },
    planRows: () => ({ txCount: 0, dueCount: 0, healedCount: 0, newAccountCount: 0, billDues: [],
      batch: { transactions: [], newAccounts: [], newHints: {}, newDues: [], newBills: [], snapshots: {}, bankNames: {},
        cardTypes: {}, lastScanTs: 0, updates: [] } }) } });
  return { executor, acked, state };
}

test('relay sync: an informational review the full lane does not keep is acknowledged', async () => {
  const h = supplemental(review('info', 2));
  await h.executor.execute('supplemental');
  assert.deepEqual(h.acked, ['relay-review-row']);
  assert.equal(h.state.reviewTray.pending.length, 50);
});

test('relay sync: a money review into the full lane keeps its relay row held', async () => {
  const h = supplemental(review('money', 2));
  await h.executor.execute('supplemental');
  assert.deepEqual(h.acked, []);
  assert.equal(h.state.reviewTray.pending.length, 50);
});

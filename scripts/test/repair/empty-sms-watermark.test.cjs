'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const source = name => path.join(root, 'src/lib', `${name}.ts`);

function harness(result = {}, initial = {}) {
  let current = { hydrated: true, parserVersion: 39, lastScanTs: 1000,
    merchantOverrides: {}, transactions: [], accounts: [], captureOptOut: false,
    privateMode: false, marketId: 'AE', ...initial };
  const events = [], requested = [], batches = [];
  const relay = { isRelayPlatform: () => false, getRelayConfig: async () => null,
    getBackgroundRelayConfig: async () => null, syncRelay: async () => { throw Error('Unexpected relay'); } };
  const capture = load(source('capture'), {
    '@/lib/auto-import': { isSmsScanningAvailable: () => true,
      scanInbox: async since => {
        requested.push(since);
        return { parsed: [], reviewCandidates: [], reviewSourceBindings: [], declined: [],
          newestTs: since, inboxScannedCount: 0, scannedCount: 0, inboxHistoryComplete: true,
          detectedLaunchMarket: null, commit: async () => { events.push('commit'); }, ...result };
      } },
    '@/lib/background-relay-storage': {}, '@/lib/relay': relay,
    '@/lib/sms-parser': { PARSER_VERSION: 39 },
    '@/lib/review-source-bindings': { collectLegacyReviewSourceKeys: () => [] },
  });
  const executor = load(source('capture-executor'), {
    '@/lib/auto-import': {}, '@/lib/capture': capture, '@/lib/relay': relay,
    '@/lib/capture-trace': load(source('capture-trace')),
  }).createCaptureExecutor({
    ledger: { getState: () => current,
      importBatch: batch => {
        batches.push(batch); events.push('save');
        current = { ...current, lastScanTs: batch.lastScanTs,
          ...(batch.parserRereadComplete ? { parserVersion: 39 } : {}) };
        return { ids: [], durable: Promise.resolve().then(() => { events.push('durable'); }) };
      },
      stageReviewAlerts: () => ({ admitted: 1, durable: Promise.resolve().then(() => { events.push('review-durable'); }) }),
      ensureDurable: async () => { events.push('flush'); },
    },
    dependencies: {
      // Planning is explicitly empty to isolate the collector/executor cursor
      // contract; separate importer suites own money and dedupe behavior.
      planRows: (_rows, state, newestTs) => ({ txCount: 0, dueCount: 0, healedCount: 0,
        newAccountCount: 0, batch: { lastScanTs: Math.max(state.lastScanTs, newestTs) } }),
    },
  });
  return { capture, executor, events, requested, batches, getState: () => current };
}

test('ten empty incremental scans keep the original watermark and never schedule a ledger save', async () => {
  const h = harness();
  for (let i = 0; i < 10; i++) {
    const result = await h.executor.execute('routine');
    assert.equal(result.kind, 'up-to-date');
  }
  assert.equal(h.getState().lastScanTs, 1000);
  assert.deepEqual(h.requested, Array(10).fill(1001));
  assert.equal(h.batches.length, 0);
  assert.deepEqual(h.events, Array(10).fill('commit'));
});

test('a real ignored or declined message at the exact next millisecond still advances durably', async () => {
  for (const result of [
    { inboxScannedCount: 1, scannedCount: 1 },
    { declined: [{ smsTs: 1001, reason: 'non-posting' }] },
  ]) {
    const h = harness(result);
    await h.executor.execute('routine');
    assert.equal(h.getState().lastScanTs, 1001);
    assert.deepEqual(h.events, ['save', 'durable', 'commit']);
  }
});

test('a review-only inbox page stages review before advancing the cursor and acknowledging', async () => {
  const h = harness({ inboxScannedCount: 1, scannedCount: 1, newestTs: 1200,
    reviewCandidates: [{ id: 'synthetic-review' }] });
  await h.executor.execute('routine');
  assert.equal(h.getState().lastScanTs, 1200);
  assert.deepEqual(h.events, ['review-durable', 'save', 'durable', 'commit']);
});

test('a notification-only scan retains its new timestamp and post-durability acknowledgement', async () => {
  const h = harness({ scannedCount: 1, newestTs: 1300, parsed: [{ smsTs: 1300, channel: 'push' }] });
  await h.executor.execute('routine');
  assert.equal(h.getState().lastScanTs, 1300);
  assert.deepEqual(h.events, ['save', 'durable', 'commit']);
});

test('completed historical rereads still save the migration receipt even without ledger changes', async () => {
  const h = harness({ inboxScannedCount: 4, scannedCount: 4, newestTs: 900 }, { parserVersion: 38 });
  await h.executor.execute('routine');
  assert.deepEqual(h.requested, [0]);
  assert.equal(h.batches[0].parserRereadComplete, true);
  assert.equal(h.getState().parserVersion, 39);
  assert.equal(h.getState().lastScanTs, 1000);
  assert.deepEqual(h.events, ['save', 'durable', 'commit']);
});

test('a genuinely empty first ledger can save its version receipt without inventing a timestamp', async () => {
  const h = harness({}, { parserVersion: 38, lastScanTs: 0 });
  await h.executor.execute('routine');
  assert.equal(h.getState().parserVersion, 39);
  assert.equal(h.getState().lastScanTs, 0);
  assert.deepEqual(h.events, ['save', 'durable', 'commit']);
});

test('restricted or unfinished historical scans still fail before any cursor write or acknowledgement', async () => {
  for (const result of [{}, { inboxScannedCount: 1, scannedCount: 1, inboxHistoryComplete: false }]) {
    const h = harness(result, { parserVersion: 38, transactions: [{ source: 'sms' }] });
    await assert.rejects(h.executor.execute('routine'), error => error.code === 'ERR_SMS_HISTORY_UNAVAILABLE');
    assert.equal(h.getState().parserVersion, 38);
    assert.equal(h.getState().lastScanTs, 1000);
    assert.deepEqual(h.events, []);
  }
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const { createInboxRefreshScheduler } = load(path.join(root, 'src/lib/inbox-refresh-scheduler.ts'));

test('one burst of provider notifications causes one refresh, not one per URI', async t => {
  let calls = 0;
  const owner = createInboxRefreshScheduler(async () => { calls++; }, () => true, 5);
  t.after(() => owner.dispose());
  for (let i = 0; i < 15; i++) owner.request();
  await delay(25); assert.equal(calls, 1);
});

test('a provider change during a running read earns exactly one subsequent read', async t => {
  let calls = 0, finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const owner = createInboxRefreshScheduler(async () => { if (++calls === 1) await gate; }, () => true, 5);
  t.after(() => owner.dispose());
  owner.request(); await delay(20); assert.equal(calls, 1);
  for (let i = 0; i < 10; i++) owner.request();
  finish(); await delay(25); assert.equal(calls, 2);
});

test('backgrounding or revoking capture prevents reads; resume requests catch up', async t => {
  let eligible = false, calls = 0;
  const owner = createInboxRefreshScheduler(async () => { calls++; }, () => eligible, 5);
  t.after(() => owner.dispose());
  owner.request(); await delay(20); assert.equal(calls, 0);
  eligible = true; owner.request(); await delay(20); assert.equal(calls, 1);
  owner.request(); eligible = false; await delay(20); assert.equal(calls, 1);
  owner.dispose(); eligible = true; owner.request(); await delay(20); assert.equal(calls, 1);
});

test('a failed refresh releases its single-flight gate for the next real change', async t => {
  let calls = 0;
  const owner = createInboxRefreshScheduler(async () => { if (++calls === 1) throw Error('fixture'); }, () => true, 5);
  t.after(() => owner.dispose());
  owner.request(); await delay(20); owner.request(); await delay(20); assert.equal(calls, 2);
});

function captureProbe(page) {
  let args;
  const module = load(path.join(root, 'src/lib/capture.ts'), {
    '@/lib/auto-import': { isSmsScanningAvailable: () => true, scanInbox: async (...values) => { args = values; return page; } },
    '@/lib/background-relay-storage': {},
    '@/lib/relay': { isRelayPlatform: () => false },
    '@/lib/sms-parser': { PARSER_VERSION: 40 },
    '@/lib/review-source-bindings': { collectLegacyReviewSourceKeys: () => [] },
  });
  return { collect: module.collectNewMessages, args: () => args };
}
const state = { hydrated: true, parserVersion: 39, lastScanTs: 100,
  captureOptOut: false, privateMode: false, merchantOverrides: {}, transactions: [{ source: 'sms' }] };
const page = { parsed: [], reviewCandidates: [], declined: [], newestTs: 200,
  scannedCount: 1000, inboxScannedCount: 1000, inboxHistoryComplete: false,
  nextCursor: { beforeDateMs: 150, beforeId: 27 }, commit: async () => {} };

test('a parser upgrade processes one newest page, then hands off a durable resume cursor', async () => {
  const p = captureProbe(page), result = await p.collect(state);
  assert.equal(p.args()[0], 0); assert.equal(p.args()[4].maxInboxPages, 1);
  assert.equal(result.historicalReread, false, 'partial history must not stamp parser completion');
  assert.equal(result.historyImport.status, 'paused');
  assert.deepEqual(result.historyImport.cursor, page.nextCursor);
  assert.equal(result.historyImport.scanned, 1000);
  assert.equal(state.parserVersion, 39, 'collection is read-only');
});

test('ordinary incremental capture reads only the next watermark and does not create history work', async () => {
  const p = captureProbe({ ...page, inboxHistoryComplete: true, nextCursor: null });
  const result = await p.collect({ ...state, parserVersion: 40 });
  assert.equal(p.args()[0], 101); assert.equal(result.historyImport, undefined);
  assert.equal(result.historicalReread, false);
});

test('a completed short history earns parser completion; missing provider or cursor never does', async () => {
  const p = captureProbe({ ...page, inboxHistoryComplete: true, nextCursor: null });
  assert.equal((await p.collect(state)).historicalReread, true);
  await assert.rejects(() => captureProbe({ ...page, nextCursor: null }).collect(state));
  await assert.rejects(() => captureProbe({ ...page, inboxScannedCount: 0 }).collect(state));
});

test('the history handoff shares the same durable ledger write even when no money changes', async () => {
  const collected = await captureProbe(page).collect(state), writes = [], events = [];
  collected.commit = async () => { events.push('ack'); };
  const batch = { transactions: [], newAccounts: [], newHints: {}, newDues: [], newBills: [], snapshots: {},
    bankNames: {}, cardTypes: {}, lastScanTs: 200, updates: [] };
  const { createCaptureExecutor } = load(path.join(root, 'src/lib/capture-executor.ts'), {
    '@/lib/auto-import': {}, '@/lib/capture': {}, '@/lib/relay': {},
    '@/lib/capture-trace': { captureTrace: () => {}, captureTraceEnabled: () => false },
  });
  const run = durable => createCaptureExecutor({ ledger: {
    getState: () => state, ensureDurable: async () => {},
    importBatch: input => { writes.push(input); return { ids: [], durable }; },
  }, dependencies: {
    collectRoutine: async () => collected,
    planRows: () => ({ batch, txCount: 0, healedCount: 0, dueCount: 0, newAccountCount: 0 }),
  } });
  await run(Promise.resolve()).execute('routine');
  assert.equal(writes[0].historyImport, collected.historyImport);
  assert.equal(writes[0].parserRereadComplete, undefined);
  assert.deepEqual(events, ['ack']);
  events.length = 0;
  await assert.rejects(() => run(Promise.reject(Error('storage fixture'))).execute('routine'));
  assert.deepEqual(events, [], 'failed durability never acknowledges a page');
});

test('native change events carry no bank data and release their observer on shutdown', () => {
  const native = fs.readFileSync(path.join(root, 'modules/sms-reader/android/src/main/java/expo/modules/smsreader/SmsReaderModule.kt'), 'utf8');
  assert.match(native, /Events\("onInboxChanged"\)/);
  assert.match(native, /sendEvent\("onInboxChanged", emptyMap<String, Any>\(\)\)/);
  assert.match(native, /OnStopObserving \{ stopInboxObservation\(\) \}/);
  assert.match(native, /OnDestroy \{ stopInboxObservation\(\) \}/);
  assert.match(native, /registerContentObserver\(Telephony.Sms.CONTENT_URI, true, observer\)/);
});

test('transfer history belongs to Accounts; Settings does not require classifying ordinary transfers', () => {
  const { createHarness, walk } = require('./reference-harness.cjs');
  const h = createHarness();
  const wallet = h.render('wallet');
  const action = walk(wallet).find(n => n.props?.accessibilityLabel === h.deps['@/lib/i18n'].t('accountTransferHistory') && n.props?.onPress);
  assert.ok(action); action.props.onPress(); assert.deepEqual(h.events.at(-1), ['route', '/review-transfers']);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'src/app/settings.tsx'), 'utf8'), /router\.push\('\/review-transfers'\)/);
});

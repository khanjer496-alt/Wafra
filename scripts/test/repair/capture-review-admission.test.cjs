// Public regressions preserve the reported bank wording with synthetic card/amount values.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const built = name => require(path.join(root, 'scripts/test/build', name));
const current = new Map();
let notifications = [], inbox = [], acknowledged = [];
let failAck = false;
const notificationReader = { isAvailable: () => true, isEnabled: () => true,
  getCaptured: async () => notifications,
  ackCaptured: async ids => {
    if (failAck) return false;
    acknowledged.push(...ids);
    notifications = notifications.filter(row => !ids.includes(row.id));
    return true;
  } };
const smsReader = {
  getInboxSms: async (since, before, beforeId, max) => inbox.filter(row => row.date >= since &&
    (row.date < before || (row.date === before && row.id < beforeId)))
    .sort((a, b) => b.date - a.date || b.id - a.id).slice(0, max),
  getReceived: async () => [],
};
built('stub-react-native').Platform.OS = 'android';
built('stub-secure-store').__keychain.items.set('wafra.database.key.v1', 'a5'.repeat(32));
Object.assign(built('stub-expo-crypto'), { CryptoDigestAlgorithm: { SHA256: 'sha256' },
  digestStringAsync: async (_, text) => crypto.createHash('sha256').update(text).digest('hex') });
function source(name, overrides = {}) {
  const file = path.join(root, 'src/lib', `${name}.ts`);
  const deps = { 'react-native': built('stub-react-native'), 'expo-crypto': built('stub-expo-crypto'),
    '@/lib/capture': { collectNewMessages: () => { throw new Error('explicit collection required'); } },
    '@/lib/relay': {},
    'expo-secure-store': built('stub-secure-store'),
    '../../modules/notification-reader': { __esModule: true, default: notificationReader },
    '../../modules/sms-reader': { __esModule: true, default: smsReader }, ...overrides };
  for (const match of fs.readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    if (Object.hasOwn(deps, match[1])) continue;
    const dep = match[1].startsWith('@/lib/') ? match[1].slice(6) : null;
    Object.defineProperty(deps, match[1], { enumerable: true, get: () => dep ? current.get(dep) ?? built(dep) : require(match[1]) });
  }
  const result = load(file, deps);
  current.set(name, result);
  return result;
}
source('statement-import-flow');
source('parsed-review-event');
const { scanInbox } = source('auto-import');
const local = source('local-message-record');
const { createCaptureExecutor } = source('capture-executor');
const now = Date.now();
const receipt = 'Your payment of AED 9251 against Credit Card no. XXX9426 was received at 12:10 PM on 30/09/2026. Thank you.';
function reset() {
  notifications = []; inbox = []; acknowledged = []; failAck = false;
  built('markets').setActiveMarket('AE'); built('markets').setLedgerCurrency('AED', 2);
}
// Explicit queue-volume mutations of an established purchase fixture; this
// exercises admission identities and does not claim a new bank SMS format.
const row = i => ({ id: `audit-notification-${String(i).padStart(4, '0')}`,
  pkg: 'com.example.finance', appLabel: 'Example', title: 'Payment',
  text: `Purchase of AED ${50 + i}.00 at CARREFOUR with Debit Card ending 1234`,
  ts: now - 200000 + i * 1000, sourceClass: 'financial-candidate' });
test('51 pending notifications retain every Review observation until returned for durable staging', async () => {
  reset(); notifications = Array.from({ length: 51 }, (_, i) => row(i));
  const first = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
  assert.equal(first.reviewCandidates.length, 50);
  assert.equal(acknowledged.length, 0, 'collection does not acknowledge before persistence');
  await first.commit();
  assert.equal(acknowledged.length, 50);
  assert.equal(notifications.length, 1);
  assert.ok(!first.reviewCandidates.some(item => item.observedAt === notifications[0].ts));
  const second = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
  assert.equal(second.reviewCandidates.length, 1);
  await second.commit();
  assert.equal(notifications.length, 0);
  assert.equal(new Set(acknowledged).size, 51);
});
test('newer inbox reviews cannot delete a queued notification displaced by the collector cap', async () => {
  reset(); notifications = [row(0)];
  inbox = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, address: 'BNPPARIBAS',
    body: `BNP Paribas: Paiement par carte débité de EUR ${10 + i},34 chez PRIVATE-BOUTIQUE`, date: now - 50000 + i * 1000 }));
  const result = await scanInbox(0, {}, undefined, 'en-AE');
  assert.equal(result.reviewCandidates.length, 50);
  await result.commit();
  assert.equal(acknowledged.length, 0);
  assert.equal(notifications.length, 1);
  inbox = [];
  const retry = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
  assert.equal(retry.reviewCandidates.length, 1);
  await retry.commit();
  assert.equal(notifications.length, 0);
});
test('multiple queue IDs for the same retained review are acknowledged together, with failed ACK retry', async () => {
  reset(); notifications = [row(0), { ...row(0), id: 'audit-notification-copy-0000' }];
  const result = await scanInbox(0, {}, undefined, 'en-AE', { notificationOnly: true });
  assert.equal(result.reviewCandidates.length, 1);
  failAck = true;
  await assert.rejects(result.commit(), /acknowledgement failed/);
  assert.equal(notifications.length, 2);
  failAck = false;
  await result.commit();
  assert.equal(notifications.length, 0);
  assert.equal(acknowledged.length, 2);
});
test('foreign-ledger card payment Review preserves receipt settlement and refuses ordinary spending', () => {
  reset();
  const recordId = '20000000-0000-4000-8000-000000000001';
  // Exercise the structured boundary with the exact parser facts. A globally
  // pinned USD runtime currently refuses regional parsing earlier; this keeps
  // the conflict adapter safe when supplied already-parsed settlement facts.
  const serialized = JSON.stringify({ v: 1, id: recordId, text: receipt, sender: 'ADCB',
    source: 'message', observedAt: new Date(now).toISOString() });
  const outcome = local.parseLocalMessageRecord(serialized, new Date(now), 'AE',
    built('launch-alert-parser').createLaunchAlertSession({ overrides: {}, activeMarket: 'AE',
      pinnedCurrency: 'AED', bestEffort: { enabled: false, country: null } }));
  assert.equal(outcome.kind, 'parsed');
  const parsed = outcome.row;
  assert.equal(parsed.kind, 'cardPayment');
  assert.equal(parsed.cardPaymentSide, 'receipt');
  built('markets').setLedgerCurrency('USD', 2);
  const review = local.currencyConflictReview(outcome, recordId);
  const event = review.item.event;
  assert.equal(event.family, 'card-payment');
  assert.equal(event.direction, 'credit');
  const state = { hydrated: true, marketId: 'AE', ledgerMoney: { schemaVersion: 2, currency: 'USD', exponent: 2 },
    transactions: [], accounts: [{ id: 'card', kind: 'card', last4: '9426', cardType: 'credit' }] };
  for (const direction of ['debit', 'credit']) {
    const result = built('universal-import').planConfirmedUniversalImport(state, event, {
      confirmed: true, postingStatus: 'posted', amount: event.amount.value, direction, accountId: 'card',
      title: 'Card payment', category: 'other', date: '2026-09-30', sourceKey: review.item.sourceKey, observedAt: now,
    }, { base: 'AED', quote: 'USD', rate: 0.2723, date: '2026-09-30' });
    assert.equal(result.reason, 'unsupported-event');
  }
});

function executorHarness(reviewTray = built('alert-review-tray').emptyAlertReviewTray()) {
  let state = { hydrated: true, privateMode: true, captureOptOut: false, marketId: 'AE',
    ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 }, reviewTray,
    accounts: [], transactions: [], budgets: [], bills: [], goals: [], cardDues: [],
    accountHints: {}, merchantOverrides: {}, billAliases: {}, notSubscriptions: [], lastScanTs: 1 };
  let durable = Promise.resolve(), serial = 0, generation = 0;
  const ledger = {
    getState: () => state, getStateGeneration: () => generation, ensureDurable: () => durable,
    stageReviewAlerts(items) {
      const batch = built('alert-review-tray').admitPreparedReviewAlerts(state.reviewTray, items, Date.now());
      state = { ...state, reviewTray: batch.state };
      return { admitted: batch.outcomes.filter(value => value === 'admitted').length, durable };
    },
    importBatch(batch) {
      const api = built('ledger-import');
      const materialized = api.materializeImportBatch(batch, state, prefix => `${prefix}-${++serial}`);
      state = api.applyMaterializedImportBatch(state, materialized);
      return { ids: materialized.transactions?.map(tx => tx.id) ?? [], durable };
    },
  };
  return { get state() { return state; }, setDurable(value) { durable = value; },
    updateState(patch) { state = { ...state, ...patch }; },
    importRows(rows) {
      const plan = built('import-plan').buildImportPlan(rows, state, now, new Date(now));
      return ledger.importBatch(plan.batch);
    },
    replaceLedger() { state = { ...state, reviewTray: built('alert-review-tray').emptyAlertReviewTray() }; generation += 1; },
    loseReviews(outcome) {
      const tombstones = outcome ? state.reviewTray.pending.map(item => ({ sourceKey: item.sourceKey,
        resolvedAt: Date.now(), expiresAt: Date.now() + 86400000, outcome })) : [];
      state = { ...state, reviewTray: { ...state.reviewTray, pending: [], tombstones } };
    },
    resolveOldest() {
      state = { ...state, reviewTray: built('alert-review-tray').resolveReviewAlert(
        state.reviewTray, state.reviewTray.pending[0].id, 'dismissed', Date.now()) };
    },
    run(notificationOnly = true, collection = {}) {
      return createCaptureExecutor({ ledger, dependencies: {
        collectRoutine: async (_state, options) => ({ ...await scanInbox(0, {}, undefined, 'en-AE', { ...options, notificationOnly }),
          source: notificationOnly ? 'push' : 'sms', needsSetup: false, ...collection }),
      } }).execute(notificationOnly ? 'notification-only' : 'routine');
    },
    runRelay(collectRoutine) {
      state = { ...state, privateMode: false };
      return createCaptureExecutor({ ledger, dependencies: { collectRoutine, getRelay: async () => null } }).execute('routine');
    },
    runSupplemental(queued, acked, overrides = {}) {
      state = { ...state, privateMode: false };
      return createCaptureExecutor({ ledger, dependencies: {
        getRelay: async () => ({ setupState: 'verified' }), sync: async () => queued,
        acknowledge: async (_cfg, ids) => { acked.push(...ids); },
        ...overrides,
      } }).execute('supplemental');
    },
    runSetup(queued, acked) {
      state = { ...state, privateMode: false };
      return createCaptureExecutor({ ledger, dependencies: {
        getRelay: async () => ({ setupState: 'verified' }), sync: async () => queued,
        markVerified: async cfg => ({ ...cfg, verifiedAt: now }),
        acknowledge: async (_cfg, ids) => { acked.push(...ids); },
      } }).execute('setup-verification');
    } };
}

function relayReview(index) {
  const candidate = current.get('auto-import').parsedFinancialCandidateReview(
    built('sms-parser').parseSms(row(index).text), now - 1000 + index);
  return { ...candidate, id: `relay_review_id_${index}`, sourceKey: `relay_review_source_${index}`, channel: 'shortcut' };
}
function relayCollector(queued, staged = []) {
  const acked = [], disk = new Map([['wafra/background-relay/v1', JSON.stringify(staged)]]);
  const collect = source('capture', {
    '@/lib/auto-import': { isSmsScanningAvailable: () => false },
    '@/lib/background-relay-storage': { BACKGROUND_RELAY_ERASE_PENDING_KEY: 'erase', backgroundRelayStorage: {
      getItem: async key => disk.get(key) ?? null, removeItem: async key => { disk.delete(key); },
      removeItemIfUnchanged: async (key, snapshot) => { if (disk.get(key) === snapshot) disk.delete(key); },
    } },
    '@/lib/relay': { isRelayPlatform: () => true, isRelayRevokedError: () => false,
      getRelayConfig: async () => ({ setupState: 'verified' }), syncRelay: async () => queued,
      ackRelay: async (_cfg, ids) => { acked.push(...ids); } },
  }).collectNewMessages;
  return { collect, acked, disk };
}
test('relay collector filters queue IDs by exact review mapping, preserving probes and clearing committed staged rows', async () => {
  reset(); const first = relayReview(1), second = relayReview(2);
  const queued = { parsed: [], reviewCandidates: [first, second], ids: ['sealed-second', 'sealed-first', 'parsed-row', 'probe'],
    reviewIds: ['sealed-second', 'sealed-first'], testIds: ['probe'], reviewSourceKeysById: new Map([
      ['sealed-second', second.sourceKey], ['sealed-first', first.sourceKey] ]) };
  const h = relayCollector(queued, [{ merchant: 'Already parsed', amountFils: 100, smsTs: now }]);
  const result = await h.collect({ privateMode: false, lastScanTs: 0 });
  await result.commit([first.sourceKey]);
  assert.deepEqual(h.acked, ['sealed-second', 'parsed-row']);
  assert.equal(h.disk.has('wafra/background-relay/v1'), false);
});
test('relay review IDs lacking source mapping are held when any review is deferred', async () => {
  const h = relayCollector({ parsed: [], reviewCandidates: [relayReview(1)], ids: ['review-row', 'parsed-row'],
    reviewIds: ['review-row'], testIds: [] });
  const result = await h.collect({ privateMode: false, lastScanTs: 0 });
  await result.commit(['relay_review_source_1']);
  assert.deepEqual(h.acked, ['parsed-row']);
});
test('routine relay respects a full money Review tray and selectively ACKs safe siblings', async () => {
  reset(); notifications = Array.from({ length: 50 }, (_, i) => row(i));
  const h = executorHarness(); await h.run();
  const item = relayReview(200);
  const relay = relayCollector({ parsed: [], reviewCandidates: [item], ids: ['review-row', 'safe-row', 'probe'],
    reviewIds: ['review-row'], testIds: ['probe'], reviewSourceKeysById: new Map([['review-row', item.sourceKey]]) });
  await h.runRelay(relay.collect);
  assert.equal(h.state.reviewTray.pending.length, 50);
  assert.ok(!h.state.reviewTray.pending.some(candidate => candidate.id === item.id));
  assert.deepEqual(relay.acked, ['safe-row']);
  h.resolveOldest(); relay.acked.length = 0;
  await h.runRelay(relay.collect);
  assert.ok(h.state.reviewTray.pending.some(candidate => candidate.id === item.id));
  assert.deepEqual(relay.acked, ['review-row', 'safe-row']);
});
test('supplemental relay retains money at capacity, ACKs safe siblings, and resumes after a review decision', async () => {
  reset(); notifications = Array.from({ length: 50 }, (_, i) => row(i));
  const h = executorHarness(); await h.run();
  const item = relayReview(201), acked = [];
  const queued = { parsed: [], reviewCandidates: [item], ids: ['review-row', 'safe-row', 'probe'],
    pageFull: true,
    reviewIds: ['review-row'], testIds: ['probe'], reviewSourceKeysById: new Map([['review-row', item.sourceKey]]) };
  const progress = await h.runSupplemental(queued, acked);
  assert.equal(h.state.reviewTray.pending.length, 50);
  assert.ok(!h.state.reviewTray.pending.some(candidate => candidate.id === item.id));
  assert.deepEqual(acked, ['safe-row']);
  assert.equal(progress.moreQueued, true);
  assert.equal(progress.deferredReviews, 1);
  const blocked = await h.runSupplemental({ ...queued, ids: ['review-row'], testIds: [] }, []);
  assert.equal(blocked.deferredReviews, 1);
  assert.equal(blocked.moreQueued, false, 'a page held entirely by capacity must not trigger a tight drain loop');
  h.resolveOldest(); acked.length = 0;
  await h.runSupplemental(queued, acked);
  assert.ok(h.state.reviewTray.pending.some(candidate => candidate.id === item.id));
  assert.deepEqual(acked, ['review-row', 'safe-row']);
});
for (const replace of [false, true]) test(`supplemental relay keeps review rows when ${replace ? 'restore replaces ledger' : 'review disappears'} during persistence`, async () => {
  reset(); const h = executorHarness(), item = relayReview(202), acked = [];
  const queued = { parsed: [], reviewCandidates: [item], ids: ['review-row'], reviewIds: ['review-row'],
    testIds: [], reviewSourceKeysById: new Map([['review-row', item.sourceKey]]) };
  let release;
  h.setDurable(new Promise(resolve => { release = resolve; }));
  const pending = h.runSupplemental(queued, acked);
  await new Promise(resolve => setTimeout(resolve, 10));
  if (replace) h.replaceLedger(); else h.loseReviews('evicted');
  release(); await pending;
  assert.deepEqual(acked, []);
});
const postingRow = () => ({ ...built('sms-parser').parseSms(row(0).text), bankHint: 'Emirates NBD',
  sender: 'ENBD', market: 'AE', smsTs: now, date: '2026-09-30', channel: 'inbox', sourceEventId: 'a999' });
test('supplemental planning notices a concurrent import during its first foreground yield', async () => {
  reset(); const h = executorHarness(), parsed = postingRow(), acked = [];
  const queued = { parsed: [parsed], ids: ['posting-row'], testIds: [] };
  const result = await h.runSupplemental(queued, acked, {
    sync: async () => { setTimeout(() => h.importRows([parsed]), 0); return queued; },
  });
  assert.equal(result.transactions, 0, 'the competing import already recorded the exact source');
  assert.equal(h.state.transactions.length, 1);
  assert.equal(h.state.accounts.length, 1);
  assert.deepEqual(acked, ['posting-row']);
});
test('supplemental replans an account deletion during the yield before applying its batch', async () => {
  reset(); const h = executorHarness(), parsed = postingRow(), acked = [];
  h.updateState({ accounts: [{ id: 'deleted-card', name: 'Emirates NBD', bankName: 'Emirates NBD',
    kind: 'card', cardType: 'debit', last4: '1234', openingFils: 0 }], accountHints: { '1234': 'deleted-card' } });
  let scheduled = false;
  await h.runSupplemental({ parsed: [parsed], ids: ['posting-row'], testIds: [] }, acked, {
    planRows: (...args) => {
      const plan = built('import-plan').buildImportPlan(...args);
      if (!scheduled) {
        scheduled = true;
        setTimeout(() => h.updateState({ accounts: [], accountHints: {} }), 0);
      }
      return plan;
    },
  });
  assert.equal(h.state.transactions.length, 1);
  const posted = h.state.transactions[0];
  assert.ok(h.state.accounts.some(account => account.id === posted.accountId), 'the posting must reference a currently existing account');
  assert.notEqual(posted.accountId, 'deleted-card');
  assert.deepEqual(acked, ['posting-row']);
});
for (const proof of [false, true]) test(`setup verification retains capacity-deferred reviews ${proof ? 'while retiring its own probe' : 'without proof'}`, async () => {
  reset(); notifications = Array.from({ length: 50 }, (_, i) => row(i));
  const h = executorHarness(); await h.run();
  const item = relayReview(203), acked = [];
  const queued = { parsed: [], reviewCandidates: [item], ids: ['review-row', 'safe-row', ...(proof ? ['probe'] : [])],
    reviewIds: ['review-row'], testIds: proof ? ['probe'] : [], testReceived: proof ? 1 : 0,
    reviewSourceKeysById: new Map([['review-row', item.sourceKey]]) };
  const result = await h.runSetup(queued, acked);
  assert.equal(h.state.reviewTray.pending.length, 50);
  assert.ok(!h.state.reviewTray.pending.some(candidate => candidate.id === item.id));
  assert.deepEqual(acked, ['safe-row', ...(proof ? ['probe'] : [])]);
  assert.equal(result.kind, proof ? 'setup-observed' : 'setup-waiting');
});
for (const replace of [false, true]) test(`setup verification revalidates ${replace ? 'ledger generation' : 'review claims'} after persistence`, async () => {
  reset(); const h = executorHarness(), item = relayReview(204), acked = [];
  const queued = { parsed: [], reviewCandidates: [item], ids: ['review-row', 'probe'], reviewIds: ['review-row'],
    testIds: ['probe'], testReceived: 1, reviewSourceKeysById: new Map([['review-row', item.sourceKey]]) };
  let release;
  h.setDurable(new Promise(resolve => { release = resolve; }));
  const pending = h.runSetup(queued, acked);
  await new Promise(resolve => setTimeout(resolve, 10));
  if (replace) h.replaceLedger(); else h.loseReviews('evicted');
  release(); await pending;
  assert.deepEqual(acked, replace ? [] : ['probe']);
});
test('a full durable tray retains queued money while safe siblings ACK and a freed slot makes progress', async () => {
  reset(); notifications = Array.from({ length: 50 }, (_, i) => row(i));
  const full = executorHarness();
  await full.run();
  assert.equal(full.state.reviewTray.pending.length, 50);
  assert.equal(notifications.length, 0);
  const originalKeys = full.state.reviewTray.pending.map(item => item.sourceKey);
  notifications = [row(100), row(101), { ...row(102), pkg: 'com.adcb.nexgen',
    sourceClass: 'trusted-bank', title: 'ADCB', text: 'Your transaction of AED 500.00 at SHARAF DG was declined due to insufficient funds.' }];
  acknowledged = [];
  await full.run();
  assert.equal(notifications.length, 2);
  assert.deepEqual(full.state.reviewTray.pending.map(item => item.sourceKey), originalKeys);
  assert.deepEqual(acknowledged, [row(102).id]);
  full.resolveOldest();
  await full.run();
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].id, row(101).id, 'oldest queued review takes the available slot');
  full.resolveOldest();
  await full.run();
  assert.equal(notifications.length, 0);
});
test('review persistence failure prevents all ACKs and retries the same queued evidence', async () => {
  reset(); notifications = [row(110)];
  const h = executorHarness();
  let reject;
  h.setDurable(new Promise((_, no) => { reject = no; }));
  const run = h.run();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(acknowledged.length, 0);
  reject(new Error('durable-write-failed'));
  await assert.rejects(run, /durable-write-failed/);
  assert.equal(notifications.length, 1);
  h.setDurable(Promise.resolve());
  await h.run();
  assert.equal(notifications.length, 0);
});
test('capacity-deferred inbox reviews preserve the inbox watermark', async () => {
  reset(); notifications = Array.from({ length: 50 }, (_, i) => row(i));
  const h = executorHarness(); await h.run();
  const watermark = h.state.lastScanTs;
  inbox = [{ id: 99, address: 'BNPPARIBAS', body: 'BNP Paribas: Paiement par carte débité de EUR 42,34 chez PRIVATE-BOUTIQUE', date: now }];
  await h.run(false);
  assert.equal(h.state.lastScanTs, watermark);
  assert.equal(h.state.reviewTray.pending.length, 50);
});
test('collector cropping also preserves the inbox watermark before any tray existed', async () => {
  reset();
  inbox = Array.from({ length: 51 }, (_, i) => ({ id: i + 1, address: 'BNPPARIBAS',
    body: `BNP Paribas: Paiement par carte débité de EUR ${10 + i},34 chez PRIVATE-BOUTIQUE`, date: now - 50000 + i * 1000 }));
  const h = executorHarness();
  await h.run(false);
  assert.equal(h.state.lastScanTs, 1);
  assert.equal(h.state.reviewTray.pending.length, 50);
  h.resolveOldest();
  await h.run(false);
  assert.equal(h.state.reviewTray.pending.length, 50);
  assert.ok(h.state.reviewTray.pending.some(item => item.observedAt === now - 50000), 'known sources no longer hide the cropped oldest inbox review');
  assert.equal(h.state.lastScanTs, 1, 'pending overlap keeps cursor backpressure during persistence');
  while (h.state.reviewTray.pending.length) h.resolveOldest();
  await h.run(false);
  assert.equal(h.state.lastScanTs, now, 'final review decisions release cursor backpressure');
});
test('a known in-memory review is ACKed only after durability and cannot survive an erase/restore generation change', async () => {
  reset(); notifications = [row(120)];
  const h = executorHarness(); await h.run();
  notifications = [row(120)]; acknowledged = [];
  let release;
  h.setDurable(new Promise(resolve => { release = resolve; }));
  const pending = h.run();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(acknowledged.length, 0);
  h.replaceLedger();
  release();
  await pending;
  assert.equal(acknowledged.length, 0);
  assert.equal(notifications.length, 1);
  h.setDurable(Promise.resolve());
  await h.run();
  assert.equal(h.state.reviewTray.pending.length, 1);
  assert.equal(notifications.length, 0);
});
for (const outcome of [undefined, 'evicted', 'expired']) test(`a same-generation ${outcome ?? 'missing'} review cannot authorize native ACK`, async () => {
  reset(); notifications = [row(120)];
  const h = executorHarness(); await h.run();
  notifications = [row(120)]; acknowledged = [];
  let release;
  h.setDurable(new Promise(resolve => { release = resolve; }));
  const pending = h.run();
  await new Promise(resolve => setTimeout(resolve, 10));
  h.loseReviews(outcome);
  release(); await pending;
  assert.equal(acknowledged.length, 0);
  assert.equal(notifications.length, 1);
});
test('a vanished skipped inbox review cannot advance its cursor or parser receipt', async () => {
  reset(); notifications = [row(120)];
  inbox = [{ id: 99, address: 'BNPPARIBAS', body: 'BNP Paribas: Paiement par carte débité de EUR 42,34 chez PRIVATE-BOUTIQUE', date: now }];
  const h = executorHarness(); await h.run(false);
  const watermark = h.state.lastScanTs;
  notifications = [row(120)]; acknowledged = [];
  inbox.push({ id: 100, address: 'BNPPARIBAS', body: 'Account settings updated.', date: now + 1000 });
  let release;
  h.setDurable(new Promise(resolve => { release = resolve; }));
  const pending = h.run(false, { recentRereadParserVersion: 999 });
  await new Promise(resolve => setTimeout(resolve, 10));
  h.loseReviews('evicted');
  release(); await pending;
  assert.equal(h.state.lastScanTs, watermark);
  assert.equal(h.state.recentRereadParserVersion, undefined);
  assert.equal(acknowledged.length, 0);
});
test('more than a tray of queued observations all reach a durable outcome after capacity is released', async () => {
  reset(); notifications = Array.from({ length: 60 }, (_, i) => row(i));
  const h = executorHarness();
  await h.run();
  assert.equal(h.state.reviewTray.pending.length, 50);
  assert.equal(notifications.length, 10);
  await h.run();
  assert.equal(notifications.length, 10, 'a full tray does not eat the remaining queued money');
  for (let i = 0; i < 10; i++) h.resolveOldest();
  await h.run();
  assert.equal(notifications.length, 0);
  assert.equal(h.state.reviewTray.pending.length, 50);
  assert.equal(new Set(acknowledged).size, 60);
});
test('ordinary foreign purchase still retains its exact stated amount and converts with a dated quote', () => {
  reset();
  const parsed = built('sms-parser').parseSms('Purchase of AED 50.00 at CARREFOUR with Debit Card ending 1234');
  const outcome = { kind: 'parsed', market: 'AE', milestone: 'financial',
    row: { ...parsed, date: '2026-09-30', smsTs: now, channel: 'inbox' } };
  const review = local.currencyConflictReview(outcome, '20000000-0000-4000-8000-000000000002');
  assert.equal(review.item.event.family, 'purchase');
  assert.equal(review.item.event.amount.value.minorUnits, '5000');
  const converted = local.convertCurrencyConflictRow(outcome, { currency: 'USD', exponent: 2 },
    { base: 'AED', quote: 'USD', rate: 0.2723, date: '2026-09-30' });
  assert.equal(converted.row.amountFils, 1362);
  assert.equal(converted.row.originalMinorUnits, 5000);
  assert.equal(converted.row.fxSource, 'reference');
});

test('a failed supplemental ACK reports its durable transaction without posting it twice', async () => {
  reset(); const h = executorHarness(), parsed = postingRow(), acked = [];
  const queued = { parsed: [parsed], ids: ['posting-row'], testIds: [] };
  let failed;
  try { await h.runSupplemental(queued, acked, { acknowledge: async () => { throw new Error('ack failed'); } }); }
  catch (error) { failed = error; }
  assert.equal(failed.imported, 1);
  assert.equal(h.state.transactions.length, 1);
  const retry = await h.runSupplemental(queued, acked);
  assert.equal(retry.transactions, 0);
  assert.equal(h.state.transactions.length, 1);
});

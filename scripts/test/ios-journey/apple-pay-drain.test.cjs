'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const build = process.env.WAFRA_TEST_BUILD_DIR || path.join(root, 'scripts/test/build');
const subjects = new Set(['local-message-record', 'ios-apple-pay-record', 'alert-review-tray']);
const cache = new Map();
function current(name) {
  if (cache.has(name)) return cache.get(name);
  if (!subjects.has(name)) return require(path.join(build, `${name}.js`));
  const file = path.join(root, `src/lib/${name}.ts`);
  const deps = {};
  for (const [, specifier] of fs.readFileSync(file, 'utf8').matchAll(/from ['"](@\/lib\/[^'"]+)['"]/g))
    deps[specifier] = current(specifier.slice('@/lib/'.length));
  const result = load(file, deps); cache.set(name, result); return result;
}
const records = current('local-message-record'), tray = current('alert-review-tray');
const now = Date.now();
const id = n => `AABBCCDD-1234-4567-89AB-${String(n).padStart(12, '0')}`;
const record = (n, payload = {}) => JSON.stringify({ v: 1, id: id(n), observedAt: new Date(now - 1000).toISOString(),
  source: 'apple-pay', sender: 'Wafra Apple Pay', text: JSON.stringify({ amount: '1.234', currency: 'KWD', merchant: 'TEST SHOP', ...payload }) });
const entry = n => records.parseLocalApplePayRecord(record(n), new Date(now)).item;

test('Apple Pay envelopes route directly to exact review without SMS parsing or market selection', () => {
  const preflight = records.preflightLocalMessageRecord(record(1), new Date(now));
  assert.equal(preflight.valid, true); assert.equal(preflight.source, 'apple-pay'); assert.equal(preflight.market, null);
  const outcome = records.parseLocalMessageRecord(record(1), new Date(now), null,
    { inspect() { throw Error('must not parse'); }, parse() { throw Error('must not parse'); } });
  assert.equal(outcome.kind, 'review'); assert.equal(outcome.milestone, 'none');
  assert.equal(outcome.item.event.amount.value.minorUnits, '1234');
  assert.equal(outcome.item.sourceKey, 'apple_pay_review_source_aabbccdd1234456789ab000000000001');
  for (const mutate of [x => { x.sender = 'BANK'; }, x => { x.id = 'a'.repeat(64); }, x => { x.text = '{invalid'; },
    x => { x.text = JSON.stringify({ amount: '1', currency: 'ZZZ', merchant: 'TEST' }); }, x => { x.extra = 'no'; }]) {
    const value = JSON.parse(record(1)); mutate(value);
    assert.equal(records.parseLocalApplePayRecord(JSON.stringify(value), new Date(now)).kind, 'held');
  }
});

test('Wallet and notifications share a non-evicting quota but retain distinct identities', () => {
  let state = tray.emptyAlertReviewTray();
  for (let i = 0; i < 50; i++) {
    const item = i % 2 ? entry(i) : { ...entry(i), id: `notification_review_id_${i}`, sourceKey: `local_review_source_${String(i).padStart(32, '0')}` };
    state = tray.admitPreparedReviewAlert(state, item, now).state;
  }
  assert.equal(state.pending.length, 50);
  assert.equal(tray.admitPreparedReviewAlert(state, entry(99), now).reason, 'review-capacity');
  assert.equal(tray.isIosApplePayReview(entry(1)), true);
  assert.equal(tray.isIosNotificationReview(entry(1)), false);
  for (let i = 0; i < 60; i++) state = tray.admitPreparedReviewAlert(state,
    { ...entry(i), id: `sms_review_identity_${i}`, sourceKey: `sms_review_source_${i}`, channel: 'inbox' }, now).state;
  assert.equal(state.pending.filter(tray.isProtectedIosCaptureReview).length, 50);
  assert.equal(tray.normalizeAlertReviewTray(JSON.parse(JSON.stringify(state)), now).pending.length, 100);
});

function harness({ wallet = [record(1)], legacy = ['sms'], failDurable = false, refuseReview = false, failAck = false, blockedNotification = false } = {}) {
  let applePay = [...wallet], sms = [...legacy], generation = 1;
  const calls = [], state = { hydrated: true, captureOptOut: false, marketId: 'AE', transactions: [], accounts: [],
    lastScanTs: 0, reviewTray: tray.emptyAlertReviewTray(), localCaptureQualifications: [] };
  const api = load(path.join(root, 'src/lib/ios-local-capture.ts'), {
    '@/lib/ios-capture-health': current('ios-capture-health'),
    '@/lib/import-plan': { buildImportPlan: () => { calls.push('sms-plan'); return { txCount: 0, dueCount: 0, healedCount: 0, newAccountCount: 0,
      declineReconciledCount: 0, declineReconciledIds: [], declineReconciliations: [], batch: {} }; } },
    '@/lib/launch-alert-parser': { createLaunchAlertSession: () => { calls.push('sms-session'); return {}; } },
    '@/lib/alert-review-tray': tray,
    '@/lib/ios-notification-replay': { createIosNotificationReplayGuard: () => outcome => outcome },
    '@/lib/local-message-record': { ...records,
      preflightLocalMessageRecord: value => value === 'sms' ? { id: 'sms-id', valid: true, market: null } : records.preflightLocalMessageRecord(value, new Date(now)),
      parseLocalMessageRecord: value => { assert.equal(value, 'sms'); calls.push('sms-parse'); return blockedNotification
        ? { kind: 'review', market: null, milestone: 'none', item: { ...entry(500), id: 'notification_review_blocked', sourceKey: 'local_review_source_' + 'f'.repeat(32) } }
        : { kind: 'ignored', market: null, milestone: 'none' }; },
    },
    '@/lib/types': { normalizeLocalCaptureQualifications: () => [], isLocalCaptureQualificationCandidate: () => true },
  }, { setTimeout });
  const native = { applePayCaptureSupported: true, purgeExpired: async () => 0, getCaptureStatus: async () => ({ firstCapturedAt: null }),
    listPendingRecords: async () => { calls.push('sms-read'); return [...sms]; },
    listPendingApplePayRecords: async function(limit) { assert.equal(this, native); calls.push('wallet-read'); return applePay.slice(0, limit); },
    acknowledgeRecords: async ids => { calls.push(['ack', ...ids]); if (failAck && ids.some(x => x !== 'sms-id')) throw Error('ack failed');
      if (ids.includes('sms-id')) sms = []; applePay = applePay.filter(x => !ids.includes(JSON.parse(x).id)); },
    recordFirstCapturedAt: async () => { throw Error('Wallet cannot prove SMS'); },
  };
  const ledger = { getState: () => state, getStateGeneration: () => generation,
    setMarket: () => { throw Error('Wallet cannot set market'); }, importBatch: () => { throw Error('Wallet cannot post money'); },
    ensureDurable: async () => { calls.push('barrier'); if (failDurable && sms.length === 0) throw Error('disk failed'); },
    stageReviewAlerts: (items, qualifications) => {
      assert.equal(qualifications, undefined); let admitted = 0; calls.push('review');
      if (!refuseReview) for (const item of items) {
        if (blockedNotification && tray.isIosNotificationReview(item)) continue;
        const next = tray.admitPreparedReviewAlert(state.reviewTray, item, now); state.reviewTray = next.state; admitted += next.outcome === 'admitted' ? 1 : 0;
      }
      return { admitted, durable: failDurable ? Promise.reject(Error('disk failed')) : Promise.resolve() };
    },
  };
  const coordinator = api.createIosLocalCaptureCoordinator({ native, ledger, retireShortcutCapture: async () => { throw Error('Wallet cannot retire SMS'); } });
  return { coordinator, calls, state, native, ledger, replaceLedger: () => generation++, queue: () => applePay,
    permitAck: () => { failAck = false; }, permitReview: () => { refuseReview = false; } };
}

test('SMS drains first, then Wallet reviews durably before exact ACK without SMS milestones', async () => {
  const h = harness(); const result = await h.coordinator.drain();
  assert.equal(result.reviews, 1); assert.equal(result.firstCapturedAt, null); assert.equal(h.queue().length, 0);
  assert.ok(h.calls.findIndex(x => Array.isArray(x) && x.includes('sms-id')) < h.calls.indexOf('wallet-read'));
  assert.ok(h.calls.indexOf('review') < h.calls.findIndex(x => Array.isArray(x) && x.includes(id(1))));
  assert.equal(h.calls.filter(x => x === 'sms-session').length, 1);
});

test('refused payload and full Review keep Wallet records queued while valid neighbors can progress', async () => {
  const h = harness({ wallet: [record(1, { currency: 'ZZZ' }), record(2)] });
  const result = await h.coordinator.drain();
  assert.equal(h.queue().length, 1); assert.equal(JSON.parse(h.queue()[0]).id, id(1));
  assert.equal(result.invalid, 0); assert.equal(result.deferredApplePay, 1);
  const full = harness({ refuseReview: true }); const first = await full.coordinator.drain();
  assert.equal(first.deferredApplePay, 1); assert.equal(full.queue().length, 1);
  full.permitReview(); await full.coordinator.drain(); assert.equal(full.queue().length, 0);
});

test('storage failure, ledger replacement and opt-out never ACK Wallet', async () => {
  const failed = harness({ failDurable: true }); await assert.rejects(failed.coordinator.drain(), /disk failed/); assert.equal(failed.queue().length, 1);
  for (const change of ['generation', 'optout']) {
    const h = harness(); const original = h.ledger.stageReviewAlerts;
    h.ledger.stageReviewAlerts = (...args) => { const result = original(...args); return { ...result, durable: result.durable.then(() => {
      if (change === 'generation') h.replaceLedger(); else h.state.captureOptOut = true;
    }) }; };
    if (change === 'generation') await assert.rejects(h.coordinator.drain(), /replaced/); else await h.coordinator.drain();
    assert.equal(h.queue().length, 1);
  }
});

test('replayed Wallet receipt retries failed ACK without duplicating or posting', async () => {
  const h = harness({ failAck: true }); await assert.rejects(h.coordinator.drain(), /ack failed/);
  assert.equal(h.state.reviewTray.pending.length, 1); h.permitAck(); await h.coordinator.drain();
  assert.equal(h.state.reviewTray.pending.length, 1); assert.equal(h.queue().length, 0);
});

test('older native binaries skip the Wallet reader', async () => {
  const h = harness({ wallet: [] }); delete h.native.listPendingApplePayRecords;
  await h.coordinator.drain(); assert.equal(h.calls.includes('wallet-read'), false);
});

test('a deferred notification lane still gives Wallet its independent bounded turn', async () => {
  const h = harness({ blockedNotification: true }); const result = await h.coordinator.drain();
  assert.equal(result.deferredReviews, 1); assert.equal(result.reviews, 1);
  assert.equal(h.queue().length, 0); assert.ok(h.calls.includes('wallet-read'));
  assert.equal(h.calls.some(x => Array.isArray(x) && x.includes('sms-id')), false);
});

test('held Wallet head does not starve valid neighbors on the next bounded page', async () => {
  const h = harness({ wallet: [record(100, { currency: 'ZZZ' }), ...Array.from({ length: 50 }, (_, i) => record(i))] });
  const result = await h.coordinator.drain();
  assert.equal(result.reviews, 50); assert.equal(result.scanned, 52, '51 Wallet records plus one SMS');
  assert.equal(result.deferredApplePay, 1); assert.equal(h.queue().length, 1);
  assert.ok(h.calls.filter(x => x === 'wallet-read').length <= 4);
});

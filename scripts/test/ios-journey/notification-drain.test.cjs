'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const health = load(path.join(root, 'src/lib/ios-capture-health.ts'));
function harness({ capable = true, modern = true, channel = 'push', optOut = false } = {}) {
  const calls = [], receipt = Date.now() - 1000;
  let firstCapturedAt = null, pending = ['record'];
  const state = { hydrated: true, captureOptOut: optOut, marketId: 'AE', lastScanTs: 0,
    transactions: [], accounts: [], localCaptureQualifications: [] };
  const api = load(path.join(root, 'src/lib/ios-local-capture.ts'), {
    '@/lib/ios-capture-health': health,
    '@/lib/ios-notification-replay': { createIosNotificationReplayGuard: () => outcome => outcome },
    '@/lib/import-plan': { buildImportPlan: () => ({ txCount: 1, dueCount: 0, healedCount: 0, newAccountCount: 0,
      declineReconciledCount: 0, declineReconciledIds: [], declineReconciliations: [], batch: { transactions: [] } }) },
    '@/lib/launch-alert-parser': { createLaunchAlertSession: () => ({}) },
    '@/lib/alert-review-tray': { ...require(path.join(root, 'scripts/test/build/alert-review-tray.js')),
      isUniversalReviewAlert: () => false },
    '@/lib/ledger-money': require(path.join(root, 'scripts/test/build/ledger-money.js')),
    '@/lib/local-message-record': {
      preflightLocalMessageRecord: () => ({ id: 'event-id', valid: true, market: 'AE', observedAt: receipt }),
      parseLocalMessageRecord: () => ({ kind: 'parsed', market: 'AE', milestone: 'financial', row: { smsTs: receipt, channel } }),
    },
    '@/lib/types': { normalizeLocalCaptureQualifications: () => [], isLocalCaptureQualificationCandidate: () => true },
  }, { setTimeout });
  const native = { notificationCaptureSupported: capable,
    getCaptureStatus: async () => ({ firstCapturedAt }), purgeExpired: async () => 0,
    listPendingRecords: async function() { assert.equal(this, native); calls.push('legacy-read'); return [...pending]; },
    recordFirstCapturedAt: async value => { calls.push('sms-proof'); firstCapturedAt = value; },
    acknowledgeRecords: async () => { calls.push('ack'); pending = []; },
    ...(modern ? { listPendingRecordsIncludingNotifications: async function() { assert.equal(this, native); calls.push('modern-read'); return [...pending]; } } : {}),
  };
  const coordinator = api.createIosLocalCaptureCoordinator({ native, ledger: {
    getState: () => state, getStateGeneration: () => 1,
    importBatch: () => { calls.push('save'); return { durable: Promise.resolve(), ids: ['tx'] }; },
    ensureDurable: async () => { calls.push('barrier'); },
  }, retireShortcutCapture: async () => { calls.push('retire-sms'); return 'complete'; } });
  return { calls, coordinator };
}
test('notification drain opts into the new reader, saves before ACK and never proves or retires SMS', async () => {
  const h = harness(); const result = await h.coordinator.drain();
  assert.equal(result.imported, 1);
  assert.equal(result.firstCapturedAt, null);
  assert.equal(h.calls.includes('legacy-read'), false);
  assert.equal(h.calls.includes('sms-proof'), false);
  assert.equal(h.calls.includes('retire-sms'), false);
  assert.ok(h.calls.indexOf('save') < h.calls.indexOf('ack'));
});
test('legacy binaries retain their reader and genuine SMS still establishes its milestone', async () => {
  for (const options of [{ capable: false }, { modern: false }]) {
    const h = harness({ ...options, channel: 'inbox' }); await h.coordinator.drain();
    assert.ok(h.calls.includes('legacy-read'));
    assert.ok(h.calls.includes('sms-proof'));
    assert.ok(h.calls.includes('retire-sms'));
  }
});
test('capture opt-out prevents either reader from running', async () => {
  const h = harness({ optOut: true }); await h.coordinator.drain();
  assert.deepEqual(h.calls, []);
});

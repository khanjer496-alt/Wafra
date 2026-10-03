'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const compiled = name => require(path.join(root, 'scripts/test/build', name));
const tray = load(path.join(root, 'src/lib/alert-review-tray.ts'), {
  '@/lib/capture-source-identity': compiled('capture-source-identity'),
  '@/lib/generic-review-entry': compiled('generic-review-entry'),
  '@/lib/universal-import': compiled('universal-import'),
});
const now = Date.now();
function entry(i) {
  const missing = () => ({ value: null, evidence: 'missing', alternatives: [], spans: [], issues: [] });
  const amount = { value: { currency: 'AED', minorUnits: '8000', exponent: 2 }, evidence: 'explicit', alternatives: [], spans: [], issues: [] };
  return tray.prepareUniversalReviewAlert({ id: `notification_review_id_${i}`, sourceKey: `local_review_source_${String(i).padStart(32, '0')}`,
    observedAt: now - 60000 + i * 1000, channel: 'push', event: { version: 1, decision: 'review', family: 'purchase', status: 'posted', direction: 'debit',
      amount, statementTotal: missing(), minimumDue: missing(), balance: missing(), creditLimit: missing(),
      merchant: { ...missing(), value: 'SHOP', evidence: 'explicit' }, transactionDate: missing(), dueDate: missing(), statementDate: missing(),
      instrument: missing(), observations: [{ role: 'transaction', field: amount }], issues: [] } });
}
test('the fifty-first unresolved review is refused without evicting any of the first fifty', () => {
  let state = tray.emptyAlertReviewTray(), admitted = 0, last;
  for (let i = 0; i < 51; i++) { last = tray.admitPreparedReviewAlert(state, entry(i), now); state = last.state; admitted += last.outcome === 'admitted' ? 1 : 0; }
  assert.equal(admitted, 50);
  assert.equal(last.reason, 'review-capacity');
  assert.equal(state.pending.length, 50);
  assert.equal(state.pending[0].id, entry(0).id);
  assert.equal(state.tombstones.length, 0);
  assert.equal(tray.admitPreparedReviewAlert(state, entry(0), now).outcome, 'duplicate', 'full trays still recognize exact replays');
});
test('notification replay attention survives source-free normalization, arbitrary prose does not', () => {
  const normalize = item => tray.normalizeAlertReviewTray({ ...tray.emptyAlertReviewTray(), pending: [item] }, now).pending[0];
  assert.equal(normalize({ ...entry(0), attentionReason: 'possible-notification-replay' }).attentionReason, 'possible-notification-replay');
  assert.equal(normalize({ ...entry(0), attentionReason: 'private text' }).attentionReason, undefined);
});
test('other importers retain their existing bounded admission policy until their ACK paths support backpressure', () => {
  let state = tray.emptyAlertReviewTray();
  for (let i = 0; i < 51; i++) {
    const result = tray.admitPreparedReviewAlert(state, { ...entry(i), sourceKey: `other_review_source_${i}` }, now);
    assert.equal(result.outcome, 'admitted'); state = result.state;
  }
  assert.equal(state.pending.length, 50);
});
test('later SMS and relay reviews cannot evict acknowledged notification reviews or lose their own new admission', () => {
  let state = tray.emptyAlertReviewTray();
  for (let i = 0; i < 50; i++) state = tray.admitPreparedReviewAlert(state, entry(i), now).state;
  const original = state.pending.map(item => item.sourceKey);
  for (let i = 0; i < 60; i++) {
    const sms = { ...entry(i % 50), id: `sms_review_identity_${i}`, sourceKey: `sms_review_source_${i}`, channel: 'inbox' };
    const result = tray.admitPreparedReviewAlert(state, sms, now);
    assert.equal(result.outcome, 'admitted'); state = result.state;
  }
  assert.equal(state.pending.length, 100);
  assert.ok(original.every(key => state.pending.some(item => item.sourceKey === key)));
  assert.equal(state.pending.filter(tray.isIosNotificationReview).length, 50);
  assert.equal(tray.admitPreparedReviewAlert(state, entry(50), now).reason, 'review-capacity');
  const hydrated = tray.normalizeAlertReviewTray(JSON.parse(JSON.stringify(state)), now);
  assert.equal(hydrated.pending.length, 100);
  assert.ok(original.every(key => hydrated.pending.some(item => item.sourceKey === key)));
});
test('both review quotas survive actual ledger JSON persistence and backup validation', async () => {
  let state = tray.emptyAlertReviewTray();
  for (let i = 0; i < 50; i++) state = tray.admitPreparedReviewAlert(state, entry(i), now).state;
  for (let i = 0; i < 50; i++) state = tray.admitPreparedReviewAlert(state, {
    ...entry(i), id: `legacy_review_identity_${i}`, sourceKey: `legacy_review_source_${i}`, channel: 'inbox',
  }, now).state;
  const { createLedgerPersistence } = load(path.join(root, 'src/lib/ledger-persistence.ts'));
  const disk = new Map();
  const persistence = () => createLedgerPersistence({ prefix: 'notification-review-storage-test', chunkSize: 50,
    currentChunkOrder: 'oldest-first', chunkTransactions: rows => rows.length ? [JSON.stringify(rows)] : [], migrateLegacyState: async () => false,
    storage: { getItem: async key => disk.get(key) ?? null, multiGet: async keys => keys.map(key => [key, disk.get(key) ?? null]),
      multiSet: async entries => { for (const [key, value] of entries) disk.set(key, value); },
      multiRemove: async keys => { for (const key of keys) disk.delete(key); }, destroy: async () => disk.clear() } });
  const writer = persistence(); await writer.load();
  assert.equal(await writer.save({ transactions: [], reviewTray: state }), true);
  const restored = await persistence().load();
  assert.equal(compiled('backup-validation').isValidBackupState(restored), true);
  const normalized = tray.normalizeAlertReviewTray(restored.reviewTray, now);
  assert.equal(normalized.pending.length, 100);
  assert.deepEqual(normalized.pending.map(item => item.sourceKey), state.pending.map(item => item.sourceKey));
});
test('a full Review tray retains overflow in the native queue until space is available', async () => {
  let queue = Array.from({ length: 51 }, (_, i) => String(i));
  let messageReads = 0;
  const acknowledged = [];
  const state = { hydrated: true, marketId: 'AE', captureOptOut: false, transactions: [], accounts: [], lastScanTs: 0,
    reviewTray: tray.emptyAlertReviewTray(), localCaptureQualifications: [] };
  const api = load(path.join(root, 'src/lib/ios-local-capture.ts'), {
    '@/lib/ios-capture-health': load(path.join(root, 'src/lib/ios-capture-health.ts')),
    '@/lib/ios-notification-replay': { createIosNotificationReplayGuard: () => outcome => outcome },
    '@/lib/import-plan': { buildImportPlan: () => ({ txCount: 0, dueCount: 0, newAccountCount: 0, healedCount: 0,
      declineReconciledCount: 0, declineReconciledIds: [], declineReconciliations: [], batch: {} }) },
    '@/lib/launch-alert-parser': { createLaunchAlertSession: () => ({}) },
    '@/lib/alert-review-tray': tray,
    '@/lib/ledger-money': compiled('ledger-money'),
    '@/lib/local-message-record': {
      preflightLocalMessageRecord: text => ({ id: text, valid: true, market: 'AE', observedAt: now }),
      parseLocalMessageRecord: text => ({ kind: 'review', item: entry(Number(text)), market: 'AE', milestone: 'none' }),
    },
    '@/lib/types': { normalizeLocalCaptureQualifications: () => [], isLocalCaptureQualificationCandidate: () => true },
  }, { setTimeout });
  const native = { notificationCaptureSupported: true, purgeExpired: async () => 0,
    // Message-only reader: used only after held notification reviews fill a
    // whole page, so later SMS keep draining. This queue has no Messages.
    listPendingRecords: async () => { messageReads += 1; return []; },
    listPendingRecordsIncludingNotifications: async limit => queue.slice(0, limit),
    getCaptureStatus: async () => ({ firstCapturedAt: null }),
    acknowledgeRecords: async ids => { acknowledged.push(...ids); queue = queue.filter(id => !ids.includes(id)); },
  };
  const coordinator = api.createIosLocalCaptureCoordinator({ native, ledger: { getState: () => state, getStateGeneration: () => 1,
    ensureDurable: async () => {}, importBatch: () => { throw Error('review cannot post money'); },
    stageReviewAlerts: items => {
      let admitted = 0;
      for (const item of items) { const result = tray.admitPreparedReviewAlert(state.reviewTray, item, now); state.reviewTray = result.state; admitted += result.outcome === 'admitted' ? 1 : 0; }
      return { admitted, durable: Promise.resolve() };
    },
  }, retireShortcutCapture: async () => { throw Error('notification cannot prove SMS'); } });
  const first = await coordinator.drain();
  assert.equal(first.reviews, 50);
  assert.equal(first.deferredReviews, 1);
  assert.equal(first.ignored, 0);
  assert.deepEqual(queue, ['50']);
  assert.equal(acknowledged.includes('50'), false);
  assert.equal(messageReads, 1, 'a fully held page continues behind notifications, once');
  assert.equal(state.reviewTray.pending[0].id, entry(0).id);
  state.reviewTray = tray.resolveReviewAlert(state.reviewTray, entry(0).id, 'dismissed', now);
  const second = await coordinator.drain();
  assert.equal(second.reviews, 1);
  assert.deepEqual(queue, []);
  assert.equal(state.reviewTray.pending.length, 50);
  assert.ok(state.reviewTray.pending.some(item => item.id === entry(50).id));
});

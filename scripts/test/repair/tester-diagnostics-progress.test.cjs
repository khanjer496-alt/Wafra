'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('./load-typescript.cjs');

function harness() {
  let scans = 0;
  let shadowScans = 0;
  let submitted;
  let callback;
  let snapshotTaken = false;
  const events = [];
  const state = { transactions: [], accounts: [], bills: [], cardDues: [], statementCoverage: [],
    reviewTray: { pending: [] }, merchantOverrides: {}, privateMode: false, captureOptOut: false,
    language: 'en', marketId: 'AE', ledgerMoney: { currency: 'AED' } };
  const subject = load(path.resolve(__dirname, '../../../src/lib/android-tester-diagnostics.ts'), {
    'expo-constants': { expoConfig: { version: '1.0.0' } }, 'expo-device': {},
    'react-native': { Platform: { OS: 'android', Version: 36 } },
    '../../modules/notification-reader': {}, '../../modules/sms-reader': { getInboxSms: async () => [] },
    '@/lib/auto-import': { getAndroidNotificationImportDiagnostics: () => null,
      hasSmsPermission: async () => true, hasSmsDeliveryPermission: async () => true },
    '@/lib/capture-source-identity': { canonicalCaptureSourceKey: value => value },
    '@/lib/local-semantic-inbox-shadow': { runLocalSemanticInboxShadow: async () => { shadowScans++; } },
    '@/lib/diagnostic-messages': { collectDiagnosticBankMessages: async (_read, options) => {
      scans++;
      assert.equal(snapshotTaken, true, 'runtime snapshot precedes diagnostic work');
      assert.equal(options.maxChecked, 1000, 'preserve current main bounded audit');
      callback = options.onProgress;
      options.onProgress?.(250, 125);
      options.onProgress?.(1000, 500);
      return { messages: [], coverage: { checked: 1000, included: 500, excluded: 500,
        checkedLimit: 1000, truncated: true, nativeFilteredInboxReadComplete: false } };
    } },
    '@/lib/feedback': { buildFeedbackPayload: () => ({ counts: null }) },
    '@/lib/feedback-wire': { FEEDBACK_DIAGNOSTIC_MAX_BYTES: 24000, FEEDBACK_RETENTION_DAYS: 30 },
    '@/lib/feedback-transport': { submitTesterDiagnostics: async wire => {
      assert.equal(events.at(-1)?.stage, 'sending');
      submitted = wire;
      return { id: 'report-1', dispatched: false };
    } },
    '@/lib/launch-performance': { getLaunchMetrics: () => ({}) },
    '@/lib/markets': { ledgerCurrencyDisplay: () => 'AED' },
    '@/lib/bank-logo-resolver': { getBankLogoCacheDiagnostics: () => ({}) },
    '@/lib/merchant-logo-resolver': { getMerchantLogoCacheDiagnostics: () => ({}) },
    '@/lib/notifications': { notificationDeliveryAllowed: async () => true },
    '@/lib/parser-research': { sanitizeParserTemplate: () => '' },
    '@/lib/runtime-performance': { getRuntimePerformanceSnapshot: () => { snapshotTaken = true; return {}; } },
    '@/lib/sms-parser': { PARSER_VERSION: 1, PARSER_BACKFILL_VERSION: 1 },
    '@/lib/storage-diagnostics': { getStorageFailures: () => [] },
    '@/lib/transfer-reconciliation': { isTransferCandidate: () => false, transferOwnership: () => 'unknown' },
  }, { TextEncoder });
  return { state, events, send: () => subject.sendAndroidTesterDiagnostic(state, event => events.push(event)),
    shadowScans: () => shadowScans, scans: () => scans, submitted: () => submitted, callback: () => callback };
}

test('bounded inbox counts reach the caller before upload without claiming completeness', async () => {
  const h = harness();
  assert.equal((await h.send()).id, 'report-1');
  assert.deepEqual(JSON.parse(JSON.stringify(h.events)), [
    { stage: 'checking', checked: 250, included: 125 },
    { stage: 'checking', checked: 1000, included: 500 },
    { stage: 'sending' },
  ]);
  assert.equal(h.submitted().diagnostic.parser.inbox.readComplete, false);
  assert.equal(h.submitted().diagnostic.parser.inbox.auditScope, 'recent-bounded');
  assert.equal(h.submitted().aiReviewConsent, false);
});

for (const skipped of ['privateMode', 'captureOptOut', 'historyImport']) {
  test(`${skipped}: progress does not bypass the inbox scan guard`, async () => {
    const h = harness();
    h.state[skipped] = skipped === 'historyImport' ? { status: 'running' } : true;
    await h.send();
    assert.equal(h.scans(), 0);
    assert.deepEqual(JSON.parse(JSON.stringify(h.events)), [{ stage: 'sending' }]);
    assert.equal(h.submitted().diagnostic.parser.inbox.scanPerformed, false);
  });
}


test('sending diagnostics performs only the requested bounded audit, not a separate AI inbox sweep', async () => {
  const h = harness();
  await h.send();
  assert.equal(h.scans(), 1);
  assert.equal(h.shadowScans(), 0);
});

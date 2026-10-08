'use strict';

// Switching automatic capture off and on again in Settings cleared the opt-out
// but left the native admission flag off, so every Message automation kept
// answering "capture is off" until the user found and re-ran setup. A phone
// that already finished a current setup, with access, is re-admitted directly.

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const load = require('./load-typescript.cjs');

const root = path.resolve(__dirname, '../../..');

function harness(status, { bundledShortcut = true } = {}) {
  const calls = [];
  const native = {
    getCaptureStatus: async () => status,
    setCaptureEnabled: async (enabled) => { calls.push(enabled); },
    ...(bundledShortcut ? { getMessageShortcutURL: async () => 'file:///Wafra%20Capture%20v3.shortcut' } : {}),
  };
  const capture = load(path.join(root, 'src/lib/capture.ts'), {
    'react-native': { Platform: { OS: 'ios', Version: '26.1' } },
    expo: { requireOptionalNativeModule: () => native },
    '@/lib/auto-import': { isSmsScanningAvailable: () => false, scanInbox: async () => null },
    '@/lib/background-relay-storage': {},
    '@/lib/relay': { isRelayPlatform: () => false },
    '@/lib/sms-parser': { PARSER_VERSION: 40, PARSER_BACKFILL_VERSION: 40 },
    '@/lib/review-source-bindings': { collectLegacyReviewSourceKeys: () => [], withoutRecordedReviews: (x) => x },
  });
  let refreshed = 0;
  capture.subscribeIosCaptureStatusRefresh(() => { refreshed += 1; });
  return { capture, calls, refreshed: () => refreshed };
}

const base = { enabled: false, entitled: true, setupProofVersion: null,
  notificationSetupProofAt: null, applePaySetupProofAt: null };

test('a phone that finished Capture v3 setup is re-admitted without the setup screen', async () => {
  const h = harness({ ...base, setupProofVersion: 3 });
  assert.equal(await h.capture.resumeIosCaptureIfSetUp(), true);
  assert.deepEqual(h.calls, [true]);
  assert.equal(h.refreshed(), 1, 'screens reread the capture status');
});

test('notification-only and Apple Pay-only setups count as finished setup', async () => {
  for (const proof of [{ notificationSetupProofAt: 1_787_000_000_000 }, { applePaySetupProofAt: 1_787_000_000_000 }]) {
    const h = harness({ ...base, ...proof });
    assert.equal(await h.capture.resumeIosCaptureIfSetUp(), true);
    assert.deepEqual(h.calls, [true]);
  }
});

test('an old v1 proof on a build that bundles v3 still goes through setup', async () => {
  const h = harness({ ...base, setupProofVersion: 1 });
  assert.equal(await h.capture.resumeIosCaptureIfSetUp(), false);
  assert.deepEqual(h.calls, []);
  const legacy = harness({ ...base, setupProofVersion: 1 }, { bundledShortcut: false });
  assert.equal(await legacy.capture.resumeIosCaptureIfSetUp(), true, 'a build without v3 accepts v1');
});

test('a phone that never finished setup is sent to setup, not silently enabled', async () => {
  for (const status of [base, { enabled: false, entitled: true }]) {
    const h = harness(status);
    assert.equal(await h.capture.resumeIosCaptureIfSetUp(), false, 'missing fields are not proof');
    assert.deepEqual(h.calls, []);
  }
});

test('without access, capture is not re-admitted', async () => {
  const h = harness({ ...base, setupProofVersion: 3, entitled: false });
  assert.equal(await h.capture.resumeIosCaptureIfSetUp(), false);
  assert.deepEqual(h.calls, []);
});

test('capture that is already on is left alone', async () => {
  const h = harness({ ...base, enabled: true, setupProofVersion: 3 });
  assert.equal(await h.capture.resumeIosCaptureIfSetUp(), true);
  assert.deepEqual(h.calls, []);
});

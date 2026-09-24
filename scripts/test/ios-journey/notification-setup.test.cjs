'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const health = load(path.join(root, 'src/lib/ios-capture-health.ts'));
const setup = load(path.join(root, 'src/lib/ios-capture-setup.ts'), {
  'react-native': { Platform: { OS: 'ios', Version: '27.0' }, Linking: {} },
  '@/lib/capture': {},
  '@/lib/ios-local-capture-protocol': {},
  './ios-capture-health': health,
});
test('notification automation requires iOS 27; malformed versions cannot enable it', () => {
  for (const v of ['16.0', '26.6.2', '', 'unknown', '27oops', NaN]) assert.equal(setup.iosSupportsNotificationAutomation(v), false);
  for (const v of [27, '27', '27.0.1', '28.0']) assert.equal(setup.iosSupportsNotificationAutomation(v), true);
});
test('SMS proof and SMS receipts cannot prove the new notification path', () => {
  const status = { enabled: true, entitled: true, setupProofVersion: 1, firstCapturedAt: Date.now() };
  assert.equal(setup.resolveIosNotificationReadiness(status), 'not-added');
  assert.equal(setup.resolveIosNotificationReadiness({ ...status, notificationSetupProofAt: Date.now() }), 'shortcut-proven');
  assert.equal(setup.resolveIosNotificationReadiness({ ...status, firstNotificationReceivedAt: Date.now() }), 'shortcut-proven',
    'queue receipt must not claim a financially processed alert');
  for (const patch of [{ enabled: false }, { entitled: false }]) {
    assert.equal(setup.resolveIosNotificationReadiness({ ...status, notificationSetupProofAt: Date.now(), ...patch }), 'not-added');
  }
});
test('selecting notifications is durable, does not confirm the automation and preserves history', async () => {
  const values = new Map();
  const storage = { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => values.set(key, value) };
  const journey = load(path.join(root, 'src/lib/ios-setup-journey.ts'));
  const progress = load(path.join(root, 'src/lib/ios-message-onboarding.ts'), {
    '@react-native-async-storage/async-storage': storage,
    './ios-setup-journey': journey,
    './ios-history-setup': { isIosHistoryShortcutInstalled: async () => false },
  });
  await progress.dispatchIosMessageSetup({ type: 'history-status-changed', status: 'in-progress' }, storage);
  await progress.dispatchIosMessageSetup({ type: 'future-automation-confirmed' }, storage);
  await progress.dispatchIosMessageSetup({ type: 'future-source-changed', source: 'notification' }, storage);
  const notification = await progress.loadIosMessageSetupProgress(storage);
  assert.equal(notification.futureCaptureSource, 'notification');
  assert.equal(notification.futureAutomationConfirmed, false);
  assert.equal(notification.historyStatus, 'in-progress');
  await progress.dispatchIosMessageSetup({ type: 'future-automation-confirmed' }, storage);
  assert.equal((await progress.loadIosMessageSetupProgress(storage)).futureAutomationConfirmed, true);
  await progress.dispatchIosMessageSetup({ type: 'future-source-changed', source: 'message' }, storage);
  const sms = await progress.loadIosMessageSetupProgress(storage);
  assert.equal(sms.futureCaptureSource, 'message');
  // Switching back restores the SMS confirmation that was parked, never erased.
  assert.equal(sms.futureAutomationConfirmed, true);
  assert.equal(sms.historyStatus, 'in-progress');
  assert.equal(progress.progressForSource(sms, 'notification').futureAutomationConfirmed, true);
});

test('another source only becomes the recorded source once its own automation is confirmed', async () => {
  const values = new Map();
  const storage = { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => values.set(key, value),
    removeItem: async key => values.delete(key) };
  const journey = load(path.join(root, 'src/lib/ios-setup-journey.ts'));
  const progress = load(path.join(root, 'src/lib/ios-message-onboarding.ts'), {
    '@react-native-async-storage/async-storage': storage,
    './ios-setup-journey': journey,
    './ios-history-setup': { isIosHistoryShortcutInstalled: async () => false },
  });
  const load_ = () => progress.loadIosMessageSetupProgress(storage);
  await progress.dispatchIosMessageSetup({ type: 'future-shortcut-confirmed', version: 3 }, storage);
  await progress.dispatchIosMessageSetup({ type: 'future-automation-confirmed', at: 1000 }, storage);
  await progress.dispatchIosMessageSetup({ type: 'future-status-changed', status: 'complete' }, storage);
  // Installing and confirming the Apple Pay Shortcut touches only Apple Pay's parked progress.
  await progress.dispatchIosMessageSetup({ type: 'future-shortcut-install-started', source: 'apple-pay' }, storage);
  await progress.dispatchIosMessageSetup({ type: 'future-shortcut-confirmed', source: 'apple-pay' }, storage);
  let saved = await load_();
  assert.equal(saved.futureCaptureSource, undefined);
  assert.deepEqual([saved.futureShortcutConfirmed, saved.futureShortcutVersion, saved.futureAutomationConfirmed, saved.futureStatus],
    [true, 3, true, 'complete']);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.parkedSources)), { 'apple-pay': { shortcutConfirmed: true, automationConfirmed: false } });
  assert.equal(progress.progressForSource(saved, 'apple-pay').futureShortcutConfirmed, true);
  assert.equal(progress.progressForSource(saved, 'apple-pay').futureAutomationConfirmed, false);
  // Confirming Apple Pay's automation switches the recorded source and parks SMS.
  await progress.dispatchIosMessageSetup({ type: 'future-automation-confirmed', source: 'apple-pay', at: 2000 }, storage);
  saved = await load_();
  assert.deepEqual([saved.futureCaptureSource, saved.futureShortcutConfirmed, saved.futureAutomationConfirmed, saved.futureAutomationConfirmedAt],
    ['apple-pay', true, true, 2000]);
  assert.deepEqual(JSON.parse(JSON.stringify(saved.parkedSources)), { message: { shortcutConfirmed: true, shortcutVersion: 3, automationConfirmed: true, automationConfirmedAt: 1000 } });
  // Confirming SMS again restores its parked progress.
  await progress.dispatchIosMessageSetup({ type: 'future-automation-confirmed', source: 'message', at: 3000 }, storage);
  saved = await load_();
  assert.deepEqual([saved.futureCaptureSource, saved.futureShortcutVersion, saved.futureAutomationConfirmedAt], ['message', 3, 3000]);
  assert.equal(saved.parkedSources['apple-pay'].automationConfirmed, true);
  // Malformed parked progress is rejected like any other malformed field.
  values.set('wafra/ios-message-setup-progress/v1', JSON.stringify({ ...saved, parkedSources: { bank: {} } }));
  assert.equal((await load_()).futureAutomationConfirmed, false);
});

test('Wallet readiness is independent of message and notification proof and requires entitlement', () => {
  const status = { enabled: true, entitled: true, setupProofVersion: 3,
    firstCapturedAt: Date.now(), notificationSetupProofAt: Date.now() };
  assert.equal(setup.resolveIosApplePayReadiness(status), 'not-added');
  assert.equal(setup.resolveIosApplePayReadiness({ ...status, applePaySetupProofAt: Date.now() }), 'shortcut-proven');
  assert.equal(setup.resolveIosApplePayReadiness({ ...status, firstApplePayReceivedAt: Date.now() }), 'shortcut-proven');
  assert.equal(setup.resolveIosApplePayReadiness({ ...status, applePaySetupProofAt: Date.now(), entitled: false }), 'not-added');
  assert.equal(setup.resolveIosSelectedReadiness('apple-pay', { readiness: 'first-alert-captured', shortcutVersion: 3 }), 'not-added');
  for (const version of ['16.6', '27oops', NaN]) assert.equal(setup.iosSupportsApplePayAutomation(version), false);
  for (const version of [17, '26.6.2', '27.0']) assert.equal(setup.iosSupportsApplePayAutomation(version), true);
});

test('a started install or check only accepts Message proof recorded after it', () => {
  const model = { readiness: 'shortcut-proven', shortcutVersion: 3, setupProofAt: 1000 };
  assert.equal(setup.resolveIosSelectedReadiness('message', model, 3), 'shortcut-proven');
  assert.equal(setup.resolveIosSelectedReadiness('message', model, 3, 1000), 'shortcut-proven');
  assert.equal(setup.resolveIosSelectedReadiness('message', model, 3, 1001), 'not-added');
  assert.equal(setup.resolveIosSelectedReadiness('message', { ...model, setupProofAt: null }, 3, 1), 'not-added');
  // Other sources have their own proof; a Message attempt never gates them.
  assert.equal(setup.resolveIosSelectedReadiness('notification', { ...model, notificationReadiness: 'shortcut-proven' }, undefined, 5000), 'shortcut-proven');
});

test('only a confirmed v2 setup with v2 proof on a v3 build reads as an upgrade', () => {
  const model = { shortcutVersion: 3, setupProofVersion: 1, captureHealth: { enabled: true } };
  const v2 = { futureAutomationConfirmed: true };
  assert.equal(setup.isIosLegacyCaptureUpgrade(v2, model), true);
  assert.equal(setup.isIosLegacyCaptureUpgrade({ ...v2, futureShortcutVersion: 3 }, model), false);
  assert.equal(setup.isIosLegacyCaptureUpgrade({ futureAutomationConfirmed: false }, model), false);
  assert.equal(setup.isIosLegacyCaptureUpgrade(v2, { ...model, setupProofVersion: 3 }), false);
  assert.equal(setup.isIosLegacyCaptureUpgrade(v2, { ...model, captureHealth: { enabled: false } }), false);
  assert.equal(setup.isIosLegacyCaptureUpgrade(v2, { ...model, shortcutVersion: undefined }), false);
});

test('automation verification needs a Message receipt after the confirmation', () => {
  assert.equal(setup.iosMessageAutomationVerified({ futureAutomationConfirmedAt: 100 }, { lastMessageReceivedAt: 101 }), true);
  assert.equal(setup.iosMessageAutomationVerified({ futureAutomationConfirmedAt: 100 }, { lastMessageReceivedAt: 100 }), false);
  assert.equal(setup.iosMessageAutomationVerified({ futureAutomationConfirmedAt: 100 }, { lastMessageReceivedAt: null }), false);
  // Legacy progress without a confirmation time falls back to the setup proof time, never to "always".
  assert.equal(setup.iosMessageAutomationVerified({}, { setupProofAt: 50, lastMessageReceivedAt: 60 }), true);
  assert.equal(setup.iosMessageAutomationVerified({}, { lastMessageReceivedAt: 60 }), false);
});

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
  assert.equal(sms.futureAutomationConfirmed, false);
  assert.equal(sms.historyStatus, 'in-progress');
});

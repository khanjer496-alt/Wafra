'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');

const sourcePrefs = load(path.join(root, 'src/lib/android-capture-sources.ts'));

test('legacy enabled Android ledgers preserve both capture sources', () => {
  assert.equal(JSON.stringify(sourcePrefs.resolvedAndroidCaptureSources({ captureOptOut: false })), JSON.stringify({
    sms: true, notifications: true,
  }));
});

test('explicit notification-only onboarding cannot read SMS', () => {
  const state = { captureOptOut: false, androidCaptureSources: { sms: false, notifications: true } };
  assert.equal(sourcePrefs.androidSmsCaptureEnabled(state), false);
  assert.equal(sourcePrefs.androidNotificationCaptureEnabled(state), true);
});

test('explicit SMS-only onboarding cannot drain bank notifications', () => {
  const state = { captureOptOut: false, androidCaptureSources: { sms: true, notifications: false } };
  assert.equal(sourcePrefs.androidSmsCaptureEnabled(state), true);
  assert.equal(sourcePrefs.androidNotificationCaptureEnabled(state), false);
});

test('global opt-out dominates every retained source selection', () => {
  const state = { captureOptOut: true, androidCaptureSources: { sms: true, notifications: true } };
  assert.equal(JSON.stringify(sourcePrefs.resolvedAndroidCaptureSources(state)), JSON.stringify({ sms: false, notifications: false }));
});

test('all Android capture owners consult the durable source selection', () => {
  const auto = fs.readFileSync(path.join(root, 'src/hooks/use-auto-import.ts'), 'utf8');
  const history = fs.readFileSync(path.join(root, 'src/hooks/use-history-import.ts'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'src/lib/android-live-background.ts'), 'utf8');
  const policy = fs.readFileSync(path.join(root, 'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationCapturePolicy.kt'), 'utf8');
  const nativeModule = fs.readFileSync(path.join(root, 'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationReaderModule.kt'), 'utf8');
  assert.match(auto, /androidSmsCaptureEnabled/);
  assert.match(auto, /androidNotificationCaptureEnabled/);
  assert.match(history, /androidSmsCaptureEnabled/);
  assert.match(background, /androidSmsCaptureEnabled/);
  assert.match(background, /androidNotificationCaptureEnabled/);
  assert.match(policy, /fun isLeaseActive/);
  assert.match(policy, /NOTIFICATION_SOURCE_ENABLED/);
  assert.match(nativeModule, /setSourceConfiguration/);
  assert.match(nativeModule, /NotificationCapturePolicy\.isLeaseActive/);
});

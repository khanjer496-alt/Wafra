'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('fresh iPhone installs do not claim Daily Summary before notification consent', () => {
  const store = read('src/lib/store.tsx');
  const settings = read('src/app/settings.tsx');

  assert.match(store, /dailySummary:\s*Platform\.OS === 'ios' \? false : true/);
  assert.match(settings, /notificationDeliveryAllowed\(\)/);
  assert.match(
    settings,
    /state\.dailySummary && notificationDeliveryEnabled[\s\S]*?toggleDailySummary\(next\)/,
  );
});

test('iPhone completion explains notifications before the native visible-permission ask', () => {
  const onboarding = read('src/components/onboarding-gate.tsx');
  const notifications = read('src/lib/notifications.ts');
  const copy = read('src/lib/i18n.ts');

  assert.match(onboarding, /Platform\.OS === 'ios' && !notificationDecisionMade\.current/);
  assert.match(onboarding, /onboardNotificationsTitle/);
  assert.match(onboarding, /onboardNotificationsEnable/);
  assert.match(onboarding, /onboardNotificationsNotNow/);
  assert.match(onboarding, /requestVisibleNotificationPermission\(\)/);
  assert.match(onboarding, /setDailySummary\(granted\)/);
  assert.match(notifications, /allowAlert:\s*true/);
  assert.match(notifications, /allowSound:\s*true/);
  assert.match(copy, /Stay ahead of your money/);
});

test('notification consent remains separate from the local Shortcut capture setup', () => {
  const setup = read('src/app/ios-setup.tsx');
  assert.doesNotMatch(setup, /requestVisibleNotificationPermission/);
  assert.doesNotMatch(setup, /requestSilentCapturePermission/);
});

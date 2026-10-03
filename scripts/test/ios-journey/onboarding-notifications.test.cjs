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

// Design language E: the Reminders step (4 of 5) explains what Wafra sends
// before the explicit "Allow notifications" tap that may show the system ask.
test('the Reminders step explains notifications before the native visible-permission ask', () => {
  const onboarding = read('src/components/onboarding-gate.tsx');
  const step = read('src/components/onboarding/e-reminders.tsx');
  const notifications = read('src/lib/notifications.ts');

  assert.match(step, /words\.remindersTitle/);
  assert.match(step, /words\.remindBillsWhen/);
  assert.match(step, /words\.remindCardsWhen/);
  assert.match(step, /label=\{words\.allowNotifications\} onPress=\{onAllow\}/);
  assert.match(step, /label=\{words\.notNow\} onPress=\{onNotNow\}/);
  assert.match(onboarding, /onAllow=\{\(\) => void runSetupAction\(\(\) => finishNotificationChoice\(true\)\)\}/);
  assert.match(onboarding, /const finishNotificationChoice = async \(enable: boolean\) => \{[\s\S]{0,160}if \(enable && !previewMode\) \{\s*granted = await requestVisibleNotificationPermission\(\)/);
  // The daily summary turns on only when notifications were really allowed.
  assert.match(onboarding, /const daily = granted && dailySummaryDraft;\s*setDailySummary\(daily\);/);
  assert.match(notifications, /allowAlert:\s*true/);
  assert.match(notifications, /allowSound:\s*true/);
});

test('notification consent remains separate from the local Shortcut capture setup', () => {
  const setup = read('src/app/ios-setup.tsx');
  assert.doesNotMatch(setup, /requestVisibleNotificationPermission/);
  assert.doesNotMatch(setup, /requestSilentCapturePermission/);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

test('Android live capture is event-driven, bounded and non-sticky', () => {
  const service = read('modules/sms-reader/android/src/main/java/expo/modules/smsreader/LiveCaptureHeadlessService.kt');
  const manifest = read('modules/sms-reader/android/src/main/AndroidManifest.xml');
  const sms = read('modules/sms-reader/android/src/main/java/expo/modules/smsreader/SmsDeliveryReceiver.kt');
  const push = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/BankNotificationListenerService.kt');

  assert.match(service, /class LiveCaptureHeadlessService : HeadlessJsTaskService\(\)/);
  assert.match(service, /const val TASK = "WafraLiveCapture"/);
  assert.match(service, /MAX_RUN_MS = 20_000L/);
  assert.match(service, /START_NOT_STICKY/);
  assert.doesNotMatch(stripComments(service), /WorkManager|PeriodicWorkRequest|AlarmManager|setInterval|postDelayed/);
  assert.match(manifest, /LiveCaptureHeadlessService/);

  const smsGate = sms.indexOf('SensitiveMessageFilter.shouldReject(body)');
  const smsSchedule = sms.indexOf('LiveCaptureHeadlessService.schedule(');
  assert.ok(smsGate >= 0 && smsSchedule > smsGate,
    'SMS wakes headless capture only after the native security/money gate');

  const pushAppend = push.indexOf('NotificationCaptureStore.append(');
  const pushSchedule = push.indexOf('scheduleHeadlessCapture(sbn.postTime)');
  assert.ok(pushAppend >= 0 && pushSchedule > pushAppend,
    'push wakes only after the encrypted queue owns the source');
  assert.doesNotMatch(push.slice(pushSchedule, push.indexOf('companion object')), /sweepActiveNotifications/,
    'a live event must never trigger a full notification-shade sweep');
});

test('headless JS processes only a tiny event window and uses the normal durable planner', () => {
  const background = read('src/lib/android-live-background.ts');
  const autoImport = read('src/lib/auto-import.ts');

  assert.match(background, /SMS_EVENT_PAGE_SIZE = 16/);
  assert.match(background, /PUSH_ROWS_PER_WAKE = 12/);
  assert.match(background, /RNAppState\.currentState === 'active'\) return/,
    'the native wake must defer to the mounted foreground owner based on real UI AppState');
  assert.match(background, /maxInboxPages: 1/);
  assert.match(background, /includeNotificationQueue: false/);
  assert.match(background, /maxNotificationRows: PUSH_ROWS_PER_WAKE/);
  assert.match(background, /NotificationReader\?\.isAdmissionActive\?\.\(\) !== true/,
    'closed-app SMS imports must respect the same bounded entitlement lease');
  assert.match(background, /materializeImportBatch\(input, base, createId\)/);
  assert.match(background, /applyMaterializedImportBatch\(base, materialized\)/);
  assert.match(background, /diskPersistence\.save\(next\)/);
  assert.match(background, /createCaptureExecutor/);
  assert.match(background,
    /function applyLedgerContext[\s\S]*?setBestEffortAutoPostEnabled\(state\.bestEffortAutoPost\)[\s\S]*?return true;/,
    'a killed-process wake must honour "Auto-add alerts from unverified bank formats" OFF');
  assert.doesNotMatch(stripComments(background), /sweepVisible|sweepActiveNotifications|setInterval|WorkManager|PeriodicWorkRequest/);

  assert.match(autoImport, /maxNotificationRows\?: number/);
  assert.match(autoImport, /includeNotificationQueue\?: boolean/);
  assert.match(autoImport,
    /retained[\s\S]*?filter\(\(row\) => !unresolvedNotificationIdsThisSession\.has\(row\.id\)\)[\s\S]*?slice\(0, notificationLimit\)/,
    'headless/foreground queue bounds apply after same-session unresolved rows are skipped');
});

test('background capture and foreground StoreProvider never become competing ledger owners', () => {
  const hook = read('src/hooks/use-auto-import.ts');
  const store = read('src/lib/store.tsx');
  const rootLayout = read('src/components/app-root-layout.tsx');
  const background = read('src/lib/android-live-background.ts');

  assert.match(rootLayout, /import '@\/lib\/android-live-background';/,
    'headless registration must happen at JS bundle module scope');
  assert.match(hook, /installAndroidLiveCaptureLedger\(captureLedger\)/);
  assert.match(hook, /Platform\.OS !== 'android' \|\| !watchForeground/);
  assert.match(store, /await waitForAndroidBackgroundCaptureIdle\(\)/);
  assert.match(background, /let liveLedgerAdapter: CaptureLedgerAdapter \| null = null/);
  assert.match(background, /let backgroundTail: Promise<void> = Promise\.resolve\(\)/);
});

test('headless SMS leaves the normal cursor review-safe and push review rows remain recoverable', () => {
  const background = read('src/lib/android-live-background.ts');

  assert.match(background, /newestTs: state\.lastScanTs,/,
    'a background SMS pass must not hide a review-only row behind a new cursor');
  assert.doesNotMatch(background, /newestTs:[^\n]*result\.newestTs/,
    'a background push wake read no SMS and must never advance the SMS watermark');
  assert.match(background, /const holdPushAcknowledgement = result\.reviewCandidates\.length > 0/);
  assert.match(background, /commit: holdPushAcknowledgement \? async \(\) => \{\} : result\.commit/);
});

test('headless disk persistence stays byte-compatible with StoreProvider chunking', () => {
  const background = read('src/lib/android-live-background.ts');
  const store = read('src/lib/store.tsx');

  assert.match(background, /STORAGE_KEY = 'wafra\/state\/v1'/);
  assert.match(store, /STORAGE_KEY = 'wafra\/state\/v1'/);
  assert.match(background, /TX_CHUNK_SIZE = 400/);
  assert.match(store, /TX_CHUNK_SIZE = 400/);
  assert.match(background, /TX_CHUNK_ORDER = 'oldest-first'/);
  assert.match(store, /TX_CHUNK_ORDER = 'oldest-first'/);
});

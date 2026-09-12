'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const moduleFor = env => load(path.join(root, 'src/lib/trusted-bank-notification-packages.ts'), {}, { process: { env } });

test('normal Android builds expose notification capture when the native module is available', () => {
  assert.equal(typeof moduleFor({}).isBankNotificationCaptureAvailable, 'function');
  for (const value of [undefined, '', '0', 'true', 'yes', '1']) {
    for (const nativeAvailable of [false, undefined, 'true', true]) {
      const actual = moduleFor({ EXPO_PUBLIC_WAFRA_ANDROID_NOTIFICATION_CAPTURE_BETA: value }).isBankNotificationCaptureAvailable(nativeAvailable);
      assert.equal(actual, nativeAvailable === true);
    }
  }
});

test('native notification admission is built into ordinary Android APKs', () => {
  const gradle = read('modules/notification-reader/android/build.gradle');
  assert.match(gradle, /buildConfig true/);
  assert.match(gradle, /buildConfigField 'boolean', 'WAFRA_ANDROID_NOTIFICATION_CAPTURE_ENABLED', 'true'/);
  const native = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/TrustedBankNotificationPackages.kt');
  assert.match(native, /CAPTURE_ENABLED[^\n]*BuildConfig\.WAFRA_ANDROID_NOTIFICATION_CAPTURE_ENABLED/);
  assert.match(native, /installer\(context, packageName\) == "com\.android\.vending"/);
  assert.match(native, /CAPTURE_ENABLED && markets\.containsKey\(packageName\)/);
});

test('curated package identity remains exact while native intake can discover new Play financial candidates', () => {
  const enabled = moduleFor({});
  assert.equal(enabled.trustedBankNotificationMarket('com.example.notificationproducer'), null);
  assert.equal(enabled.trustedBankNotificationMarket('com.emiratesnbd.android.spoof'), null);
  assert.equal(enabled.trustedBankNotificationMarket('com.emiratesnbd.android'), 'AE');
  const native = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/TrustedBankNotificationPackages.kt');
  const listener = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/BankNotificationListenerService.kt');
  assert.doesNotMatch(native, /ApplicationInfo\.CATEGORY_FINANCE/);
  assert.match(native, /SOURCE_FINANCIAL_CANDIDATE/);
  assert.match(listener, /TrustedBankNotificationPackages\.sourceClass\(this, sbn\.packageName, body\)/);
  assert.match(listener, /SensitiveNotificationFilter\.shouldReject\(body\)/);
  assert.match(listener, /MONEY_RE\.containsMatchIn\(body\)/);
  assert.match(listener, /Notification\.EXTRA_TEXT_LINES/);
  assert.match(listener, /Notification\.EXTRA_SUB_TEXT/);
});

test('known bank packages survive OEM/restore installer metadata while unknown apps still require Play provenance', () => {
  const native = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/TrustedBankNotificationPackages.kt');
  const trustedBranch = native.indexOf('if (isTrusted(context, packageName)) return SOURCE_TRUSTED_BANK');
  const playBranch = native.indexOf('if (!playInstalled(context, packageName)) return null');
  assert.ok(trustedBranch >= 0 && playBranch > trustedBranch,
    'exact curated package ids must be admitted before the unknown-app Play installer gate');
});

test('every notification drain re-sweeps or rebinds before reading the encrypted queue', () => {
  const module = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/NotificationReaderModule.kt');
  const listener = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/BankNotificationListenerService.kt');
  const sweep = module.indexOf('BankNotificationListenerService.sweepOrRequestRebind(context)');
  const readQueue = module.indexOf('NotificationCaptureStore.read(context, sinceMs.toLong())');
  assert.ok(sweep >= 0 && readQueue > sweep);
  assert.match(listener, /requestRebind\(ComponentName\(context, BankNotificationListenerService::class\.java\)\)/);
  assert.match(listener, /fun isConnected\(\): Boolean = connected != null/);
  assert.match(module, /if \(!sweptImmediately\)[\s\S]{0,700}isConnected\(\)[\s\S]{0,260}Thread\.sleep\(50\)/);
  assert.match(listener, /override fun onListenerConnected\(\)[\s\S]{0,120}sweepActiveNotifications\(\)/);
});

test('only the official HSBC UAE Play package is eligible for UAE capture', () => {
  const enabled = moduleFor({});
  assert.equal(enabled.trustedBankNotificationMarket('ae.hsbc.hsbcuae'), 'AE');
  assert.equal(enabled.trustedBankNotificationMarket('com.htsu.hsbcpersonalbanking'), null);
  const native = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/TrustedBankNotificationPackages.kt');
  assert.match(native, /"ae\.hsbc\.hsbcuae" to "AE"/);
  assert.doesNotMatch(native, /"com\.htsu\.hsbcpersonalbanking" to /);
});

test('native opt-out defaults closed and clears ciphertext before future callbacks', () => {
  const base = 'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/';
  const policy = read(`${base}NotificationCapturePolicy.kt`);
  const store = read(`${base}NotificationCaptureStore.kt`);
  const listener = read(`${base}BankNotificationListenerService.kt`);
  const module = read(`${base}NotificationReaderModule.kt`);
  assert.match(policy, /getBoolean\(ENABLED, false\)/);
  assert.match(policy, /if \(!enabled\) NotificationCaptureStore\.clear\(context\)/);
  assert.ok(store.indexOf('if (!NotificationCapturePolicy.isEnabled(context)) return') <
    store.indexOf('purgeLegacyPlaintext(context)', store.indexOf('fun append(')));
  assert.ok(listener.indexOf('if (!NotificationCapturePolicy.isEnabled(this)) return') <
    listener.indexOf('NotificationCaptureStore.append('));
  assert.match(module, /AsyncFunction\("setCaptureEnabled"\)/);
  assert.match(module, /if \(enabled && changed\) BankNotificationListenerService\.sweepConnected\(\)/);
  assert.match(module, /ComponentName\.unflattenFromString\(value\)/);
  assert.match(module, /if \(!NotificationCapturePolicy\.isEnabled\(context\) \|\| !hasSystemAccess\(context\)\)/);
});

test('native listener admission expires without an app foreground refresh', () => {
  const base = 'modules/notification-reader/android/src/main/java/expo/modules/notificationreader/';
  const policy = read(`${base}NotificationCapturePolicy.kt`);
  const module = read(`${base}NotificationReaderModule.kt`);
  assert.match(policy, /getLong\(EXPIRES_AT, 0L\)/);
  assert.match(policy, /expiresAt > System\.currentTimeMillis\(\)/);
  assert.match(module, /AsyncFunction\("setCaptureEnabled"\) \{ enabled: Boolean, expiresAtMs: Double/);
});

test('the scanner reads only with native availability and granted notification access', async () => {
  let available = true, enabled = true, reads = 0, acknowledgements = 0;
  const notification = { isAvailable: () => available, isEnabled: () => enabled,
    getCaptured: async () => { reads++; return []; }, ackCaptured: async () => { acknowledgements++; return true; } };
  const scanner = load(path.join(root, 'src/lib/auto-import.ts'), {
    '@/lib/capture-trace': load(path.join(root, 'src/lib/capture-trace.ts')),
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
    'expo-crypto': {}, 'expo-secure-store': {},
    '../../modules/notification-reader': { __esModule: true, default: notification },
    '../../modules/sms-reader': { __esModule: true, default: { getInboxSms: async () => [] } },
    '@/lib/alert-review-tray': {}, '@/lib/format': { toISODate: () => '2026-09-08' },
    '@/lib/dedupe': { bodyPrint: value => value }, '@/lib/sms-parser': {},
    '@/lib/launch-alert-parser': { createLaunchAlertSession: () => ({ inspect: () => null, detectedMarket: () => null, parse: () => null }) },
    '@/lib/unparsed-launch-alert': {}, '@/lib/trusted-bank-notification-packages': moduleFor({}), '@/lib/import-plan': {},
  });
  const run = async () => { const result = await scanner.scanInbox(0, {}, undefined, null); await result.commit(); };
  available = false;
  await run(); assert.equal(reads, 0, 'missing native reader remains unavailable');
  available = true; enabled = false;
  await run(); assert.equal(reads, 0, 'declined/revoked Android access prevents queue reads');
  enabled = true;
  await run(); assert.equal(reads, 1, 'ordinary build and granted access can read retained candidates');
  enabled = false;
  await run(); assert.equal(reads, 1, 'revocation takes effect on the next scan');
  assert.equal(acknowledgements, 0, 'no admission or permission operation acknowledges financial rows');
});

test('notification-only scan drains without touching the SMS inbox', async () => {
  let smsReads = 0, notificationReads = 0;
  const scanner = load(path.join(root, 'src/lib/auto-import.ts'), {
    '@/lib/capture-trace': load(path.join(root, 'src/lib/capture-trace.ts')),
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
    'expo-crypto': {}, 'expo-secure-store': {},
    '../../modules/notification-reader': { __esModule: true, default: {
      isAvailable: () => true, isEnabled: () => true,
      getCaptured: async () => { notificationReads++; return []; },
    } },
    '../../modules/sms-reader': { __esModule: true, default: {
      getInboxSms: async () => { smsReads++; throw new Error('SMS must not be read'); },
    } },
    '@/lib/alert-review-tray': {}, '@/lib/format': { toISODate: () => '2026-09-08' },
    '@/lib/dedupe': { bodyPrint: value => value }, '@/lib/sms-parser': {},
    '@/lib/launch-alert-parser': { createLaunchAlertSession: () => ({ inspect: () => null, detectedMarket: () => null, parse: () => null }) },
    '@/lib/unparsed-launch-alert': {}, '@/lib/trusted-bank-notification-packages': moduleFor({}), '@/lib/import-plan': {},
  });
  const result = await scanner.scanInbox(0, {}, undefined, null, { notificationOnly: true });
  assert.equal(smsReads, 0);
  assert.equal(notificationReads, 1);
  assert.equal(result.inboxHistoryComplete, false, 'notification scan cannot claim SMS history completion');
});

test('unknown Play financial candidates stay review-only until explicitly learned on that phone', () => {
  const scanner = read('src/lib/auto-import.ts');
  const promotion = read('src/lib/review-promotion.ts');
  const types = read('src/lib/types.ts');
  assert.match(scanner, /sourceClass === 'financial-candidate' && learnedPackages\.has\(n\.pkg\)/);
  assert.match(scanner, /const autoSource = sourceClass === 'trusted-bank' \|\| learned/);
  assert.match(scanner, /const p = autoSource/);
  assert.match(scanner, /trustedBankNotificationSender\(n\.pkg\) \?\? \(autoSource \? `\$\{n\.pkg\} \$\{n\.title\}` : ''\)/);
  assert.match(promotion, /item\.sourceClass === 'financial-candidate'/);
  assert.match(promotion, /learnedNotificationPackage/);
  assert.match(types, /trustedNotificationPackages: string\[\]/);
});

test('500 queued notification candidates process without touching SMS and ACK only after commit', async () => {
  let smsReads = 0, parseCalls = 0, acknowledgements = 0;
  const rows = Array.from({ length: 500 }, (_, index) => ({
    id: `notification-row-${String(index).padStart(4, '0')}`,
    pkg: 'com.example.financeapp',
    title: 'Card purchase',
    text: `AED ${index + 1}.00 at TEST SHOP`,
    ts: 1_800_000_000_000 + index,
    sourceClass: 'financial-candidate',
  }));
  const parsed = {
    kind: 'transaction', type: 'expense', amountFils: 100, currency: 'AED',
    merchant: 'Test Shop', date: null, dueDay: null, minDueFils: null, card: null,
    reference: null, transferHint: false, snapshotFils: null, snapshotKind: null,
    categoryGuess: 'other', categoryDeliberate: false, raw: 'synthetic',
  };
  const scanner = load(path.join(root, 'src/lib/auto-import.ts'), {
    '@/lib/capture-trace': { captureTrace: () => {}, captureTraceEnabled: () => false },
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active' } },
    'expo-crypto': {}, 'expo-secure-store': {},
    '../../modules/notification-reader': { __esModule: true, default: {
      isAvailable: () => true, isEnabled: () => true,
      getCaptured: async () => rows,
      ackCaptured: async ids => { acknowledgements += ids.length; return true; },
    } },
    '../../modules/sms-reader': { __esModule: true, default: {
      getInboxSms: async () => { smsReads++; return []; },
    } },
    '@/lib/alert-review-tray': {}, '@/lib/format': { toISODate: () => '2026-09-08' },
    '@/lib/dedupe': { bodyPrint: value => value }, '@/lib/sms-parser': {},
    '@/lib/launch-alert-parser': { createLaunchAlertSession: () => ({
      inspect: () => null, detectedMarket: () => 'AE', parse: () => { parseCalls++; return parsed; },
    }) },
    '@/lib/unparsed-launch-alert': {}, '@/lib/trusted-bank-notification-packages': moduleFor({}), '@/lib/import-plan': {},
  });
  const result = await scanner.scanInbox(0, {}, undefined, null, {
    notificationOnly: true,
    learnedNotificationPackages: ['com.example.financeapp'],
  });
  assert.equal(smsReads, 0);
  assert.equal(parseCalls, 500);
  assert.equal(result.parsed.length, 500);
  assert.equal(result.scannedCount, 500);
  assert.equal(acknowledgements, 0);
  await result.commit();
  assert.equal(acknowledgements, 500);
});


test('eligible Android users are auto-admitted and prompted only for the unavoidable system grant', () => {
  const hook = read('src/hooks/use-auto-import.ts');
  const autoImport = read('src/lib/auto-import.ts');
  assert.match(hook, /current\.hydrated && current\.onboarded &&[\s\S]{0,120}!current\.captureOptOut && isProActive\(current\)/);
  assert.match(hook, /Platform\.OS !== 'android' \|\| !watchForeground \|\| androidNotificationAccessPromptShown/);
  assert.match(hook, /current\.captureOptOut \|\| !isProActive\(current\)/);
  assert.match(hook, /hasBankNotificationSystemAccess\(\)/);
  assert.match(hook, /openBankNotificationAccessSettings\(\)/);
  assert.match(autoImport, /NotificationReader\.hasSystemAccess\?\.\(\) === true/);
  assert.match(autoImport, /NotificationReader\.openSettings\?\.\(\) === true/);
});

test('Settings and draining use the same availability gate while permission revocation still blocks draining', () => {
  const settings = read('src/app/settings.tsx'); const scan = read('src/lib/auto-import.ts');
  assert.match(settings, /isBankNotificationCaptureAvailable\(NotificationReader\?\.isAvailable\?\.\(\) === true\)/);
  assert.match(scan, /isBankNotificationCaptureAvailable\(notificationReader\?\.isAvailable\?\.\(\) === true\)/);
  assert.match(scan, /notificationReader\?\.isEnabled\?\.\(\)/);
  assert.match(settings, /notifAccessFull/);
  const copy = load(path.join(root, 'src/lib/i18n.ts'));
  assert.match(copy.t('notifAccessFull', 'en'), /without SMS access/);
  assert.match(copy.t('notifAccessFull', 'ar'), /دون إذن الرسائل/);
});

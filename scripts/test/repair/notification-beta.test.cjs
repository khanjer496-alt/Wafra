'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const nativeFlag = 'WAFRA_ANDROID_NOTIFICATION_CAPTURE_BETA';
const publicFlag = 'EXPO_PUBLIC_WAFRA_ANDROID_NOTIFICATION_CAPTURE_BETA';
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const moduleFor = env => load(path.join(root, 'src/lib/trusted-bank-notification-packages.ts'), {}, { process: { env } });

test('notification capture is closed by default and requires the public beta flag plus native availability', () => {
  assert.equal(typeof moduleFor({}).isBankNotificationCaptureAvailable, 'function');
  for (const value of [undefined, '', '0', 'true', 'yes', '1']) {
    for (const nativeAvailable of [false, undefined, 'true', true]) {
      const actual = moduleFor({ [publicFlag]: value }).isBankNotificationCaptureAvailable(nativeAvailable);
      assert.equal(actual, value === '1' && nativeAvailable === true);
    }
  }
});

test('native BuildConfig opens only when both explicit beta flags are one', () => {
  const gradle = read('modules/notification-reader/android/build.gradle');
  const expression = gradle.match(/def notificationCaptureBetaEnabled = ([\s\S]*?)\n\nandroid \{/);
  assert.ok(expression, 'native gate is an explicit build-time expression');
  const evaluate = new Function('env', `return (${expression[1].replace(/System\.getenv\('([^']+)'\)/g, (_all, key) => `env[${JSON.stringify(key)}]`)});`);
  for (const env of [{}, { [nativeFlag]: '1' }, { [publicFlag]: '1' },
    { [nativeFlag]: 'true', [publicFlag]: '1' }, { [nativeFlag]: '1', [publicFlag]: '0' },
    { [nativeFlag]: '1', [publicFlag]: '1' }]) {
    assert.equal(evaluate(env), env[nativeFlag] === '1' && env[publicFlag] === '1');
  }
  assert.match(gradle, /buildConfig true/);
  assert.match(gradle, /buildConfigField 'boolean', 'WAFRA_ANDROID_NOTIFICATION_CAPTURE_BETA', notificationCaptureBetaEnabled\.toString\(\)/);
  const native = read('modules/notification-reader/android/src/main/java/expo/modules/notificationreader/TrustedBankNotificationPackages.kt');
  assert.match(native, /CAPTURE_ENABLED[^\n]*BuildConfig\.WAFRA_ANDROID_NOTIFICATION_CAPTURE_BETA/);
  assert.match(native, /if \(!CAPTURE_ENABLED\) return false/);
  assert.match(native, /return installer == "com\.android\.vending"/);
});

test('beta activation does not expand trusted package identities', () => {
  const disabled = moduleFor({}); const enabled = moduleFor({ [publicFlag]: '1' });
  assert.deepEqual(Object.keys(disabled.TRUSTED_BANK_NOTIFICATION_PACKAGES), Object.keys(enabled.TRUSTED_BANK_NOTIFICATION_PACKAGES));
  assert.equal(enabled.trustedBankNotificationMarket('com.example.notificationproducer'), null);
  assert.equal(enabled.trustedBankNotificationMarket('com.emiratesnbd.android.spoof'), null);
  assert.equal(enabled.trustedBankNotificationMarket('com.emiratesnbd.android'), 'AE');
});

test('the real scanner never reads or acknowledges notifications with a closed build or revoked access', async () => {
  let available = true, enabled = true, reads = 0, acknowledgements = 0;
  const env = {};
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
    '@/lib/unparsed-launch-alert': {}, '@/lib/trusted-bank-notification-packages': moduleFor(env), '@/lib/import-plan': {},
  });
  const run = async () => { const result = await scanner.scanInbox(0, {}, undefined, null); await result.commit(); };
  await run(); assert.equal(reads, 0, 'public flag defaults off even when native beta is available');
  env[publicFlag] = '1'; available = false;
  await run(); assert.equal(reads, 0, 'JS flag alone cannot open a production native reader');
  available = true; enabled = false;
  await run(); assert.equal(reads, 0, 'declined/revoked Android access prevents queue reads');
  enabled = true;
  await run(); assert.equal(reads, 1, 'explicit beta and granted access can read retained candidates');
  enabled = false;
  await run(); assert.equal(reads, 1, 'revocation takes effect on the next scan');
  assert.equal(acknowledgements, 0, 'no admission or permission operation acknowledges financial rows');
});

test('Settings and draining use the same availability gate while permission revocation still blocks draining', () => {
  const settings = read('src/app/settings.tsx'); const scan = read('src/lib/auto-import.ts');
  assert.match(settings, /isBankNotificationCaptureAvailable\(NotificationReader\?\.isAvailable\?\.\(\) === true\)/);
  assert.match(scan, /isBankNotificationCaptureAvailable\(notificationReader\?\.isAvailable\?\.\(\) === true\)/);
  assert.match(scan, /notificationReader\?\.isEnabled\?\.\(\)/);
  assert.match(settings, /notifAccessBetaFull/);
  const copy = load(path.join(root, 'src/lib/i18n.ts'));
  assert.match(copy.t('notifAccessBetaFull', 'en'), /SMS-reading access and a finished inbox scan/);
  assert.match(copy.t('bankPushBetaOn', 'en'), /Wafra opens or refreshes/);
  assert.match(copy.t('notifAccessBetaFull', 'ar'), /قراءة الرسائل/);
});

test('GitHub beta toggle defaults off and cannot produce a Play AAB', () => {
  const workflow = read('.github/workflows/build-apk.yml');
  assert.match(workflow, /notification_capture_beta:\s*\n\s*description:[^\n]*\n\s*type: boolean\s*\n\s*default: false/);
  for (const flag of [nativeFlag, publicFlag]) assert.ok(workflow.includes(`${flag}: \${{ github.event.inputs.notification_capture_beta == 'true' && '1' || '0' }}`));
  assert.match(workflow, /inputs\.notification_capture_beta == 'true' && github\.event\.inputs\.bundle == 'true'/);
  const eas = JSON.parse(read('eas.json'));
  for (const name of ['base', 'production', 'production-candidate']) {
    assert.notEqual(eas.build[name]?.env?.[nativeFlag], '1');
    assert.notEqual(eas.build[name]?.env?.[publicFlag], '1');
  }
});

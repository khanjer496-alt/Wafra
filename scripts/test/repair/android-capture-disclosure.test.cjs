'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('../../universal-test/load-ts.cjs');

function harness({ readGranted = false, systemAccess = false, choice = null, platform = 'android' } = {}) {
  const load = createLoader(), events = [];
  const rn = load('react-native'); rn.Platform.OS = platform;
  rn.PermissionsAndroid.check = async () => readGranted;
  rn.PermissionsAndroid.request = async permission => { events.push(permission); return 'granted'; };
  rn.Linking.openSettings = async () => { events.push('app-settings'); };
  const sms = { hasLiveSmsConsent: () => false, setLiveSmsConsent: value => { events.push(`live:${value}`); return true; } };
  const notifications = { isAvailable: () => true, hasSystemAccess: () => systemAccess,
    openSettings: () => { events.push('listener-settings'); return true; } };
  load('expo-modules-core').requireOptionalNativeModule = name =>
    name === 'SmsReader' ? sms : name === 'NotificationReader' ? notifications : null;
  const api = load('@/lib/auto-import');
  const consent = load('@/lib/consent-prompt');
  const show = value => consent.registerConsentPresenter(async prompt => {
    events.push(`disclosure:${prompt.androidCapture}`);
    assert.ok(prompt.body.length > 50);
    return value;
  });
  if (choice !== null) show(choice);
  return { api, events, show, rn, storage: load('expo-secure-store'), copy: load('@/lib/android-capture-disclosure'), t: load('@/lib/i18n').t };
}

test('READ_SMS never reaches Android without an affirmative in-app choice', async () => {
  for (const choice of [null, false]) {
    const h = harness({ choice });
    assert.equal(await h.api.requestSmsPermission(), false);
    assert.ok(!h.events.some(e => e.startsWith('android.permission')));
  }
  const h = harness({ choice: true });
  assert.equal(await h.api.requestSmsPermission(), true);
  assert.deepEqual(h.events, ['disclosure:sms-history', 'android.permission.READ_SMS']);
  h.events.length = 0; h.show(false);
  assert.equal(await h.api.requestSmsPermission(), false);
  assert.deepEqual(h.events, ['disclosure:sms-history'], 'a new runtime attempt needs a fresh choice');
});

test('an old OS grant still needs versioned disclosure, without a redundant runtime prompt', async () => {
  const h = harness({ readGranted: true, choice: false });
  assert.equal(await h.api.hasSmsPermission(), false);
  assert.equal(await h.api.requestSmsPermission(), false);
  assert.deepEqual(h.events, ['disclosure:sms-history']);
  h.events.length = 0; h.show(true);
  assert.equal(await h.api.requestSmsPermission(), true);
  assert.deepEqual(h.events, ['disclosure:sms-history']);
  assert.equal(await h.api.hasSmsPermission(), true);
  h.events.length = 0;
  assert.equal(await h.api.requestSmsPermission(), true);
  assert.deepEqual(h.events, []);
  const key = h.storage.__keychain.writes.at(-1).key;
  h.storage.__keychain.items.set(key, 'obsolete-version'); h.show(false);
  assert.equal(await h.api.hasSmsPermission(), false);
  assert.equal(await h.api.requestSmsPermission(), false);
});

test('disclosure refusal is distinguished from OS denial, and failed persistence never requests access', async () => {
  const h = harness({ choice: false }); let declined = 0;
  assert.equal(await h.api.requestSmsPermission({ onDisclosureDeclined: () => declined++ }), false);
  assert.equal(declined, 1);
  h.show(true); h.rn.PermissionsAndroid.request = async () => 'denied';
  assert.equal(await h.api.requestSmsPermission({ onDisclosureDeclined: () => declined++ }), false);
  assert.equal(declined, 1, 'system denial is not in-app refusal');
  h.events.length = 0;
  h.storage.setItemAsync = async () => { throw new Error('synthetic storage failure'); };
  await assert.rejects(h.api.requestSmsPermission(), /synthetic storage failure/);
  assert.deepEqual(h.events, ['disclosure:sms-history']);
});

test('revoking access opens Android settings without a grant disclosure', async () => {
  const h = harness({ readGranted: true, choice: false });
  await h.api.openSmsRevocationSettings();
  assert.deepEqual(h.events, ['app-settings']);
});

test('RECEIVE_SMS remains separately disclosed before the runtime request and native activation', async () => {
  const h = harness({ choice: false });
  assert.equal(await h.api.requestSmsDeliveryPermission(h.t), false);
  assert.deepEqual(h.events, ['disclosure:sms-live']);
  h.events.length = 0; h.show(true);
  assert.equal(await h.api.requestSmsDeliveryPermission(h.t), true);
  assert.deepEqual(h.events, ['disclosure:sms-live', 'android.permission.RECEIVE_SMS', 'live:true']);
});

test('listener decline changes neither capture admission nor OS settings', async () => {
  const h = harness({ choice: false });
  assert.equal(await h.api.openBankNotificationAccessSettings({ onAccepted: async () => {
    h.events.push('admission'); return true;
  } }), false);
  assert.deepEqual(h.events, ['disclosure:bank-notifications']);
  h.events.length = 0; h.show(true);
  assert.equal(await h.api.openBankNotificationAccessSettings({ onAccepted: async () => {
    h.events.push('admission'); return true;
  } }), true);
  assert.deepEqual(h.events, ['disclosure:bank-notifications', 'admission', 'listener-settings']);
  h.events.length = 0;
  assert.equal(await h.api.openBankNotificationAccessSettings({ onAccepted: async () => {
    h.events.push('admission-failed'); return false;
  } }), false);
  assert.deepEqual(h.events, ['disclosure:bank-notifications', 'admission-failed']);
});

test('already-granted listener activation still needs disclosure, without redundant Settings navigation', async () => {
  const h = harness({ systemAccess: true, choice: false });
  const options = { skipSettingsIfGranted: true, onAccepted: async () => { h.events.push('admission'); return true; } };
  assert.equal(await h.api.openBankNotificationAccessSettings(options), false);
  h.events.length = 0; h.show(true);
  assert.equal(await h.api.openBankNotificationAccessSettings(options), true);
  assert.deepEqual(h.events, ['disclosure:bank-notifications', 'admission']);
});

test('manual SMS Settings repair also requires the shared disclosure', async () => {
  const h = harness({ choice: false });
  await h.api.openSmsPermissionSettings();
  assert.deepEqual(h.events, ['disclosure:sms-history']);
  h.events.length = 0; h.show(true);
  await h.api.openSmsPermissionSettings();
  assert.deepEqual(h.events, ['disclosure:sms-history', 'app-settings']);
});

test('all disclosure kinds have specific English and Arabic data/use text and decline actions', () => {
  const h = harness();
  for (const language of ['en', 'ar']) for (const kind of ['sms-history', 'sms-live', 'bank-notifications']) {
    const p = h.copy.androidCaptureDisclosure(kind, language);
    assert.ok(p.question && p.body && p.confirmLabel && p.cancelLabel);
    if (language === 'ar') assert.match(p.body, /[\u0600-\u06ff]/);
    else assert.match(p.body, /SMS|notifications/);
  }
});

test('iOS and web never request Android permissions or open Android access settings', async () => {
  for (const platform of ['ios', 'web']) {
    const h = harness({ platform, choice: true });
    assert.equal(await h.api.requestSmsPermission(), false);
    assert.equal(await h.api.requestSmsDeliveryPermission(h.t), false);
    assert.equal(await h.api.openBankNotificationAccessSettings(), false);
    await h.api.openSmsPermissionSettings();
    assert.deepEqual(h.events, []);
  }
});

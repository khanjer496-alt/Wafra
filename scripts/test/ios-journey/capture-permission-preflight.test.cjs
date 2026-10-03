'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
function harness() {
  const urls = [], enabled = [];
  let statusUnavailable = false;
  let status = { enabled: false, entitled: true, pending: 0, dropped: 0, corrupt: false,
    setupProofVersion: null, firstCapturedAt: null };
  const health = load(path.join(root, 'src/lib/ios-capture-health.ts'));
  const api = load(path.join(root, 'src/lib/ios-capture-setup.ts'), {
    'react-native': { Platform: { OS: 'ios', Version: '26' }, Linking: {} },
    '@/lib/capture': { getIosCaptureNativeModule: () => null, subscribeIosCaptureStatusRefresh: () => () => {} },
    '@/lib/ios-local-capture-protocol': {
      IOS_LOCAL_CAPTURE_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/822bcc1dd2964b9f887ef9b93601441d',
      normalizeIosLocalCaptureShortcutUrl: value => value,
      iosLocalCaptureTestUrl: () => 'shortcuts://run-shortcut?name=Wafra%20Capture%20v2&input=text&text=WAFRA_SETUP_CHECK_V1',
    },
    './ios-capture-health': health,
  });
  const controller = api.createIosCaptureSetup({ dependencies: {
    isSupported: () => true,
    getNativeModule: () => ({ getCaptureStatus: async () => { if (statusUnavailable) throw new Error('unavailable'); return status; },
      setCaptureEnabled: async value => { enabled.push(value); status = { ...status, enabled: value }; } }),
    canOpenUrl: async () => true,
    openUrl: async value => { urls.push(value); },
  } });
  return { api, controller, urls, enabled, failStatus: () => { statusUnavailable = true; }, setStatus: value => { status = { ...status, ...value }; } };
}
test('the installed Shortcut is checked before asking users to create an automation', () => {
  const { api, controller } = harness();
  const progress = { futureShortcutConfirmed: true, futureAutomationConfirmed: false, futureStatus: 'in-progress' };
  assert.equal(api.resolveIosFutureSetupStep(progress, 'not-added'), 'prove-shortcut');
  assert.equal(api.resolveIosFutureSetupStep(progress, 'shortcut-proven'), 'create-automation');
  assert.equal(api.resolveIosFutureSetupStep({ ...progress, futureAutomationConfirmed: true }, 'shortcut-proven'), 'ready');
  controller.dispose();
});
test('preflight runs in the foreground, callback alone cannot prove capture, and confirmation need not rerun a proven Shortcut', async () => {
  const h = harness(); await h.controller.send({ type: 'load' });
  await h.controller.send({ type: 'check-shortcut' });
  assert.deepEqual(h.enabled, [true]);
  assert.equal(h.urls.length, 1);
  assert.match(h.urls[0], /WAFRA_SETUP_CHECK_V1/);
  await h.controller.send({ type: 'shortcut-callback', result: 'success' });
  assert.equal(h.controller.getModel().readiness, 'not-added');
  h.setStatus({ setupProofVersion: 1 });
  await h.controller.send({ type: 'shortcut-callback', result: 'success' });
  assert.equal(h.controller.getModel().readiness, 'shortcut-proven');
  await h.controller.send({ type: 'automation-added' });
  assert.equal(h.urls.length, 1, 'confirming the Apple automation must not repeat the permission run');
  assert.equal(h.controller.getModel().readiness, 'shortcut-proven', 'confirmation is not evidence of a real alert');
  h.controller.dispose();
});
test('turning capture off after preflight cannot reuse stale enabled proof', async () => {
  const h = harness(); h.setStatus({ enabled: true, setupProofVersion: 1 });
  await h.controller.send({ type: 'load' });
  h.setStatus({ enabled: false });
  await h.controller.send({ type: 'automation-added' });
  assert.deepEqual(h.enabled, [true]);
  assert.equal(h.urls.length, 1);
  h.controller.dispose();
});
test('an unavailable status check cannot treat a previously proven Shortcut as currently enabled', async () => {
  const h = harness(); h.setStatus({ enabled: true, setupProofVersion: 1 });
  await h.controller.send({ type: 'load' });
  h.failStatus();
  await h.controller.send({ type: 'automation-added' });
  assert.equal(h.controller.getModel().failure, 'load');
  assert.equal(h.controller.getModel().readiness, 'not-added');
  assert.deepEqual(h.urls, []);
  h.controller.dispose();
});

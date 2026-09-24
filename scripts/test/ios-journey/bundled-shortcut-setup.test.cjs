'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const protocol = load(path.join(root, 'src/lib/ios-local-capture-protocol.ts'), {}, { process: { env: {} } });
const api = load(path.join(root, 'src/lib/ios-capture-setup.ts'), {
  'react-native': { Platform: { OS: 'ios', Version: '26.6' }, Linking: {} },
  '@/lib/capture': { getIosCaptureNativeModule: () => null, subscribeIosCaptureStatusRefresh: () => () => {} },
  '@/lib/ios-local-capture-protocol': protocol,
  './ios-capture-health': load(path.join(root, 'src/lib/ios-capture-health.ts')),
});
function setup(uri = 'file:///app/Wafra%20Capture%20v3.shortcut') {
  const shared = [], opened = [];
  const controller = api.createIosCaptureSetup({ dependencies: {
    isSupported: () => true, shortcutUrl: null,
    getNativeModule: () => ({ getMessageShortcutURL: async () => uri,
      getCaptureStatus: async () => ({ enabled: true, entitled: true, pending: 0, dropped: 0, corrupt: false,
        setupProofVersion: null, firstCapturedAt: null }), setCaptureEnabled: async () => {} }),
    shareShortcut: async url => shared.push(url), canOpenUrl: async () => true,
    openUrl: async url => opened.push(url),
  } });
  return { controller, shared, opened };
}
test('a modern binary installs its bundled SMS graph without a public URL and runs that exact name', async () => {
  const h = setup(); await h.controller.send({ type: 'load' });
  assert.equal(h.controller.getModel().shortcutAvailable, true);
  assert.equal(h.controller.getModel().shortcutName, 'Wafra Capture v3');
  await h.controller.send({ type: 'install-shortcut' });
  assert.deepEqual(h.shared, ['file:///app/Wafra%20Capture%20v3.shortcut']);
  assert.deepEqual(h.opened, []);
  await h.controller.send({ type: 'check-shortcut' });
  const url = new URL(h.opened[0]);
  assert.equal(url.searchParams.get('name'), 'Wafra Capture v3');
  assert.equal(url.searchParams.get('text'), 'WAFRA_SETUP_CHECK_V1');
  assert.equal(h.controller.getModel().readiness, 'not-added');
  h.controller.dispose();
});
test('a malformed bundled location fails without opening or sharing another destination', async () => {
  for (const uri of ['https://example.com/file.shortcut', 'file:///private/finance.json']) {
    const h = setup(uri); await h.controller.send({ type: 'load' });
    await h.controller.send({ type: 'install-shortcut' });
    assert.equal(h.controller.getModel().failure, 'shortcut-install');
    assert.deepEqual(h.shared, []); assert.deepEqual(h.opened, []); h.controller.dispose();
  }
});
test('an older installed Shortcut confirmation cannot skip adding the bundled version', () => {
  const progress = { futureShortcutConfirmed: true, futureAutomationConfirmed: true, futureStatus: 'complete' };
  assert.equal(api.resolveIosFutureSetupStep(progress, 'shortcut-proven', 3), 'add-shortcut');
  assert.equal(api.resolveIosFutureSetupStep({ ...progress, futureShortcutVersion: 3 }, 'shortcut-proven', 3), 'ready');
});
test('bundled capture requires its own v3 proof even when an old installation received real alerts', () => {
  for (const firstCapturedAt of [null, Date.now()]) {
    assert.equal(api.resolveIosSetupReadiness({ enabled: true, setupProofVersion: 1, firstCapturedAt }, 3), 'not-added');
  }
  assert.equal(api.resolveIosSetupReadiness({ enabled: true, setupProofVersion: 3, firstCapturedAt: null }, 3), 'shortcut-proven');
  assert.equal(api.resolveIosSetupReadiness({ enabled: false, setupProofVersion: 3, firstCapturedAt: null }, 3), 'not-added');
  assert.equal(api.resolveIosSetupReadiness({ enabled: true, setupProofVersion: 1, firstCapturedAt: null }), 'shortcut-proven');
});

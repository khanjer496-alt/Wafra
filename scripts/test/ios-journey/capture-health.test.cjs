'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const health = load(path.join(root, 'src/lib/ios-capture-health.ts'));
const valid = () => ({ enabled: true, entitled: true, pending: 0, dropped: 0, corrupt: false,
  setupProofVersion: 1, firstCapturedAt: null, lastReceivedAt: null, lastHandledAt: null });
function controllerHarness() {
  let status = valid(); let fail = false; let supported = true;
  const setup = load(path.join(root, 'src/lib/ios-capture-setup.ts'), {
    'react-native': { Linking: {}, Platform: { OS: 'ios', Version: '26' } },
    '@/lib/capture': { getIosCaptureNativeModule() {}, subscribeIosCaptureStatusRefresh: () => () => {} },
    '@/lib/ios-local-capture-protocol': { IOS_LOCAL_CAPTURE_SHORTCUT_URL: 'https://www.icloud.com/shortcuts/test',
      iosLocalCaptureTestUrl: () => 'shortcuts://run-shortcut', normalizeIosLocalCaptureShortcutUrl: (v) => v },
    './ios-capture-health': health,
  });
  const controller = setup.createIosCaptureSetup({ dependencies: {
    isSupported: () => supported,
    getNativeModule: () => ({ getCaptureStatus: async () => { if (fail) throw new Error('not available'); return status; },
      setCaptureEnabled: async (enabled) => { status = { ...status, enabled }; } }),
    shortcutUrl: 'https://www.icloud.com/shortcuts/test', canOpenUrl: async () => true, openUrl: async () => {},
  } });
  return { ...setup, controller, change: (next) => { status = next; }, fail: () => { fail = true; },
    unsupported: () => { supported = false; } };
}

test('missing, malformed and impossible timestamps never become first-alert evidence', () => {
  const h = controllerHarness();
  for (const value of [undefined, null, NaN, Infinity, -Infinity, -1, '1720000000000', false, 8640000000000001]) {
    assert.equal(h.resolveIosSetupReadiness({ ...valid(), firstCapturedAt: value }), 'shortcut-proven');
    assert.equal(health.isCaptureTimestamp(value), false);
  }
  for (const value of [0, 1720000000000]) {
    assert.equal(h.resolveIosSetupReadiness({ ...valid(), firstCapturedAt: value }), 'first-alert-captured');
  }
  assert.equal(h.resolveIosSetupReadiness({ ...valid(), enabled: 'yes', firstCapturedAt: 1 }), 'not-added');
});
test('older native binaries retain queue facts without fabricating new receipt times', () => {
  const old = valid(); delete old.lastReceivedAt; delete old.lastHandledAt;
  const view = health.readIosCaptureHealth({ ...old, pending: 3 });
  assert.equal(view.pending, 3); assert.equal(view.lastReceivedAt, null); assert.equal(view.lastHandledAt, null);
});
test('native projection keeps no messages, sender, key or arbitrary payload', () => {
  const view = health.readIosCaptureHealth({ ...valid(), sender: 'private-sender', body: 'private-body',
    eventId: 'private-id', token: 'private-key' });
  assert.doesNotMatch(JSON.stringify(view), /private|sender|body|eventId|token/);
  assert.deepEqual(Object.keys(view).sort(), ['corrupt','dropped','enabled','entitled','firstCapturedAt','lastHandledAt','lastReceivedAt','pending'].sort());
});
test('corrupt counters cannot produce an empty or healthy status', () => {
  for (const patch of [{ pending: -1 }, { pending: 0.5 }, { pending: NaN }, { dropped: Infinity },
    { dropped: '0' }, { enabled: 1 }, { entitled: undefined }, { corrupt: null }]) {
    assert.equal(health.readIosCaptureHealth({ ...valid(), ...patch }), null);
  }
});
test('missing receipts are not replaced with today or interpreted as success', () => {
  for (const patch of [{ lastReceivedAt: NaN }, { lastReceivedAt: 'today' }, { lastReceivedAt: -1 }, { lastHandledAt: Infinity }]) {
    const view = health.readIosCaptureHealth({ ...valid(), ...patch });
    assert.equal(view.lastReceivedAt, null); assert.equal(view.lastHandledAt, null);
  }
});
test('capture states separate queue activity, disabled capture, expired lease and losses', () => {
  const mode = (patch) => health.iosCaptureHealthMode(health.readIosCaptureHealth({ ...valid(), ...patch }));
  assert.equal(health.iosCaptureHealthMode(null), 'unknown');
  assert.equal(mode({ enabled: false, pending: 2 }), 'off');
  assert.equal(mode({ entitled: false, pending: 2 }), 'paused');
  assert.equal(mode({ corrupt: true }), 'attention');
  assert.equal(mode({ dropped: 1 }), 'attention');
  assert.equal(mode({ pending: 4 }), 'queued');
  assert.equal(mode({ firstCapturedAt: 100 }), 'empty');
});
test('the actual setup controller publishes native queue facts and clears stale status on failure', async () => {
  const h = controllerHarness();
  h.change({ ...valid(), pending: 2, lastReceivedAt: 1720000000000 });
  await h.controller.send({ type: 'load' });
  assert.equal(h.controller.getModel().captureHealth.pending, 2);
  h.fail(); await h.controller.send({ type: 'refresh-status' });
  assert.equal(h.controller.getModel().captureHealth, null);
  assert.equal(h.controller.getModel().readiness, 'not-added');
  assert.equal(h.controller.getModel().failure, 'load'); h.controller.dispose();
});
test('moving to an unsupported runtime clears previous successful receipt state', async () => {
  const h = controllerHarness(); await h.controller.send({ type: 'load' });
  assert.ok(h.controller.getModel().captureHealth);
  h.unsupported(); await h.controller.send({ type: 'refresh-status' });
  assert.equal(h.controller.getModel().captureHealth, null); h.controller.dispose();
});
test('date copy handles unknowns and both languages without asserting all purchases arrived', () => {
  for (const language of ['en', 'ar']) {
    const copy = health.iosCaptureHealthCopy(language);
    assert.equal(health.formatCaptureReceipt(null, language), copy.missing);
    assert.notEqual(health.formatCaptureReceipt(1720000000000, language), copy.missing);
    assert.ok(Object.values(copy).every(v => typeof v === 'string' && v.length));
  }
  assert.match(health.iosCaptureHealthCopy('en').explanation, /does not prove Apple delivered every bank alert/);
});
function panel(expanded, language = 'en') {
  let toggled;
  const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
  const { IosCaptureHealthPanel } = load(path.join(root, 'src/components/ios-message-setup/capture-health.tsx'), {
    react: { useState: () => [expanded, fn => { toggled = fn(expanded); }] },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Pressable: 'Pressable', View: 'View', StyleSheet: { create: s => s } },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/lib/ios-capture-health': health,
  });
  const tree = IosCaptureHealthPanel({ health: health.readIosCaptureHealth(valid()), language });
  const nodes = [];
  function walk(n) { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === 'object') { nodes.push(n); walk(n.props?.children); } }
  walk(tree); return { nodes, toggled: () => toggled };
}
test('actual diagnostic component is collapsed and accessible until explicitly opened', () => {
  const h = panel(false); const toggle = h.nodes.find(n => n.type === 'Pressable');
  assert.equal(toggle.props.accessibilityRole, 'button'); assert.equal(toggle.props.accessibilityState.expanded, false);
  assert.equal(h.nodes.some(n => n.props.testID === 'ios-capture-health-details'), false);
  toggle.props.onPress(); assert.equal(h.toggled(), true);
});
test('expanded details render in Arabic and can be closed without losing capture state', () => {
  const h = panel(true, 'ar'); assert.ok(h.nodes.some(n => n.props.testID === 'ios-capture-health-details'));
  const toggle = h.nodes.find(n => n.type === 'Pressable');
  assert.match(toggle.props.accessibilityLabel, /إخفاء التفاصيل/); toggle.props.onPress(); assert.equal(h.toggled(), false);
});

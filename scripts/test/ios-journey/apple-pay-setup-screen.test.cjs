const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const walk = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [n, ...walk(n.props?.children)];
const health = load(path.join(root, 'src/lib/ios-capture-health.ts'));
const helper = load(path.join(root, 'src/lib/ios-apple-pay-setup.ts'), { './ios-capture-health': health }, { URL });
const progressApi = load(path.join(root, 'src/lib/ios-message-onboarding.ts'), {
  '@react-native-async-storage/async-storage': {}, './ios-setup-journey': { futureSetupConfigured: () => false },
  './ios-history-setup': { isIosHistoryShortcutInstalled: async () => false },
});

async function screen({ version = '17.0', nativePresent = true, capability = true, enabled = false, entitled = true, proof = null, received = null, bundled = true, installed = false, saved = null } = {}) {
  const slots = [], effects = [], events = [], urls = [], shares = [], routes = [], listeners = [];
  let cursor = 0, generation = 1, holdNext;
  const generationFn = () => generation;
  let status = { enabled, entitled, pending: 0, dropped: 0, corrupt: false, applePayPending: 0,
    setupProofVersion: 3, firstCapturedAt: Date.now(), applePaySetupProofAt: proof,
    firstApplePayReceivedAt: received, lastApplePayReceivedAt: received };
  let progress = saved ?? { version: 1, activeSection: 'future', futureCaptureSource: 'apple-pay', futureShortcutConfirmed: installed,
    futureAutomationConfirmed: false, futureStatus: 'in-progress', historyShortcutConfirmed: false, historyStatus: 'not-started', returnToOnboarding: true };
  const slot = create => slots[cursor++] ?? (slots[cursor - 1] = create());
  const react = {
    useRef: value => slot(() => ({ current: value })),
    useState(value) { const s = slot(() => ({ value })); return [s.value, x => { s.value = typeof x === 'function' ? x(s.value) : x; }]; },
    useCallback(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => v !== s.deps[i])) { s.deps = deps; s.fn = fn; } return s.fn; },
    useEffect(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => v !== s.deps[i])) { s.deps = deps; effects.push(() => { s.cleanup?.(); s.cleanup = fn(); }); } },
  };
  const jsx = (type, props) => typeof type === 'function' ? type(props ?? {}) : ({ type, props: props ?? {} });
  const native = { applePayCaptureSupported: capability,
    ...(bundled ? { getApplePayShortcutURL: async () => 'file:///app/WafraLiveCaptureResources.bundle/Wafra%20Apple%20Pay%20v1.shortcut' } : {}),
    getCaptureStatus: async () => { events.push('read-status'); const snapshot = { ...status }; if (holdNext) { const waiting = holdNext; holdNext = null; await waiting; } return snapshot; },
    setCaptureEnabled: async enabled => { events.push(`enabled:${enabled}`); status = { ...status, enabled }; },
  };
  const component = load(path.join(root, 'src/app/ios-apple-pay-setup.tsx'), {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: 'ios', Version: version }, View: 'View', StyleSheet: { create: styles => styles, hairlineWidth: 1 },
      Linking: { openURL: async url => urls.push(url) }, AppState: { addEventListener: (_, fn) => { listeners.push(fn); return { remove() {} }; } } },
    'expo-router': { Stack: { Screen: 'Screen' }, useRouter: () => ({ dismissTo: route => routes.push(route), push: route => routes.push(route), setParams() {} }), useLocalSearchParams: () => ({ fromOnboarding: '1', shortcutResult: 'success' }) },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async (uri, options) => shares.push({ uri, options }) },
    // The ink band renders its band content, then the sheet; E buttons are the screen's buttons.
    '@/components/ui/band-scaffold': { BandScaffold: p => ({ type: 'BandScaffold', props: { ...p, children: [p.bandContent, p.children] } }) },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/ui/band/e-button': { EButton: 'Button' },
    '@/constants/theme': { Fonts: { sansSemi: 'Geist-SemiBold' } },
    '@/hooks/use-band': { useBand: id => ({ id, band: 'band', onBand: 'on', onBandSecondary: 'on2', tile: 'tile', bandRule: 'rule',
      text: 'text', textSecondary: 'text2', rule: 'rule', fill: 'fill', onFill: 'onFill', statusOk: 'ok', statusOver: 'over' }) },
    '@/hooks/use-language': { useLanguage: () => 'en' }, '@/hooks/use-large-text-layout': { useLargeTextLayout: () => false },
    '@/lib/capture-band-copy': load(path.join(root, 'src/lib/capture-band-copy.ts')),
    '@/lib/capture': { getIosCaptureNativeModule: () => nativePresent ? native : null, subscribeIosCaptureStatusRefresh: () => () => {} },
    '@/lib/ios-capture-health': health, '@/lib/ios-apple-pay-setup': helper,
    '@/lib/details-copy': load(path.join(root, 'src/lib/details-copy.ts')),
    '@/lib/ios-message-onboarding': { dispatchIosMessageSetup: async event => { events.push(event); progress = progressApi.reduceIosMessageSetup(progress, event); }, loadIosMessageSetupProgress: async () => progress, progressForSource: progressApi.progressForSource },
    '@/lib/store': { useStore: () => ({ state: { hydrated: true, onboarded: false }, getStateGeneration: generationFn,
      setCaptureOptOut: async value => events.push(`opt-out:${value}`) }) },
  }).default;
  let tree;
  const render = () => { cursor = 0; tree = component(); for (const effect of effects.splice(0)) effect(); };
  const flush = async () => { for (let i = 0; i < 6; i++) { await new Promise(r => setImmediate(r)); render(); } };
  render(); await flush();
  return { events, urls, shares, routes, flush, saved: () => progress, tree: () => tree,
    text: () => walk(tree).filter(n => n.type === 'Text').map(n => n.props.children).join(' '),
    button: label => walk(tree).find(n => n.type === 'Button' && n.props.label === label)?.props,
    async foreground(patch = {}) { status = { ...status, ...patch }; for (const fn of listeners) fn('active'); await flush(); },
    replaceLedger: () => { generation++; },
    holdRead: () => { let resolve; holdNext = new Promise(r => { resolve = r; }); return resolve; },
  };
}

test('unsupported iOS and missing native capability expose no capture action', async () => {
  for (const options of [{ version: '16.6' }, { nativePresent: false }, { capability: false }]) {
    const h = await screen(options);
    assert.equal(h.button('Enable capture on this iPhone'), undefined);
    assert.deepEqual(h.events, []);
  }
});
test('capture requires explicit opt-in and active entitlement', async () => {
  const blocked = await screen({ entitled: false });
  blocked.button('Enable capture on this iPhone').onPress(); await blocked.flush();
  assert.equal(blocked.events.some(e => typeof e === 'string' && /^(enabled|opt-out):/.test(e)), false);
  assert.match(blocked.text(), /Capture access is inactive/);
  const active = await screen();
  assert.equal(active.events.includes('enabled:true'), false);
  active.button('Enable capture on this iPhone').onPress(); await active.flush();
  assert.ok(active.events.indexOf('opt-out:false') < active.events.indexOf('enabled:true'));
});
test('sharing does not confirm installation; permission callback is not native proof', async () => {
  const h = await screen({ enabled: true });
  h.button('Add Apple Pay Shortcut').onPress(); await h.flush();
  assert.equal(h.shares.length, 1);
  assert.equal(h.shares[0].options.UTI, 'com.apple.shortcut');
  assert.match(h.text(), /Installation has not been confirmed/);
  h.button('I added the Shortcut').onPress(); await h.flush();
  h.button('Run permission check').onPress(); await h.flush();
  const url = new URL(h.urls[0]);
  assert.equal(url.searchParams.get('name'), 'Wafra Apple Pay v1');
  assert.equal(url.searchParams.has('input'), false);
  assert.equal(url.searchParams.has('text'), false);
  assert.equal(h.button('I saved the Apple Pay automation').disabled, true);
});
test('manual automation confirmation is separate from native proof and actual receipt', async () => {
  const h = await screen({ enabled: true, installed: true, proof: Date.now() });
  assert.match(h.text(), /Waiting for the first Apple Pay purchase/);
  assert.equal(h.events.some(e => e.type === 'future-automation-confirmed'), false);
  h.button('I saved the Apple Pay automation').onPress(); await h.flush();
  assert.ok(h.events.some(e => e.type === 'future-automation-confirmed'));
  assert.equal(h.routes[0].pathname, '/ios-setup');
  assert.match(h.routes[0].params.applePayReturn, /^\d{13}$/);
  assert.equal(h.routes[0].params.fromOnboarding, '1');
  await h.foreground({ firstApplePayReceivedAt: Date.now(), lastApplePayReceivedAt: Date.now() });
  assert.match(h.text(), /not a payment-settlement confirmation/);
});
test('incomplete events and manual older-binary fallback remain actionable', async () => {
  const h = await screen({ enabled: true, bundled: false });
  assert.match(h.text(), /Keep the whole currency amount/);
  assert.equal(h.button('Add Apple Pay Shortcut'), undefined);
  await h.foreground({ lastApplePayIncompleteAt: Date.now() });
  assert.match(h.text(), /Wallet reached Wafra without usable purchase details/);
  assert.equal(h.button('I saved the Apple Pay automation').disabled, true);
});
test('stale ledger generation cannot enable capture after an awaited status read', async () => {
  const h = await screen();
  const release = h.holdRead();
  h.button('Enable capture on this iPhone').onPress();
  h.replaceLedger(); release(); await h.flush();
  assert.equal(h.events.includes('enabled:true'), false);
  assert.equal(h.events.includes('opt-out:false'), false);
});
test('helper rejects foreign files and keeps receipts distinct from setup checks', () => {
  assert.equal(helper.isBundledApplePayShortcutUri('file:///app/WafraLiveCaptureResources.bundle/Wafra%20Apple%20Pay%20v1.shortcut'), true);
  for (const value of ['https://example.com/a.shortcut', 'file:///private/finance.json', 'file:///private/Wafra Apple Pay v1.shortcut']) assert.equal(helper.isBundledApplePayShortcutUri(value), false);
  const projected = helper.resolveApplePaySetupState({ enabled: true, entitled: true, firstApplePayReceivedAt: Date.now() });
  assert.equal(projected.received, true); assert.equal(projected.checked, false); assert.equal(projected.canConfirm, false);
});

test('setting up Apple Pay keeps a finished SMS setup recorded until Apple Pay is itself confirmed', async () => {
  const sms = { version: 1, activeSection: 'future', futureShortcutConfirmed: true, futureShortcutVersion: 3,
    futureAutomationConfirmed: true, futureStatus: 'complete', historyShortcutConfirmed: false, historyStatus: 'not-started', returnToOnboarding: false };
  const h = await screen({ saved: sms });
  h.button('Enable capture on this iPhone').onPress(); await h.flush();
  h.button('Add Apple Pay Shortcut').onPress(); await h.flush();
  h.button('I added the Shortcut').onPress(); await h.flush();
  assert.equal(h.events.some(e => e.type === 'future-source-changed'), false);
  assert.equal(h.saved().futureCaptureSource, undefined, 'Home still reports the SMS setup');
  assert.deepEqual([h.saved().futureShortcutConfirmed, h.saved().futureShortcutVersion, h.saved().futureAutomationConfirmed, h.saved().futureStatus],
    [true, 3, true, 'complete']);
  assert.match(h.text(), /Shortcut installation confirmed by you/, 'Apple Pay reads its own parked progress');
  await h.foreground({ applePaySetupProofAt: Date.now() });
  h.button('I saved the Apple Pay automation').onPress(); await h.flush();
  assert.equal(h.saved().futureCaptureSource, 'apple-pay');
  assert.equal(h.saved().futureAutomationConfirmed, true);
  assert.equal(h.saved().parkedSources.message.automationConfirmed, true, 'SMS progress is parked, not erased');
});

test('the ink band shows the plain title, one line and an example marked as one; steps and gates stay on the sheet', async () => {
  const h = await screen({ enabled: true });
  const scaffold = h.tree();
  assert.equal(scaffold.type, 'BandScaffold');
  assert.equal(scaffold.props.band, 'home');
  const band = walk(scaffold.props.bandContent);
  const example = band.find(n => n.props?.testID === 'apple-pay-example');
  assert.ok(example, 'the example sits on the band');
  assert.match(example.props.accessibilityLabel, /^Example only\..*waits in Review/);
  const bandText = band.filter(n => n.type === 'Text').map(n => n.props.children).join(' ');
  assert.match(bandText, /Apple Pay purchases/);
  assert.match(bandText, /goes to Review/);
  assert.match(bandText, /Example/);
  assert.doesNotMatch(bandText, /•|\d{4}/, 'no card identity is shown');
  const sheet = walk(scaffold.props.children);
  for (const id of ['apple-pay-step-install', 'apple-pay-step-check', 'apple-pay-step-automation']) {
    assert.ok(sheet.some(n => n.props?.testID === id), id);
  }
  assert.ok(sheet.some(n => n.props?.accessibilityLabel === 'Step 1'), 'numbered, not done before the gates');
  assert.ok(sheet.some(n => n.props?.accessibilityLabel === 'Step 2'));
  // What turning capture on covers is read before the button that turns it on.
  const off = walk((await screen()).tree().props.children);
  const scopeAt = off.findIndex(n => n.props?.testID === 'apple-pay-scope');
  const enableAt = off.findIndex(n => n.props?.testID === 'apple-pay-enable' || (n.type === 'Button' && n.props.label === 'Enable capture on this iPhone'));
  assert.ok(scopeAt >= 0 && enableAt > scopeAt, `scope ${scopeAt} precedes enable ${enableAt}`);
  // The back control is inert while a step is running.
  const busy = await screen();
  const release = busy.holdRead();
  busy.button('Enable capture on this iPhone').onPress();
  await new Promise(r => setImmediate(r));
  await busy.flush();
  busy.tree().props.nav.back();
  assert.deepEqual(busy.routes, [], 'no navigation while busy');
  release(); await busy.flush();
  busy.tree().props.nav.back();
  assert.equal(busy.routes[0].pathname, '/ios-setup');
});

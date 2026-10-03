'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const progressApi = load(path.join(root, 'src/lib/ios-message-onboarding.ts'), {
  '@react-native-async-storage/async-storage': {}, './ios-setup-journey': { futureSetupConfigured: () => false },
  './ios-history-setup': { isIosHistoryShortcutInstalled: async () => false },
});
const walk = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(walk) : [n, ...walk(n.props?.children)];
async function screen({ version = '27.0', capability = true, enabled = false, proof = null, received = null, entitled = true, bundled = false, language = 'en', scheme = 'light' } = {}) {
  const slots = [], effects = [], urls = [], clipboard = [], shares = [], events = [], routes = [];
  let cursor = 0, generation = 1;
  let status = { enabled, entitled, pending: 0, dropped: 0, corrupt: false,
    setupProofVersion: 1, firstCapturedAt: null, notificationSetupProofAt: proof,
    firstNotificationReceivedAt: received, lastNotificationReceivedAt: received };
  const slot = create => slots[cursor++] ?? (slots[cursor - 1] = create());
  const react = {
    useRef: value => slot(() => ({ current: value })),
    useState(value) { const s = slot(() => ({ value })); return [s.value, x => { s.value = typeof x === 'function' ? x(s.value) : x; }]; },
    useCallback(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => v !== s.deps[i])) { s.deps = deps; s.fn = fn; } return s.fn; },
    useEffect(fn, deps) { const s = slot(() => ({})); if (!s.deps || deps.some((v, i) => v !== s.deps[i])) { s.deps = deps; effects.push(() => { s.cleanup?.(); s.cleanup = fn(); }); } },
  };
  const jsx = (type, props) => typeof type === 'function' ? type(props ?? {}) : ({ type, props: props ?? {} });
  const listeners = [];
  const native = { notificationCaptureSupported: capability,
    ...(bundled ? { getNotificationShortcutURL: async () => 'file:///app/WafraLiveCaptureResources.bundle/Wafra%20Notifications%20v1.shortcut' } : {}),
    getCaptureStatus: async () => { events.push('read-status'); return status; },
    setCaptureEnabled: async value => { events.push(`enabled:${value}`); status = { ...status, enabled: value }; } };
  const palette = load(path.join(root, 'src/constants/theme.ts'), { '@/global.css': {}, 'react-native': { Platform: { select: choices => choices.default } } }).bandPalette('flow', scheme);
  const health = load(path.join(root, 'src/lib/ios-capture-health.ts'));
  const setup = load(path.join(root, 'src/lib/ios-capture-setup.ts'), {
    'react-native': { Platform: { OS: 'ios', Version: version }, Linking: {} },
    '@/lib/capture': {}, '@/lib/ios-local-capture-protocol': {}, './ios-capture-health': health,
  });
  const copy = load(path.join(root, 'src/lib/ios-notification-copy.ts'));
  const component = load(path.join(root, 'src/app/ios-notification-setup.tsx'), {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { Platform: { OS: 'ios', Version: version }, View: 'View', ScrollView: 'ScrollView', StyleSheet: { create: value => value, hairlineWidth: 1 },
      Linking: { openURL: async url => urls.push(url) }, AppState: { addEventListener: (_, fn) => { listeners.push(fn); return { remove() {} }; } } },
    'expo-router': { Stack: { Screen: 'Screen' }, useRouter: () => ({ dismissTo: route => routes.push(route), setParams: () => {} }), useLocalSearchParams: () => ({ fromOnboarding: '1' }) },
    'expo-clipboard': { setStringAsync: async text => clipboard.push(text) },
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async uri => shares.push(uri) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/ui/band-scaffold': { BandScaffold: props => jsx('BandScaffold', { ...props, children: [props.bandContent, props.children, props.footer] }) },
    '@/components/ui/band/e-button': { EButton: 'Button' },
    '@/components/ios-message-setup/setup-step': {
      SetupStep: props => jsx('SetupStep', { ...props, children: [jsx('Text', {children: props.title}), props.result && jsx('Text', {children: props.result.title}), props.children] }),
      SetupResult: props => jsx('Text', {children: props.title}),
    },
    '@/hooks/use-band': { useBand: () => palette },
    '@/lib/ios-setup-band-copy': load(path.join(root, 'src/lib/ios-setup-band-copy.ts')),
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/ui/controls': { Button: 'Button' },
    '@/constants/theme': { Fonts: { sansSemi: 'Geist-SemiBold' }, MaxContentWidth: 640, ScreenPadding: 24, Spacing: { two: 8, three: 12 } },
    '@/hooks/use-language': { useLanguage: () => language }, '@/hooks/use-theme': { useTheme: () => ({ background: '#fff' }) },
    '@/lib/capture': { getIosCaptureNativeModule: () => native, subscribeIosCaptureStatusRefresh: () => () => {} },
    '@/lib/alert-review-tray': { REVIEW_ALERT_CAP: 50, isIosNotificationReview: () => true, isCurrencyConflictReview: () => false },
    '@/lib/ios-capture-health': health, '@/lib/ios-capture-setup': setup, '@/lib/ios-notification-copy': copy,
    '@/lib/ios-message-onboarding': { dispatchIosMessageSetup: async event => events.push(event), loadIosMessageSetupProgress: async () => ({ futureAutomationConfirmed: false }),
      progressForSource: progressApi.progressForSource },
    '@/lib/store': { useStore: () => ({ state: { hydrated: true, onboarded: false }, getStateGeneration: () => generation,
      setCaptureOptOut: async value => events.push(`opt-out:${value}`) }) },
  }).default;
  let tree;
  const render = () => { cursor = 0; tree = component(); for (const effect of effects.splice(0)) effect(); };
  const flush = async () => { for (let i = 0; i < 5; i++) { await new Promise(r => setImmediate(r)); render(); } };
  render(); await flush();
  return { events, urls, routes, clipboard, shares, flush, tree: () => tree, palette,
    text: () => walk(tree).filter(n => n.type === 'Text').map(n => n.props.children).join(' '),
    button: label => walk(tree).find(n => n.type === 'Button' && n.props.label === label)?.props,
    async foreground(patch = {}) { status = { ...status, ...patch }; for (const fn of listeners) fn('active'); await flush(); },
    setStatus: patch => { status = { ...status, ...patch }; }, replaceLedger: () => { generation++; },
  };
}
test('iOS 26 cannot enable the notification path or call the native receiver', async () => {
  const s = await screen({ version: '26.6.2' });
  assert.match(s.text(), /require iOS 27/);
  assert.equal(s.button('Enable capture on this iPhone'), undefined);
  assert.deepEqual(s.events, []);
});
test('iOS 27 with an old binary asks for an update without changing capture', async () => {
  const s = await screen({ capability: false });
  assert.match(s.text(), /Update Wafra/);
  assert.equal(s.button('Enable capture on this iPhone'), undefined);
  assert.deepEqual(s.events, []);
});
test('enabling is explicit and no bank name or SMS proof is required or treated as notification proof', async () => {
  const s = await screen();
  assert.equal(s.events.some(e => typeof e === 'string' && e.startsWith('enabled:')), false);
  s.button('Enable capture on this iPhone').onPress(); await s.flush();
  assert.ok(s.events.indexOf('opt-out:false') < s.events.indexOf('enabled:true'));
  assert.match(s.text(), /No bank-name selection/);
  assert.equal(s.button('I saved the notification automation').disabled, true);
  s.button('Copy setup check text').onPress(); await s.flush();
  assert.deepEqual(s.clipboard, ['Wafra notification setup check']);
  assert.equal(s.events.some(e => e.type === 'future-automation-confirmed'), false);
});
test('a notification permission check permits confirmation but does not claim notification delivery', async () => {
  const s = await screen({ enabled: true, proof: Date.now() });
  assert.match(s.text(), /Waiting for the first notification/);
  assert.equal(s.button('I saved the notification automation').disabled, false);
  s.button('I saved the notification automation').onPress(); await s.flush();
  assert.ok(s.events.some(e => e.type === 'future-automation-confirmed'));
  assert.equal(s.routes[0].pathname, '/ios-setup');
  assert.equal(s.routes[0].params.fromOnboarding, '1');
});
test('revoked capture between render and confirmation cannot complete notification setup', async () => {
  const s = await screen({ enabled: true, proof: Date.now() });
  s.setStatus({ enabled: false });
  s.button('I saved the notification automation').onPress(); await s.flush();
  assert.equal(s.events.some(e => e.type === 'future-automation-confirmed'), false);
  assert.deepEqual(s.routes, []);
});
test('a received notification is described as a receipt, never a completed financial import', async () => {
  const s = await screen({ enabled: true, received: Date.now() });
  assert.match(s.text(), /queue receipt, not proof that a transaction was added/);
  assert.equal(s.button('I saved the notification automation').disabled, false);
});
test('the bundled path shares only the fixed local Shortcut and runs its no-input permission check', async () => {
  const s = await screen({ enabled: true, bundled: true });
  assert.equal(s.button('Copy setup check text'), undefined);
  assert.match(s.text(), /then tap Run permission check/);
  assert.ok(!s.text().includes('Copy the test text'));
  s.button('Add notification Shortcut').onPress(); await s.flush();
  assert.deepEqual(s.shares, ['file:///app/WafraLiveCaptureResources.bundle/Wafra%20Notifications%20v1.shortcut']);
  assert.deepEqual(s.clipboard, []);
  s.button('Run permission check').onPress(); await s.flush();
  const url = new URL(s.urls[0]);
  assert.equal(url.searchParams.get('name'), 'Wafra Notifications v1');
  assert.equal(url.searchParams.has('text'), false);
  assert.equal(url.searchParams.get('x-success'), 'wafra://ios-notification-setup?shortcutResult=success&fromOnboarding=1');
  assert.equal(s.events.some(e => e.type === 'future-automation-confirmed'), false);
  s.button('Build the Shortcut manually').onPress(); await s.flush();
  assert.ok(s.button('Copy setup check text'));
});

for (const language of ['en', 'ar']) for (const scheme of ['light', 'dark']) {
  test(`notification design E exposes separate shortcut, automation and receipt states (${language}, ${scheme})`, async () => {
    const s = await screen({ enabled: true, proof: Date.now(), language, scheme });
    const nodes = walk(s.tree());
    assert.equal(nodes.find(n => n.type === 'BandScaffold').props.band, 'flow');
    assert.equal(s.tree().props.testID, 'onboarding-setup-shell');
    assert.ok(nodes.some(n => n.props.testID === 'notification-shortcut-step'));
    assert.ok(nodes.some(n => n.props.testID === 'notification-automation-step'));
    assert.ok(nodes.some(n => n.props.testID === 'notification-delivery'));
    const words = load(path.join(root, 'src/lib/ios-notification-copy.ts')).iosNotificationCopy(language);
    assert.ok(s.text().includes(words.waitingNotification));
    assert.ok(s.text().includes(words.checked));
    assert.ok(!s.text().includes(words.received));
    assert.equal(s.button(words.confirm).disabled, false);
    assert.ok(nodes.filter(n => n.type === 'Button').every(n => n.props.palette === s.palette));
  });
}

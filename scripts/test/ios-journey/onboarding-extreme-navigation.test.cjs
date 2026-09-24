'use strict';
// Execute the real gate, its JSX controls, and the real resume/landing helpers.
// The hook scheduler substitutes React rendering; OS, store persistence and
// router are explicit boundaries. This is not device or Shortcut execution proof.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = process.env.WAFRA_REPO_ROOT || path.resolve(__dirname, '../../..');
const clone = value => JSON.parse(JSON.stringify(value));
const turn = () => new Promise(resolve => setImmediate(resolve));
const walk = node => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(walk) : [node, ...walk(node.props?.children)];
const text = node => Array.isArray(node) ? node.map(text).join(' ') : node && typeof node === 'object'
  ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : '';
// A resumed profile answers every question the journey asks, so a test that
// starts mid-flow finds each Continue enabled exactly as a returning user would.
const profile = (stage, focus = 'spending', tracking = 'bank-apps', intention = 'control', alerts = 'sms') =>
  ({ v: 1, stage, focus, tracking, intention, alerts, startedAt: 123 });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function gate(options = {}) {
  const language = options.language ?? 'en';
  const i18n = load(path.join(root, 'src/lib/i18n.ts'));
  const translate = { ...i18n, t: key => i18n.t(key, language), tf: (key, values) => i18n.tf(key, values, language) };
  const onboarding = load(path.join(root, 'src/lib/onboarding.ts'), {
    '@/lib/i18n': translate, '@/lib/ledger': { isIncome: () => false },
  });
  const theme = load(path.join(root, 'src/constants/theme.ts'), {
    '@/global.css': {}, 'react-native': { Platform: { select: values => values.ios ?? values.default } },
  });
  const events = [], routes = [], slots = [], pendingEffects = [];
  let clockNow = 1000, nextTimer = 1;
  const timers = new Map();
  const setTimer = (callback, delay = 0) => {
    const id = nextTimer++; timers.set(id, { callback, due: clockNow + Math.max(0, Number(delay)) }); return id;
  };
  const clearTimer = id => timers.delete(id);
  const advanceClock = milliseconds => {
    const until = clockNow + milliseconds;
    let fired = 0;
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.due <= until).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      assert.ok(fired++ < 1000, 'Timer scheduling must settle');
      timers.delete(next[0]); clockNow = next[1].due; next[1].callback();
    }
    clockNow = until;
  };
  class ClockDate extends Date { static now() { return 1_800_000_000_000 + clockNow; } }
  const input = { pathname: options.pathname ?? '/', params: options.params ?? {},
    hydrationFailed: options.hydrationFailed ?? false, storageFailure: options.storageFailure ?? null,
    pendingSetup: options.pendingSetup ?? false };
  let ledger = { hydrated: options.hydrated ?? true, onboarded: false, onboardingProfile: options.profile ?? null,
    userName: options.userName ?? 'there',
    onboardingPlan: null, captureOptOut: options.optOut ?? false, transactions: [], accounts: [], bills: [], cardDues: [],
    ...(options.ledger ?? {}) };
  let durable = clone(ledger), cursor = 0, tree, mounted = true;
  const services = { ...options.services };
  const record = (name, value) => events.push([name, value === undefined ? undefined : clone(value)]);
  const slot = create => { const index = cursor++; return slots[index] ?? (slots[index] = create()); };
  const react = {
    useMemo: compute => compute(),
    useCallback: callback => callback,
    useRef: value => slot(() => ({ current: value })),
    useState(initial) { const s = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [s.value, value => { if (mounted) s.value = typeof value === 'function' ? value(s.value) : value; }]; },
    useEffect(fn, deps) { const s = slot(() => ({}));
      if (!s.deps || deps.some((value, i) => !Object.is(value, s.deps[i]))) {
        s.deps = deps; pendingEffects.push(() => { s.cleanup?.(); s.cleanup = fn(); });
      }
    },
  };
  const jsx = (type, props = {}) => typeof type === 'function' ? type(props) : ({ type, props });
  const navigate = (kind, destination) => {
    routes.push([kind, clone(destination)]);
    const value = typeof destination === 'string' ? destination : destination.pathname;
    const parsed = new URL(value, 'https://wafra.invalid');
    input.pathname = parsed.pathname;
    input.params = typeof destination === 'string' ? Object.fromEntries(parsed.searchParams) : destination.params ?? {};
  };
  const router = { push: destination => navigate('push', destination), replace: destination => navigate('replace', destination),
    setParams: values => { input.params = { ...input.params, ...values }; }, canGoBack: () => true,
    back: () => navigate('back', '/') };
  const call = async (name, value, fallback) => {
    record(name, value);
    return services[name] ? services[name](value) : fallback;
  };
  const store = {
    get state() { return ledger; }, get hydrationFailed() { return input.hydrationFailed; },
    get storageFailure() { return input.storageFailure; }, storageRecoveryState: null,
    setOnboardingProfile(value) { ledger = { ...ledger, onboardingProfile: clone(value) }; record('profile', value); },
    setUserName(value) { ledger = { ...ledger, userName: value }; record('setUserName', value); },
    setOnboardingPlan(value) { ledger = { ...ledger, onboardingPlan: clone(value) }; },
    setOnboarded() { ledger = { ...ledger, onboarded: true }; record('onboarded'); },
    setDailySummary(value) { ledger = { ...ledger, dailySummary: value }; record('dailySummary', value); },
    async setCaptureOptOut(value) {
      await call('setCaptureOptOut', value);
      ledger = { ...ledger, captureOptOut: value }; durable = clone(ledger);
    },
    async setAndroidCaptureSources(value) {
      await call('setAndroidCaptureSources', value);
      ledger = { ...ledger, androidCaptureSources: clone(value) }; durable = clone(ledger);
    },
    async ensureDurable() { await call('ensureDurable'); durable = clone(ledger); },
    beginHistoryImport: () => call('beginHistoryImport'),
  };
  const animation = { duration: () => animation, delay: () => animation };
  const statementHandoff = load(path.join(root, 'src/lib/ios-statement-handoff.ts'), {
    'expo-crypto': { randomUUID: () => 'explicit-ios-statement-handoff' },
  });
  const dependencies = {
    '@/lib/ios-statement-handoff': statementHandoff,
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { Platform: { OS: options.platform ?? 'ios', Version: '26.6', select: values => values.ios ?? values.default }, I18nManager: { isRTL: language === 'ar' }, View: 'View', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable',
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, ScrollView: 'ScrollView', StyleSheet: { create: value => value, hairlineWidth: 1, absoluteFillObject: {} },
      Linking: { openSettings: () => call('openSettings') } },
    'react-native-reanimated': { __esModule: true, default: { View: 'Animated.View', ScrollView: 'Animated.ScrollView', createAnimatedComponent: component => component },
      FadeIn: animation, FadeInDown: animation, Easing: { out: easing => easing, inOut: easing => easing, cubic: value => value, sin: value => value, linear: value => value },
      useSharedValue: value => ({ value }), useAnimatedStyle: build => build(), withTiming: value => value,
      withDelay: (_delay, value) => value, withSpring: value => value, withRepeat: value => value, interpolate: () => 0, interpolateColor: () => 'transparent' },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'expo-image': { Image: 'Image' }, 'expo-localization': { getLocales: () => [{ regionCode: 'AE' }] },
    '@/lib/verified-logo-identities': { verifiedLogoUrl: () => null },
    '@/lib/onboarding-bank-examples': load(path.join(root, 'src/lib/onboarding-bank-examples.ts'), {
      '@/lib/markets': { MARKETS: [{ id: 'AE', currency: { code: 'AED' }, banks: [
        { name: 'Emirates NBD', domain: 'emiratesnbd.com', color: '#2B4C9B' }, { name: 'FAB', domain: 'bankfab.com', color: '#00A3E0' },
        { name: 'ADCB', domain: 'adcb.com', color: '#E4032E' }] }] } }),
    '@/lib/onboarding-alert-examples': load(path.join(root, 'src/lib/onboarding-alert-examples.ts'), {
      '@/components/ui/icon.types': {},
    }),
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-status-bar': { StatusBar: 'StatusBar' },
    'expo-router': { useRouter: () => router, usePathname: () => input.pathname, useGlobalSearchParams: () => input.params },
    '@/hooks/use-language': { useLanguage: () => language },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => false },
    '@/hooks/use-reduced-motion': { useMotionPreference: () => ({ ready: options.motionReady ?? true, reducedMotion: options.reducedMotion ?? true }) },
    '@/components/storage-recovery': { StorageRecovery: 'StorageRecovery' },
    '@/components/themed-text': { ThemedText: 'Text' }, '@/components/ui/bottom-sheet': { BottomSheet: 'BottomSheet' },
    // The welcome country control reads the app palette for its sheet rows; the
    // overlay itself stays night-themed, so nothing here depends on the values.
    '@/hooks/use-theme': { useTheme: () => ({ primary: '#57B894', text: '#F3F1EC' }) },
    '@/components/ui/confirm-sheet': { ConfirmSheet: 'ConfirmSheet' }, '@/components/ui/controls': { Button: 'Button' },
    '@/components/ui/icon': { Icon: 'Icon' },
    '@/components/wafra-logo': { WafraMark: 'WafraMark' }, '@/constants/theme': theme,
    '@/lib/auto-import': { isSmsScanningAvailable: () => true, requestSmsPermission: () => call('requestSmsPermission', undefined, true), hasSmsPermission: () => call('hasSmsPermission', undefined, false), hasBankNotificationSystemAccess: () => options.notificationAccess ?? false, openBankNotificationAccessSettings: () => call('openBankNotificationAccessSettings', undefined, true) },
    '@/lib/haptics': { committed: () => record('committed'), tapped() {} },
    '@/lib/notifications': { cancelDailySummary: () => call('cancelDailySummary'), syncDailySummary: () => call('syncDailySummary'),
      requestVisibleNotificationPermission: () => call('requestVisibleNotificationPermission', undefined, false) },
    '@/lib/growth-funnel': { GROWTH_PLACEMENTS: { onboarding: 'test' }, trackGrowthEvent() {} },
    '@/lib/i18n': translate, '@/lib/onboarding': onboarding,
    '@/lib/ios-message-onboarding': {
      async loadIosMessageSetupProgress() { return call('loadSetup', undefined, { returnToOnboarding: input.pendingSetup }); },
      async dispatchIosMessageSetup(event) { await call('dispatchSetup', event);
        if (event.type === 'onboarding-return-cleared') input.pendingSetup = false; },
    },
    '@/lib/background-relay': { disableRelayBackgroundSync: () => call('disableRelayBackgroundSync') },
    '@/lib/relay': { getRelayConfigStrict: () => call('getRelayConfigStrict', undefined, null), unpairDevice: value => call('unpairDevice', value) },
    '@/lib/shortcut-cleanup': { openShortcutsApp: () => call('openShortcutsApp') },
    '@/lib/store': { useStore: () => store },
    '../../modules/notification-reader': { __esModule: true, default: {
      setCaptureEnabled: (_enabled, _expiresAt) => call('notificationSetCaptureEnabled', undefined, true),
    } },
    '@/lib/trusted-bank-notification-packages': { bankNotificationAdmissionExpiresAt: () => 1_900_000_000_000 },
  };
  // The choosers are real source: the journey below picks options through their radio semantics.
  dependencies['@/components/onboarding/alive-scenes'] = load(path.join(root, 'src/components/onboarding/alive-scenes.tsx'), dependencies);
  // Same for the welcome country control: its sheet chrome is already stubbed
  // above, so the row renders from real source like every other choice here.
  dependencies['@/components/onboarding/country-confirm'] =
    load(path.join(root, 'src/components/onboarding/country-confirm.tsx'), dependencies);
  const component = load(options.sourcePath ?? process.env.WAFRA_ONBOARDING_SOURCE ?? path.join(root, 'src/components/onboarding-gate.tsx'), dependencies, {
    process: { env: { EXPO_PUBLIC_WAFRA_E2E_DEMO: '1' } },
    setTimeout: setTimer, clearTimeout: clearTimer, Date: ClockDate,
  }).OnboardingGate;
  const render = () => {
    cursor = 0; tree = component({ children: jsx('Navigator') });
    for (const effect of pendingEffects.splice(0)) effect();
    return tree;
  };
  const flush = async (advanceMilliseconds = options.manualClock ? 0 : 400) => {
    advanceClock(advanceMilliseconds);
    for (let n = 0; n < 6; n++) { await turn(); render(); }
  };
  // Respect hidden mounted children and sheet visibility, as a user would.
  const visible = (node, out = []) => {
    if (Array.isArray(node)) node.forEach(child => visible(child, out));
    else if (node && typeof node === 'object' && !node.props?.accessibilityElementsHidden &&
      !(['BottomSheet', 'ConfirmSheet'].includes(node.type) && !node.props.visible)) {
      out.push(node); visible(node.props?.children, out);
    }
    return out;
  };
  const control = key => {
    const label = translate.t(key);
    const matches = visible(tree).filter(node => typeof node.props?.onPress === 'function' &&
      (node.props.label === label || node.props.accessibilityLabel === label || text(node).trim() === label));
    assert.equal(matches.length, 1, `${key}: expected one control, found ${matches.length}; text=${text(tree)}`);
    return matches[0].props;
  };
  render(); await flush();
  return { events, routes, services, input, render, flush, control, t: translate.t, statementHandoff,
    advance: milliseconds => flush(milliseconds),
    get clock() { return { now: clockNow, pending: timers.size }; }, get pendingTimers() { return timers.size; },
    get state() { return ledger; }, get durable() { return durable; }, get tree() { return tree; },
    nodes: () => visible(tree), text: () => visible(tree).filter(node => node.type === 'Text').map(text).join(' '),
    async press(key) { const button = control(key); assert.notEqual(button.disabled, true, `${key} disabled`);
      button.onPress(); await flush(); },
    async choose(index) { const options = visible(tree).filter(node => node.props?.accessibilityRole === 'radio');
      assert.ok(options[index], `Choice ${index} exists`); options[index].props.onPress(); await flush(); },
    async changeText(testID, value) { const input = visible(tree).find(node => node.props?.testID === testID);
      assert.ok(input?.props?.onChangeText, `${testID}: editable input exists`); input.props.onChangeText(value); await flush(); },
    async route(pathname, params = {}) { input.pathname = pathname; input.params = params; render(); await flush(); },
    async update(value) { ledger = { ...ledger, ...value }; render(); await flush(); },
    async setFailure(value) { input.storageFailure = value; render(); await flush(); },
    unmount() { mounted = false; slots.forEach(s => s.cleanup?.()); },
  };
}

module.exports = { gate, profile };

if (require.main === module) {
const stageHeading = { welcome: 'onboardHeadline', focus: 'onboardFocusTitle', tracking: 'onboardTrackingTitle',
  alerts: 'onboardAlertsTitle', intention: 'onboardIntentionTitle', preview: 'onboardPersonalizedTitle',
  capture: 'onboardCaptureTitleIos' };
const normalizeVisible = value => String(value).replace(/\s+/g, ' ').trim();
const at = (h, stage) => assert.ok(normalizeVisible(h.text()).includes(normalizeVisible(h.t(stageHeading[stage]))), `Expected ${stage}; ${h.text()}`);
const atName = h => assert.ok(normalizeVisible(h.text()).includes(normalizeVisible(h.t('onboardNameTitle'))), `Expected name personalization; ${h.text()}`);
const calls = (h, name) => h.events.filter(event => event[0] === name);

for (const language of ['en', 'ar']) {
  test(`all required iOS stages support Back and Next without losing selections: ${language}`, async () => {
    const h = await gate({ language }); at(h, 'welcome');
    await h.press('onboardChooseStart'); atName(h); await h.press('onboardNameSkip'); at(h, 'focus');
    assert.equal(h.control('continueWord').disabled, true);
    await h.choose(1); await h.press('continueWord'); at(h, 'tracking');
    assert.equal(h.control('continueWord').disabled, true);
    await h.choose(2); await h.press('continueWord'); at(h, 'alerts');
    assert.equal(h.control('continueWord').disabled, true);
    await h.choose(1); await h.press('continueWord'); at(h, 'intention');
    assert.equal(h.control('continueWord').disabled, true);
    await h.choose(3); await h.press('continueWord'); at(h, 'preview');
    await h.press('onboardConnectMyMoney'); at(h, 'capture');
    for (const stage of ['preview', 'intention', 'alerts', 'tracking', 'focus']) { await h.press('onboardBack'); at(h, stage); }
    await h.press('onboardBack'); atName(h);
    await h.press('onboardNameSkip'); await h.advance(400); assert.equal(h.control('continueWord').disabled, false);
    await h.press('continueWord'); assert.equal(h.control('continueWord').disabled, false);
    await h.press('continueWord'); assert.equal(h.control('continueWord').disabled, false);
    await h.press('continueWord'); assert.equal(h.control('continueWord').disabled, false);
    await h.press('continueWord'); await h.press('onboardConnectMyMoney'); at(h, 'capture');
    assert.equal(h.state.onboardingProfile.focus, 'bills'); assert.equal(h.state.onboardingProfile.tracking, 'finance-app');
    assert.equal(h.state.onboardingProfile.intention, 'build-buffer');
    assert.equal(h.state.onboardingProfile.alerts, 'notifications');
    assert.equal(h.state.onboarded, false); assert.deepEqual(h.routes, []);
    assert.deepEqual(h.state.transactions, []); assert.equal(calls(h, 'setCaptureOptOut').length, 0);
  });
}

for (const stage of Object.keys(stageHeading)) {
  test(`cold remount resumes saved ${stage} and does not read bank messages`, async () => {
    const h = await gate({ profile: profile(stage) }); at(h, stage);
    assert.equal(h.state.onboardingProfile.startedAt, 123);
    assert.deepEqual(h.routes, []); assert.equal(calls(h, 'beginHistoryImport').length, 0);
    assert.equal(calls(h, 'setCaptureOptOut').length, 0);
  });
}

test('legacy saved privacy stage resumes at the integrated preview', async () => {
  const h = await gate({ profile: profile('privacy') });
  at(h, 'preview');
  assert.equal(h.state.onboardingProfile.startedAt, 123);
  assert.deepEqual(h.routes, []);
  assert.equal(calls(h, 'beginHistoryImport').length, 0);
});

test('manual selection survives a cold restart without forcing the questionnaire again', async () => {
  const h = await gate({ profile: profile('capture') });
  await h.press('onboardManualChoiceIos');
  assert.equal(h.state.onboardingProfile.stage, 'complete');
  // Allow the store's normal debounced persistence to have saved this profile.
  const saved = clone(h.state); h.unmount();
  const restarted = await gate({ ledger: saved });
  assert.ok(restarted.text().includes(restarted.t('onboardCompleteManualTitle')) ||
    restarted.text().includes(restarted.t('onboardCaptureTitleIos')),
  'A saved manual choice must resume completion or capture choices, not restart Welcome');
  assert.equal(restarted.state.captureOptOut, true); assert.equal(restarted.state.onboarded, false);
});

test('welcome animates in without Reduce Motion and still exposes the market scene and start control', async () => {
  const h = await gate({ reducedMotion: false });
  at(h, 'welcome');
  assert.ok(walk(h.tree).some(node => node.props?.testID === 'onboarding-market-money-scene'));
  await h.press('onboardChooseStart'); atName(h); await h.press('onboardNameSkip'); at(h, 'focus');
  await h.choose(1); await h.press('continueWord'); at(h, 'tracking');
  await h.choose(0); await h.press('continueWord'); at(h, 'alerts');
  await h.choose(0); await h.press('continueWord'); at(h, 'intention');
  await h.choose(0); await h.press('continueWord'); at(h, 'preview');
  assert.deepEqual(h.routes, []); assert.equal(h.state.onboarded, false);
});

test('setup Back returns to capture and preserves the selected first landing view', async () => {
  const h = await gate({ profile: profile('capture', 'bills') });
  await h.press('onboardAutomaticChoiceIos'); assert.equal(h.input.pathname, '/ios-setup');
  h.input.pendingSetup = true; await h.route('/ios-setup', { fromOnboarding: '1' });
  h.input.pendingSetup = false; await h.route('/'); at(h, 'capture');
  assert.equal(h.state.onboardingProfile.focus, 'bills');
  // Since the personalized reveal, capture returns straight to the preview; privacy is folded into capture.
  await h.press('onboardBack'); at(h, 'preview');
});

for (const pathname of ['/ios-setup', '/import-sms', '/ios-paging-beta', '/ios-notification-setup', '/ios-apple-pay-setup']) {
  test(`first-run ${pathname} owns its UI while onboarding setup is pending`, async () => {
    const h = await gate({ pathname, profile: profile('capture'), pendingSetup: true });
    assert.deepEqual(h.routes, [], 'The setup child route must not be redirected back to its parent');
    assert.ok(h.nodes().some(node => node.type === 'Navigator'), 'The route must be visible instead of the onboarding overlay');
    assert.ok(!h.text().includes(h.t('onboardHeadline')));
  });
}

test('navigating from setup to paged history does not bounce to setup or reset onboarding', async () => {
  const h = await gate({ pathname: '/ios-setup', profile: profile('capture'), pendingSetup: true });
  await h.route('/ios-paging-beta', { origin: 'onboarding' });
  assert.deepEqual(h.routes, [], 'Opening the paged child route must not issue router.replace to setup');
  assert.equal(h.input.pathname, '/ios-paging-beta');
  assert.ok(h.nodes().some(node => node.type === 'Navigator'));
});

test('history recovery can open statements through an explicit live handoff without completing onboarding', async () => {
  const h = await gate({ pathname: '/ios-paging-beta', profile: profile('capture'), pendingSetup: true });
  const token = h.statementHandoff.beginIosStatementHandoff();
  await h.route('/statement-import', { fromOnboarding: '1', statementSession: token });
  assert.ok(h.nodes().some(node => node.type === 'Navigator'));
  assert.deepEqual(h.routes, []);
  assert.equal(h.state.onboarded, false);
  await h.route('/ios-paging-beta');
  assert.equal(h.statementHandoff.matchesIosStatementHandoff(token), false);
  const cold = await gate({ pathname: '/statement-import', params: { fromOnboarding: '1', statementSession: token } });
  assert.ok(!cold.nodes().some(node => node.type === 'Navigator'));
});

test('Android deep links cannot bypass onboarding via iOS setup routes', async () => {
  for (const pathname of ['/ios-setup', '/import-sms', '/ios-paging-beta', '/ios-notification-setup', '/ios-apple-pay-setup']) {
    const h = await gate({ platform: 'android', pathname }); at(h, 'welcome');
    assert.ok(!h.nodes().some(node => node.type === 'Navigator'));
    assert.equal(calls(h, 'loadSetup').length, 0);
  }
});

test('a delayed root restore cannot redirect over a newly opened paged-history route', async () => {
  const read = deferred();
  const h = await gate({ profile: profile('capture'), services: { loadSetup: () => read.promise } });
  await h.route('/ios-paging-beta', { origin: 'onboarding' });
  read.resolve({ returnToOnboarding: true }); await h.flush();
  assert.deepEqual(h.routes, [], 'Only the active route may own the late callback');
  assert.equal(h.input.pathname, '/ios-paging-beta');
});

test('setup progress read failure exposes Retry and does not advance or capture', async () => {
  const h = await gate({ profile: profile('capture'), services: { loadSetup: async () => { throw new Error('synthetic read failure'); } } });
  assert.ok(h.text().includes(h.t('onboardResumeError'))); assert.deepEqual(h.routes, []);
  assert.equal(calls(h, 'setCaptureOptOut').length, 0);
  h.services.loadSetup = async () => ({ returnToOnboarding: false });
  await h.press('storageRecoveryRetry'); at(h, 'capture');
});

test('failed ledger hydration stays in recovery even on the paged setup route', async () => {
  const h = await gate({ pathname: '/ios-paging-beta', hydrationFailed: true });
  assert.ok(h.nodes().some(node => node.type === 'StorageRecovery'));
  assert.equal(calls(h, 'loadSetup').length, 0); assert.deepEqual(h.routes, []);
});

test('rapid alternating capture/manual taps cannot race the durable opt-in', async () => {
  const write = deferred();
  const h = await gate({ profile: profile('capture'), optOut: true, services: { setCaptureOptOut: () => write.promise } });
  const automatic = h.control('onboardAutomaticChoiceIos'), manual = h.control('onboardManualChoiceIos');
  automatic.onPress(); manual.onPress(); automatic.onPress(); manual.onPress(); await h.flush();
  assert.deepEqual(calls(h, 'setCaptureOptOut').map(v => v[1]), [false]);
  assert.equal(h.control('onboardBack').disabled, true); assert.deepEqual(h.routes, []);
  write.resolve(); await h.flush();
  assert.deepEqual(h.routes, [['push', '/ios-setup?fromOnboarding=1']]);
  assert.equal(h.state.captureOptOut, false); assert.equal(h.state.onboarded, false);
});

test('rapid alternating manual/capture taps cannot reverse explicit opt-out', async () => {
  const write = deferred();
  const h = await gate({ profile: profile('capture'), services: { setCaptureOptOut: () => write.promise } });
  const automatic = h.control('onboardAutomaticChoiceIos'), manual = h.control('onboardManualChoiceIos');
  manual.onPress(); automatic.onPress(); manual.onPress(); automatic.onPress(); await h.flush();
  assert.deepEqual(calls(h, 'setCaptureOptOut').map(v => v[1]), [true]);
  assert.equal(h.control('onboardBack').disabled, true);
  write.resolve(); await h.flush();
  assert.deepEqual(h.routes, []); assert.equal(h.state.captureOptOut, true);
  assert.ok(h.text().includes(h.t('onboardCompleteManualTitle')));
  await h.press('onboardBack'); at(h, 'capture'); assert.equal(h.state.captureOptOut, true);
  delete h.services.setCaptureOptOut;
  await h.press('onboardAutomaticChoiceIos'); assert.equal(h.state.captureOptOut, false);
});

test('capture preference failure offers retry/manual and does not claim successful setup', async () => {
  const h = await gate({ profile: profile('capture'), services: { setCaptureOptOut: async () => { throw new Error('synthetic write failure'); } } });
  await h.press('onboardAutomaticChoiceIos');
  assert.ok(h.text().includes(h.t('onboardCompleteNeedsAttentionTitle'))); assert.deepEqual(h.routes, []);
  assert.equal(h.state.onboarded, false);
  await h.press('onboardRetrySetup'); at(h, 'capture');
  delete h.services.setCaptureOptOut;
  await h.press('onboardManualChoiceIos'); assert.equal(h.state.captureOptOut, true);
});

test('manual completion cannot leave on a failed profile/ledger save; Retry preserves Add first entry intent', async () => {
  const h = await gate({ profile: profile('capture'), services: { ensureDurable: async () => { throw new Error('synthetic profile save failure'); } } });
  await h.press('onboardManualChoiceIos');
  const finish = h.control('onboardAddFirstEntry'); finish.onPress(); finish.onPress(); await h.flush();
  // iOS asks about notifications once before the durable completion write.
  await h.press('onboardNotificationsNotNow');
  assert.equal(calls(h, 'ensureDurable').length, 1); assert.deepEqual(h.routes, []);
  assert.ok(h.text().includes(h.t('onboardFinishSaveFailedTitle')));
  assert.equal(h.control('onboardBack').disabled, true);
  assert.equal(calls(h, 'committed').length, 0);
  delete h.services.ensureDurable;
  await h.press('storageRecoveryRetry');
  assert.deepEqual(h.routes, [['push', '/add-transaction']]);
  assert.equal(h.durable.onboarded, true); assert.equal(h.durable.captureOptOut, true);
  assert.equal(calls(h, 'setCaptureOptOut').length, 1);
});

for (const [focus, label, destination] of [['spending', 'onboardOpenSpending', '/flow'], ['bills', 'onboardOpenBills', '/bills'], ['cashflow', 'onboardOpenHome', '/']]) {
  test(`manual finish opens the selected ${focus} view only after durable completion`, async () => {
    const save = deferred(); const h = await gate({ profile: profile('capture', focus), services: { ensureDurable: () => save.promise } });
    await h.press('onboardManualChoiceIos'); h.control(label).onPress(); await h.flush();
    await h.press('onboardNotificationsNotNow');
    assert.deepEqual(h.routes, []); assert.equal(calls(h, 'committed').length, 0);
    save.resolve(); await h.flush();
    assert.deepEqual(h.routes, [['replace', destination]]); assert.equal(h.durable.onboarded, true);
  });
}

test('privacy Help dismisses back to the same capture choices without writing consent', async () => {
  const h = await gate({ profile: profile('capture') });
  await h.press('onboardCaptureLearnMoreAction');
  const sheet = walk(h.tree).find(node => node.type === 'BottomSheet'); assert.equal(sheet.props.visible, true);
  sheet.props.onClose(); await h.flush(); at(h, 'capture');
  assert.equal(walk(h.tree).find(node => node.type === 'BottomSheet').props.visible, false);
  assert.equal(calls(h, 'setCaptureOptOut').length, 0); assert.deepEqual(h.routes, []);
});

test('repeated taps on synchronous Next controls cannot skip unanswered questions', async () => {
  const h = await gate();
  const start = h.control('onboardChooseStart');
  for (let n = 0; n < 20; n++) start.onPress();
  await h.flush(); atName(h);
  assert.equal(h.control('onboardNameContinue').disabled, true);
  await h.press('onboardNameSkip'); at(h, 'focus');
  assert.equal(h.control('continueWord').disabled, true);
  await h.choose(0);
  const next = h.control('continueWord');
  for (let n = 0; n < 20; n++) next.onPress();
  await h.flush(); at(h, 'tracking');
  assert.equal(h.control('continueWord').disabled, true);
  assert.deepEqual(h.routes, []); assert.equal(calls(h, 'setCaptureOptOut').length, 0);
});

test('six full Back/Next cycles preserve the latest answers without starting capture', async () => {
  const h = await gate();
  for (let cycle = 0; cycle < 6; cycle++) {
    if (cycle === 0) await h.press('onboardChooseStart');
    atName(h); await h.press('onboardNameSkip');
    await h.choose(cycle % 4); await h.press('continueWord');
    await h.choose((cycle + 1) % 4); await h.press('continueWord');
    await h.choose((cycle + 2) % 4); await h.press('continueWord');
    await h.choose((cycle + 3) % 4); await h.press('continueWord');
    await h.press('onboardConnectMyMoney'); at(h, 'capture');
    assert.equal(h.state.onboardingProfile.focus, ['spending', 'bills', 'cashflow', 'overview'][cycle % 4]);
    assert.equal(h.state.onboardingProfile.tracking, ['bank-apps', 'spreadsheet', 'finance-app', 'none'][(cycle + 1) % 4]);
    assert.equal(h.state.onboardingProfile.alerts, ['sms', 'notifications', 'neither', 'unsure'][(cycle + 2) % 4]);
    assert.equal(h.state.onboardingProfile.intention, ['control', 'spend-intentionally', 'stay-ahead', 'build-buffer'][(cycle + 3) % 4]);
    for (const stage of ['preview', 'intention', 'alerts', 'tracking', 'focus']) {
      await h.press('onboardBack'); at(h, stage);
      assert.equal(h.state.onboardingProfile.stage, stage);
    }
    await h.press('onboardBack'); atName(h);
    assert.equal(h.state.onboardingProfile.stage, 'welcome');
  }
  assert.deepEqual(h.routes, []); assert.equal(h.state.onboarded, false);
  assert.equal(calls(h, 'setCaptureOptOut').length, 0); assert.equal(calls(h, 'beginHistoryImport').length, 0);
});

test('name personalization stays inside Welcome, persists Unicode safely, and personalizes the next screens', async () => {
  const h = await gate({ language: 'en' });
  await h.press('onboardChooseStart'); atName(h);
  assert.ok(h.nodes().some(node => node.props?.testID === 'onboarding-name-input'));
  assert.ok(!h.text().includes('Step 1 of 4'), 'name prompt is not a fifth progress step');
  await h.changeText('onboarding-name-input', '  ناصر   Khanjar  ');
  assert.ok(h.text().includes('ناصر Khanjar'));
  await h.press('onboardNameContinue');
  assert.equal(h.state.userName, 'ناصر Khanjar');
  assert.equal(h.durable.userName, 'ناصر Khanjar');
  assert.ok(h.text().includes('ناصر Khanjar'));
  assert.equal(calls(h, 'setUserName').length, 1);
  assert.deepEqual(h.state.transactions, []);
});

test('a completion callback reaches completion without replaying the saved setup redirect', async () => {
  const h = await gate({ profile: profile('capture'), pendingSetup: true, params: { onboarding: 'complete' } });
  assert.ok(h.text().includes(h.t('onboardCompleteAutomaticTitle')));
  assert.deepEqual(h.routes, []); assert.equal(h.state.onboarded, false);
  await h.press('onboardBack'); at(h, 'capture');
  assert.equal(h.input.params.onboarding, undefined);
  assert.equal(h.state.onboardingProfile.stage, 'capture');
});

test('failed-save Retry preserves the explicitly selected Pro destination after import', async () => {
  const h = await gate({ profile: profile('capture'), params: { onboarding: 'complete' },
    ledger: { transactions: [{ id: 'synthetic-imported-entry' }] },
    services: { ensureDurable: async () => { throw new Error('synthetic save failure'); } } });
  await h.press('onboardProPreviewAction'); await h.press('onboardNotificationsNotNow');
  assert.deepEqual(h.routes, []); assert.ok(h.text().includes(h.t('onboardFinishSaveFailedTitle')));
  delete h.services.ensureDurable;
  await h.press('storageRecoveryRetry');
  assert.deepEqual(h.routes, [['replace', '/pro']], 'Retry must complete the same user-requested destination');
});

test('ordinary profile save failure cannot be turned into a successful final completion', async () => {
  const h = await gate({ profile: profile('focus'), services: {
    setCaptureOptOut: async () => { throw new Error('synthetic encrypted persistence failure'); },
  } });
  await h.choose(0); await h.press('continueWord'); await h.choose(0); await h.press('continueWord');
  await h.choose(0); await h.press('continueWord');
  await h.choose(0);
  await h.setFailure({ operation: 'write', message: 'synthetic profile persistence failure' });
  await h.press('continueWord'); await h.press('onboardConnectMyMoney');
  await h.press('onboardManualChoiceIos');
  assert.equal(h.state.onboarded, false); assert.deepEqual(h.routes, []);
  assert.equal(calls(h, 'committed').length, 0);
  assert.ok(h.text().includes(h.t('onboardCompleteNeedsAttentionTitle')));
});
}

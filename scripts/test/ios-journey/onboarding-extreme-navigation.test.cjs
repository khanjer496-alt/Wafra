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
  const events = [], routes = [], pendingEffects = [];
  // Hook slots per component type and occurrence: the gate is 'root'; each
  // step component keeps its own, so switching steps never mixes their state.
  const scopes = new Map();
  let scope = { key: 'root', cursor: 0 }, occurrences = new Map();
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
    budgets: [], pro: false, founderPro: false, trialStartTs: 1_800_000_000_000, ledgerMoney: null, dailySummary: false,
    ...(options.ledger ?? {}) };
  let durable = clone(ledger), tree, mounted = true;
  const services = { ...options.services };
  const record = (name, value) => events.push([name, value === undefined ? undefined : clone(value)]);
  const slot = create => {
    const list = scopes.get(scope.key) ?? scopes.set(scope.key, []).get(scope.key);
    const index = scope.cursor++;
    return list[index] ?? (list[index] = create());
  };
  const react = {
    useMemo: compute => compute(), useContext: () => undefined,
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
  const jsx = (type, props = {}) => {
    if (typeof type !== 'function') return { type, props };
    const name = type.name || 'anonymous';
    const n = occurrences.get(name) ?? 0;
    occurrences.set(name, n + 1);
    const parent = scope;
    scope = { key: `${name}#${n}`, cursor: 0 };
    try { return type(props); } finally { scope = parent; }
  };
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
    setGoals(value) { ledger = { ...ledger, wafraGoals: clone(value) }; record('setGoals', value); },
    upsertBudget(value) { ledger = { ...ledger, budgets: [...ledger.budgets.filter(b => b.category !== value.category), clone(value)] }; record('upsertBudget', value); },
    deleteBudget(category) { ledger = { ...ledger, budgets: ledger.budgets.filter(b => b.category !== category) }; record('deleteBudget', category); },
    setLedgerMoney(currency) { ledger = { ...ledger, ledgerMoney: { schemaVersion: 2, currency, exponent: 2 } }; record('setLedgerMoney', currency); return true; },
    setCountry(value) { ledger = { ...ledger, country: value }; record('setCountry', value); return true; },
    restoreBackup: () => false,
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
      Switch: 'Switch', ActivityIndicator: 'ActivityIndicator', PanResponder: { create: () => ({ panHandlers: {} }) },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, ScrollView: 'ScrollView', StyleSheet: { create: value => value, hairlineWidth: 1, absoluteFillObject: {} },
      Linking: { openSettings: () => call('openSettings') } },
    'react-native-reanimated': { __esModule: true, default: { View: 'Animated.View', ScrollView: 'Animated.ScrollView', createAnimatedComponent: component => component },
      FadeIn: animation, FadeInDown: animation, ZoomIn: animation, Easing: { out: easing => easing, inOut: easing => easing, cubic: value => value, sin: value => value, linear: value => value, bezier: () => value => value },
      useSharedValue: value => ({ value }), useAnimatedStyle: build => build(), useAnimatedProps: build => build(), withTiming: value => value,
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
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'react-native-svg': { __esModule: true, default: 'Svg', Path: 'Path', Circle: 'Circle' },
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
  // The full-country picker renders from real source too; its search field
  // is a native boundary like every other control here.
  dependencies['@/lib/country-names'] = load(path.join(root, 'src/lib/country-names.ts'), {});
  dependencies['@/lib/country'] = load(path.join(root, 'src/lib/country.ts'), dependencies);
  dependencies['@/components/ui/text-field'] = { TextField: 'TextField' };
  dependencies['@/components/country-picker-sheet'] =
    load(path.join(root, 'src/components/country-picker-sheet.tsx'), dependencies);
  dependencies['@/components/onboarding/country-confirm'] =
    load(path.join(root, 'src/components/onboarding/country-confirm.tsx'), dependencies);
  // The iPhone statement step's decorative scene renders from real source too.
  dependencies['./alive-scenes'] = dependencies['@/components/onboarding/alive-scenes'];
  dependencies['@/components/onboarding/statement-scene'] =
    load(path.join(root, 'src/components/onboarding/statement-scene.tsx'), dependencies);
  dependencies['@/components/onboarding/setup-intro-step'] =
    load(path.join(root, 'src/components/onboarding/setup-intro-step.tsx'), dependencies);
  // Redesign additions: the Welcome restore picker and the native capture
  // status are boundaries (neither is touched by these journeys); the
  // checklist, ready summary, SMS explainer and their copy run from source.
  dependencies['expo-document-picker'] = { getDocumentAsync: () => call('pickBackup', undefined, { canceled: true, assets: [] }) };
  dependencies['@/lib/share-text'] = { readBackupPickerCopy: () => call('readBackup', undefined, '') };
  dependencies['@/lib/capture'] = { getIosCaptureNativeModule: () => null };
  // Only reached with a native module, which these journeys never have.
  dependencies['@/lib/ios-capture-setup'] = { resolveIosSetupReadiness: () => 'not-added' };
  dependencies['@/lib/subscriptions'] = { detectSubscriptions: () => [] };
  dependencies['@/lib/ledger'] = { liveAccountIds: () => new Set(), internalTransferIdsForState: () => new Set(),
    isSpending: transaction => transaction.type === 'expense' };
  dependencies['@/lib/splits'] = load(path.join(root, 'src/lib/splits.ts'), {});
  dependencies['@/lib/onboarding-ready'] = load(path.join(root, 'src/lib/onboarding-ready.ts'), dependencies);
  dependencies['@/lib/ios-capture-checklist'] = load(path.join(root, 'src/lib/ios-capture-checklist.ts'), {});
  dependencies['@/lib/ios-shortcut-setup-copy'] = load(path.join(root, 'src/lib/ios-shortcut-setup-copy.ts'), {});
  dependencies['@/lib/biometric-kind'] = load(path.join(root, 'src/lib/biometric-kind.ts'), {});
  dependencies['@/lib/settings-copy'] = load(path.join(root, 'src/lib/settings-copy.ts'), dependencies);
  dependencies['@/lib/onboarding-copy'] = load(path.join(root, 'src/lib/onboarding-copy.ts'), dependencies);
  dependencies['@/components/ui/grow-bar'] = { GrowBar: 'GrowBar' };
  // Design language E: the pure journey rules, copy, palettes and every step
  // component run from source. Drawn-only pieces (the pattern, the dial, logo
  // tiles, the limit bar) and native/billing seams are named boundaries.
  const lib = (name, deps = {}) => load(path.join(root, `src/lib/${name}.ts`), deps);
  dependencies['@/lib/types'] = lib('types');
  dependencies['@/lib/home-widget-preferences'] = lib('home-widget-preferences');
  dependencies['@/lib/transaction-source'] = lib('transaction-source');
  dependencies['@/lib/onboarding-e'] = lib('onboarding-e', dependencies);
  dependencies['@/lib/onboarding-e-copy'] = lib('onboarding-e-copy', dependencies);
  dependencies['@/lib/band-copy'] = lib('band-copy');
  dependencies['@/lib/pattern'] = lib('pattern');
  dependencies['@/lib/period'] = { currentMonthPeriod: () => ({ mode: 'month', key: '2026-09' }), inPeriod: () => true };
  dependencies['@/lib/purchases'] = { trialDaysLeft: () => options.trialDays ?? 3, billingStore: () => 'appStore' };
  dependencies['@/lib/public-links'] = { configuredPublicUrl: () => null };
  dependencies['@/lib/home-widgets'] = {
    loadHomeWidgetPreferences: async () => ({ order: ['due', 'assistant', 'insight', 'activity', 'upcoming'], hidden: [] }),
    saveHomeWidgetPreferences: async value => record('saveHomeWidgets', value),
  };
  dependencies['@/lib/categories'] = { categoryLabel: category => category, getCategory: () => ({ icon: 'receipt' }) };
  dependencies['@/lib/ledger-money'] = { formatMoneyText: minor => String(minor),
    ledgerMoneySpec: currency => ({ schemaVersion: 2, currency, exponent: 2 }), typicalMinorAmount: (_spec, major) => major * 100 };
  dependencies['@/hooks/use-band'] = { useBand: id => theme.bandPalette(id, options.scheme ?? 'light'), useBandScheme: () => options.scheme ?? 'light' };
  dependencies['@/components/ui/pattern-mosaic'] = { PatternMosaic: 'PatternMosaic' };
  dependencies['@/components/ui/band/dial-limit'] = { DialLimit: 'DialLimit' };
  dependencies['@/components/ui/band/status-bar'] = { StatusBar: 'LimitBar' };
  dependencies['@/components/ui/merchant-avatar'] = { MerchantAvatar: 'MerchantAvatar' };
  dependencies['@/components/ledger-currency-sheet'] = { LedgerCurrencySheet: 'LedgerCurrencySheet', suggestedLedgerCurrency: () => 'AED' };
  dependencies['@/components/superwall-billing-context'] = { useWafraBilling: () => ({ available: false, configured: false,
    configurationError: null, fetchProOffers: async () => [], purchasePro: async () => 'unavailable', restorePro: async () => null }) };
  dependencies['@/components/ui/band/e-button'] = load(path.join(root, 'src/components/ui/band/e-button.tsx'), dependencies);
  dependencies['@/components/onboarding/e-motion'] = load(path.join(root, 'src/components/onboarding/e-motion.tsx'), dependencies,
    { setTimeout: setTimer, clearTimeout: clearTimer, setInterval: () => 0, clearInterval() {} });
  for (const name of ['e-frame', 'e-welcome', 'e-name', 'e-goals', 'e-watch', 'e-reminders', 'e-first-payment',
    'e-pattern', 'e-paywall', 'e-handoff', 'capture-checklist', 'ready-summary', 'sms-explainer']) {
    dependencies[`@/components/onboarding/${name}`] = load(path.join(root, `src/components/onboarding/${name}.tsx`), dependencies);
  }
  const component = load(options.sourcePath ?? process.env.WAFRA_ONBOARDING_SOURCE ?? path.join(root, 'src/components/onboarding-gate.tsx'), dependencies, {
    process: { env: { EXPO_PUBLIC_WAFRA_E2E_DEMO: '1' } },
    setTimeout: setTimer, clearTimeout: clearTimer, Date: ClockDate,
  }).OnboardingGate;
  const render = () => {
    scope = { key: 'root', cursor: 0 }; occurrences = new Map();
    tree = component({ children: jsx('Navigator') });
    for (const effect of pendingEffects.splice(0)) effect();
    return tree;
  };
  const flush = async (advanceMilliseconds = options.manualClock ? 0 : 400, settle = true) => {
    advanceClock(advanceMilliseconds);
    for (let n = 0; n < 6; n++) { await turn(); render(); }
    // A person also waits after an asynchronous action lands on its screen:
    // its settle time starts only once the action has finished.
    // (Explicit `advance` calls and the manual clock keep exact timing.)
    if (settle && advanceMilliseconds > 0) { advanceClock(advanceMilliseconds); render(); }
  };
  // Respect hidden mounted children and sheet visibility, as a user would.
  const visible = (node, out = []) => {
    if (Array.isArray(node)) node.forEach(child => visible(child, out));
    else if (node && typeof node === 'object' && !node.props?.accessibilityElementsHidden &&
      !(['BottomSheet', 'ConfirmSheet', 'LedgerCurrencySheet'].includes(node.type) && !node.props.visible)) {
      out.push(node); visible(node.props?.children, out);
    }
    return out;
  };
  const eWords = dependencies['@/lib/onboarding-e-copy'].onboardingECopy(language);
  const word = key => typeof eWords[key] === 'string' ? eWords[key] : translate.t(key);
  const control = key => {
    const label = word(key);
    const matches = visible(tree).filter(node => typeof node.props?.onPress === 'function' &&
      (node.props.label === label || node.props.accessibilityLabel === label || text(node).trim() === label ||
        // A choice row speaks "Title. Detail"; its title names it.
        (typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.startsWith(`${label}. `))));
    assert.equal(matches.length, 1, `${key}: expected one control, found ${matches.length}; text=${text(tree)}`);
    return matches[0].props;
  };
  render(); await flush();
  const byTestID = id => visible(tree).find(node => node.props?.testID === id);
  return { events, routes, services, input, render, flush, control, t: translate.t, word, eWords, statementHandoff, byTestID,
    async tap(id) { const node = byTestID(id); assert.ok(node?.props?.onPress, `${id}: pressable exists`); node.props.onPress(); await flush(); },
    advance: milliseconds => flush(milliseconds, false),
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
    unmount() { mounted = false; for (const list of scopes.values()) list.forEach(s => s?.cleanup?.()); },
  };
}

module.exports = { gate, profile };

if (require.main === module) {
// Design language E (2026-09-26): welcome, then five numbered steps — name,
// goals, watch, reminders, first payment (live capture on iPhone) — then the
// pattern and the paywall. These journeys drive the real gate and steps.
const normalizeVisible = value => String(value).replace(/\s+/g, ' ').trim();
const HEADINGS = { welcome: 'welcomeHeadline', name: 'nameTitle', goals: 'goalsTitle', watch: 'watchTitle',
  reminders: 'remindersTitle', manual: 'manualTitle', waiting: 'waitingTitle', paywall: 'paywallTitle' };
const heading = (h, screen) => screen === 'live' ? h.t('onboardLiveTitle')
  : screen === 'pattern' ? h.eWords.patternTitle(null)
    : screen === 'working' ? h.eWords.workingTitle(null)
      : h.eWords[HEADINGS[screen]];
const at = (h, screen) => assert.ok(normalizeVisible(h.text()).includes(normalizeVisible(heading(h, screen))),
  `Expected ${screen}; ${h.text()}`);
const calls = (h, name) => h.events.filter(event => event[0] === name);
/** From Welcome to live capture, answering nothing optional. */
const toLive = async h => {
  await h.press('getStarted'); at(h, 'name');
  await h.press('onboardNameSkip'); at(h, 'goals');
  await h.press('continue'); at(h, 'watch');
  await h.press('notNow'); at(h, 'reminders');
  await h.press('notNow'); at(h, 'live');
};

for (const language of ['en', 'ar']) {
  test(`every step supports Back and Next without losing answers: ${language}`, async () => {
    const h = await gate({ language }); at(h, 'welcome');
    await h.press('getStarted'); at(h, 'name');
    assert.equal(h.control('continue').disabled, true, 'an empty name cannot be saved; Skip is the way past');
    await h.changeText('onboarding-name-input', 'Sara'); await h.press('continue'); at(h, 'goals');
    assert.equal(h.state.userName, 'Sara');
    await h.tap('onboarding-goal-bills'); await h.tap('onboarding-goal-salary');
    await h.press('continue'); at(h, 'watch');
    assert.deepEqual(h.state.wafraGoals, ['salary', 'bills']);
    // Home's sections follow the goals through Customize Home's preference.
    assert.deepEqual(calls(h, 'saveHomeWidgets').at(-1)[1].order.slice(0, 2), ['due', 'upcoming']);
    await h.tap('onboarding-watch-dining');
    h.byTestID('onboarding-watch-limit').props.onChange(60000); await h.flush();
    await h.press('continue'); at(h, 'reminders');
    assert.deepEqual(h.state.budgets, [{ category: 'dining', limitFils: 60000 }]);
    assert.equal(h.state.ledgerMoney.currency, 'AED', 'the confirmed currency is pinned before the first limit');
    await h.press('notNow'); at(h, 'live');
    for (const screen of ['reminders', 'watch', 'goals', 'name']) { await h.press('back'); at(h, screen); }
    assert.equal(h.byTestID('onboarding-name-input').props.value, 'Sara');
    await h.press('continue'); at(h, 'goals');
    assert.equal(h.byTestID('onboarding-goal-bills').props.accessibilityState.checked, true);
    await h.press('continue'); at(h, 'watch');
    assert.equal(h.byTestID('onboarding-watch-dining').props.accessibilityState.checked, true);
    await h.press('continue'); await h.press('notNow'); at(h, 'live');
    assert.deepEqual(h.state.budgets, [{ category: 'dining', limitFils: 60000 }], 'a second pass writes the same limit once');
    assert.equal(h.state.onboardingProfile.stage, 'capture');
    assert.equal(h.state.onboarded, false); assert.deepEqual(h.routes, []);
    assert.deepEqual(h.state.transactions, []);
    assert.equal(calls(h, 'setCaptureOptOut').length, 0); assert.equal(calls(h, 'beginHistoryImport').length, 0);
  });
}

for (const [stage, screen] of [['welcome', 'welcome'], ['focus', 'goals'], ['tracking', 'watch'], ['alerts', 'reminders'],
  ['intention', 'reminders'], ['preview', 'reminders'], ['privacy', 'reminders'], ['capture', 'live']]) {
  test(`cold remount resumes saved ${stage} on ${screen} and does not read bank messages`, async () => {
    const h = await gate({ profile: profile(stage) }); at(h, screen);
    assert.equal(h.state.onboardingProfile.startedAt, 123);
    assert.deepEqual(h.routes, []); assert.equal(calls(h, 'beginHistoryImport').length, 0);
    assert.equal(calls(h, 'setCaptureOptOut').length, 0);
  });
}

test('"I\'ll add by hand" is durable, answers the alert question, and survives a restart', async () => {
  const h = await gate({ profile: profile('capture') });
  await h.press('addByHand'); at(h, 'manual');
  assert.equal(h.state.onboardingProfile.stage, 'complete');
  assert.equal(h.state.onboardingProfile.alerts, 'neither', 'nothing reaches Wafra on its own');
  assert.equal(h.state.captureOptOut, true);
  const saved = clone(h.state); h.unmount();
  const restarted = await gate({ ledger: saved });
  // Back at the choice that led to completion, never claiming success.
  at(restarted, 'live');
  assert.equal(restarted.state.captureOptOut, true); assert.equal(restarted.state.onboarded, false);
  await restarted.press('addByHand'); at(restarted, 'manual');
});

test('Import statements opens the authorized importer and returning lands on live capture', async () => {
  const h = await gate({ profile: profile('capture') });
  await h.press('importStatements');
  assert.equal(h.input.pathname, '/statement-import');
  assert.equal(h.input.params.fromOnboarding, '1');
  assert.ok(h.nodes().some(node => node.type === 'Navigator'), 'the importer owns the screen');
  assert.equal(h.state.onboardingProfile.alerts, 'unsure', 'filling the past says nothing about the bank');
  assert.equal(h.state.onboardingProfile.stage, 'capture');
  await h.route('/'); at(h, 'live');
  assert.equal(h.state.onboarded, false);
  assert.equal(calls(h, 'setCaptureOptOut').length, 0);
  const saved = clone(h.state); h.unmount();
  const cold = await gate({ ledger: saved }); at(cold, 'live');
});

test('Set up opens Shortcuts setup, Back from it returns to live capture, and Back reaches reminders', async () => {
  const h = await gate({ profile: profile('capture') });
  await h.press('onboardLiveAction'); assert.equal(h.input.pathname, '/ios-setup');
  assert.equal(h.state.onboardingProfile.alerts, 'sms', 'the Messages automation reads bank texts');
  h.input.pendingSetup = true; await h.route('/ios-setup', { fromOnboarding: '1' });
  h.input.pendingSetup = false; await h.route('/'); at(h, 'live');
  await h.press('back'); at(h, 'reminders');
  assert.equal(h.state.onboardingProfile.stage, 'alerts');
});

test('when Shortcuts setup finishes onboarding, the result, pattern and paywall show once without a second completion', async () => {
  const h = await gate({ profile: profile('capture', null) });
  await h.press('onboardLiveAction'); assert.equal(h.input.pathname, '/ios-setup');
  await h.update({ onboarded: true }); await h.route('/');
  at(h, 'waiting');
  assert.equal(h.byTestID('onboarding-back'), undefined, 'setup is finished; there is no step to go back to');
  await h.press('continue'); at(h, 'pattern');
  await h.press('oneLastThing'); at(h, 'paywall');
  await h.tap('onboarding-paywall-free');
  assert.ok(h.nodes().some(node => node.type === 'Navigator' && !node.props?.accessibilityElementsHidden));
  assert.ok(!h.text().includes(h.eWords.paywallTitle));
  assert.equal(calls(h, 'onboarded').length, 0, 'setup already completed onboarding durably');
  assert.deepEqual(h.routes, [['push', '/ios-setup?fromOnboarding=1']]);
});

for (const pathname of ['/ios-setup', '/import-sms', '/ios-paging-beta', '/ios-notification-setup', '/ios-apple-pay-setup']) {
  test(`first-run ${pathname} owns its UI while onboarding setup is pending`, async () => {
    const h = await gate({ pathname, profile: profile('capture'), pendingSetup: true });
    assert.deepEqual(h.routes, [], 'The setup child route must not be redirected back to its parent');
    assert.ok(h.nodes().some(node => node.type === 'Navigator'), 'The route must be visible instead of the onboarding overlay');
    assert.ok(!h.text().includes(h.eWords.welcomeHeadline));
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
    assert.ok(!h.nodes().some(node => node.type === 'Navigator' && !node.props?.accessibilityElementsHidden));
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
  await h.press('storageRecoveryRetry'); at(h, 'live');
});

test('failed ledger hydration stays in recovery even on the paged setup route', async () => {
  const h = await gate({ pathname: '/ios-paging-beta', hydrationFailed: true });
  assert.ok(h.nodes().some(node => node.type === 'StorageRecovery'));
  assert.equal(calls(h, 'loadSetup').length, 0); assert.deepEqual(h.routes, []);
});

test('rapid alternating capture/manual taps cannot race the durable opt-in', async () => {
  const write = deferred();
  const h = await gate({ profile: profile('capture'), optOut: true, services: { setCaptureOptOut: () => write.promise } });
  const automatic = h.control('onboardLiveAction'), manual = h.control('addByHand');
  automatic.onPress(); manual.onPress(); automatic.onPress(); manual.onPress(); await h.flush();
  assert.deepEqual(calls(h, 'setCaptureOptOut').map(v => v[1]), [false]);
  assert.equal(h.control('back').disabled, true); assert.deepEqual(h.routes, []);
  write.resolve(); await h.flush();
  assert.deepEqual(h.routes, [['push', '/ios-setup?fromOnboarding=1']]);
  assert.equal(h.state.captureOptOut, false); assert.equal(h.state.onboarded, false);
});

test('rapid alternating manual/capture taps cannot reverse explicit opt-out', async () => {
  const write = deferred();
  const h = await gate({ profile: profile('capture'), services: { setCaptureOptOut: () => write.promise } });
  const automatic = h.control('onboardLiveAction'), manual = h.control('addByHand');
  manual.onPress(); automatic.onPress(); manual.onPress(); automatic.onPress(); await h.flush();
  assert.deepEqual(calls(h, 'setCaptureOptOut').map(v => v[1]), [true]);
  assert.equal(h.control('back').disabled, true);
  write.resolve(); await h.flush();
  assert.deepEqual(h.routes, []); assert.equal(h.state.captureOptOut, true);
  at(h, 'manual');
  await h.press('back'); at(h, 'live'); assert.equal(h.state.captureOptOut, true);
  delete h.services.setCaptureOptOut;
  await h.press('onboardLiveAction'); assert.equal(h.state.captureOptOut, false);
});

test('capture preference failure offers retry/manual and does not claim successful setup', async () => {
  const h = await gate({ profile: profile('capture'), services: { setCaptureOptOut: async () => { throw new Error('synthetic write failure'); } } });
  await h.press('onboardLiveAction');
  assert.ok(h.text().includes(h.t('onboardCompleteNeedsAttentionTitle'))); assert.deepEqual(h.routes, []);
  assert.equal(h.state.onboarded, false);
  await h.press('onboardRetrySetup'); at(h, 'live');
  delete h.services.setCaptureOptOut;
  await h.press('addByHand'); assert.equal(h.state.captureOptOut, true);
});

test('the paywall\'s free way on cannot leave on a failed save; Retry finishes to the same view', async () => {
  const h = await gate({ profile: profile('capture'), services: { ensureDurable: async () => { throw new Error('synthetic profile save failure'); } } });
  await h.press('addByHand'); at(h, 'manual');
  await h.press('continue'); at(h, 'pattern');
  await h.press('oneLastThing'); at(h, 'paywall');
  const free = h.byTestID('onboarding-paywall-free').props;
  free.onPress(); free.onPress(); await h.flush();
  assert.equal(calls(h, 'ensureDurable').length, 1); assert.deepEqual(h.routes, []);
  assert.ok(h.text().includes(h.t('onboardFinishSaveFailedTitle')));
  assert.equal(h.control('back').disabled, true);
  assert.equal(calls(h, 'committed').length, 0);
  delete h.services.ensureDurable;
  await h.press('storageRecoveryRetry');
  assert.deepEqual(h.routes, [['replace', '/flow']], 'an older profile keeps its chosen first view');
  assert.equal(h.durable.onboarded, true); assert.equal(h.durable.captureOptOut, true);
  assert.equal(calls(h, 'setCaptureOptOut').length, 1);
});

for (const [focus, destination] of [['spending', '/flow'], ['bills', '/bills'], ['cashflow', '/'], [null, '/']]) {
  test(`finishing opens ${destination} only after durable completion (legacy focus ${focus})`, async () => {
    const save = deferred(); const h = await gate({ profile: profile('capture', focus), services: { ensureDurable: () => save.promise } });
    await h.press('addByHand'); await h.press('continue'); await h.press('oneLastThing');
    h.byTestID('onboarding-paywall-free').props.onPress(); await h.flush();
    assert.deepEqual(h.routes, []); assert.equal(calls(h, 'committed').length, 0);
    save.resolve(); await h.flush();
    assert.deepEqual(h.routes, [['replace', destination]]); assert.equal(h.durable.onboarded, true);
    // Only Home receives the pattern hand-off.
    assert.equal(h.nodes().some(node => node.props?.testID === 'onboarding-handoff'), destination === '/');
  });
}

test('a Pro customer skips the paywall and the pattern opens Wafra', async () => {
  const h = await gate({ profile: profile('capture', null), ledger: { pro: true } });
  await h.press('addByHand'); await h.press('continue'); at(h, 'pattern');
  assert.throws(() => h.control('oneLastThing'));
  await h.press('openWafra');
  assert.deepEqual(h.routes, [['replace', '/']]); assert.equal(h.durable.onboarded, true);
});

test('How it works on live capture dismisses back to the same step without writing consent', async () => {
  const h = await gate({ profile: profile('capture') });
  await h.press('onboardHowItWorks');
  const sheet = walk(h.tree).find(node => node.type === 'BottomSheet'); assert.equal(sheet.props.visible, true);
  assert.equal(sheet.props.title, h.t('onboardCaptureLearnMoreTitle'));
  sheet.props.onClose(); await h.flush(); at(h, 'live');
  assert.equal(walk(h.tree).find(node => node.type === 'BottomSheet').props.visible, false);
  assert.equal(calls(h, 'setCaptureOptOut').length, 0); assert.deepEqual(h.routes, []);
});

test('Allow notifications asks once, sets the daily summary it allows, and its second tap cannot start capture', async () => {
  const h = await gate({ profile: profile('alerts'), manualClock: true,
    services: { requestVisibleNotificationPermission: () => true } });
  at(h, 'reminders');
  await h.press('allowNotifications'); at(h, 'live');
  assert.equal(calls(h, 'requestVisibleNotificationPermission').length, 1);
  assert.deepEqual(calls(h, 'dailySummary'), [['dailySummary', true]]);
  assert.equal(calls(h, 'syncDailySummary').length, 1);
  h.control('onboardLiveAction').onPress(); await h.flush();
  assert.equal(calls(h, 'setCaptureOptOut').length, 0); assert.deepEqual(h.routes, []);
  await h.advance(350);
  await h.press('onboardLiveAction');
  assert.deepEqual(h.routes, [['push', '/ios-setup?fromOnboarding=1']]);
});

test('Not now on reminders asks nothing and turns the daily summary off', async () => {
  const h = await gate({ profile: profile('alerts') });
  await h.press('notNow'); at(h, 'live');
  assert.equal(calls(h, 'requestVisibleNotificationPermission').length, 0);
  assert.deepEqual(calls(h, 'dailySummary'), [['dailySummary', false]]);
  assert.equal(calls(h, 'cancelDailySummary').length, 1);
});

test('repeated taps on synchronous Next controls cannot skip a step', async () => {
  const h = await gate();
  const start = h.control('getStarted');
  for (let n = 0; n < 20; n++) start.onPress();
  await h.flush(); at(h, 'name');
  assert.equal(h.control('continue').disabled, true);
  await h.press('onboardNameSkip'); at(h, 'goals');
  const next = h.control('continue');
  for (let n = 0; n < 20; n++) next.onPress();
  await h.flush(); at(h, 'watch');
  assert.deepEqual(h.routes, []); assert.equal(calls(h, 'setCaptureOptOut').length, 0);
});

test('six full Back/Next cycles keep the latest answers and save each stage without starting capture', async () => {
  const h = await gate();
  const ids = ['salary', 'bills', 'subscriptions', 'spend-less', 'cash-cards'];
  const picked = new Set();
  await h.press('getStarted');
  for (let cycle = 0; cycle < 6; cycle++) {
    at(h, 'name'); await h.press('onboardNameSkip');
    const goal = ids[cycle % ids.length];
    await h.tap(`onboarding-goal-${goal}`);
    if (picked.has(goal)) picked.delete(goal); else picked.add(goal);
    await h.press('continue'); at(h, 'watch');
    assert.deepEqual(h.state.wafraGoals, ids.filter(id => picked.has(id)));
    await h.tap('onboarding-watch-transport'); await h.press('continue');
    await h.press('notNow'); at(h, 'live');
    assert.deepEqual(h.state.budgets, [], 'a picked category with no limit is not a budget');
    for (const [screen, stage] of [['reminders', 'alerts'], ['watch', 'tracking'], ['goals', 'focus'], ['name', 'welcome']]) {
      await h.press('back'); at(h, screen);
      assert.equal(h.state.onboardingProfile.stage, stage);
    }
  }
  assert.deepEqual(h.routes, []); assert.equal(h.state.onboarded, false);
  assert.equal(calls(h, 'setCaptureOptOut').length, 0); assert.equal(calls(h, 'beginHistoryImport').length, 0);
});

test('the name is step 1, persists Unicode safely, and previews Home\'s greeting', async () => {
  const h = await gate({ language: 'en' });
  await h.press('getStarted'); at(h, 'name');
  assert.ok(h.nodes().some(node => node.props?.testID === 'onboarding-name-input'));
  assert.ok(h.nodes().some(node => node.props?.accessibilityRole === 'progressbar' && node.props.accessibilityValue.now === 1));
  await h.changeText('onboarding-name-input', '  ناصر   Khanjar  ');
  assert.ok(h.text().includes('ناصر Khanjar'));
  await h.press('continue');
  assert.equal(h.state.userName, 'ناصر Khanjar');
  assert.equal(h.durable.userName, 'ناصر Khanjar');
  assert.equal(calls(h, 'setUserName').length, 1);
  assert.deepEqual(h.state.transactions, []);
});

test('the country and currency rows open their own sheets and write only what is chosen', async () => {
  const h = await gate();
  await h.press('getStarted'); at(h, 'name');
  const sheets = () => walk(h.tree).filter(node => node.type === 'LedgerCurrencySheet');
  await h.tap('onboarding-currency-confirm');
  assert.equal(sheets()[0].props.visible, true);
  sheets()[0].props.onSelect('EUR'); await h.flush();
  assert.equal(h.state.ledgerMoney.currency, 'EUR');
  assert.equal(calls(h, 'setCountry').length, 0, 'choosing a currency never changes the country');
});

test('a completion callback reaches the result without replaying the saved setup redirect', async () => {
  const h = await gate({ profile: profile('capture'), pendingSetup: true, params: { onboarding: 'complete' } });
  at(h, 'waiting');
  assert.deepEqual(h.routes, []); assert.equal(h.state.onboarded, false);
  await h.press('back'); at(h, 'live');
  assert.equal(h.input.params.onboarding, undefined);
  assert.equal(h.state.onboardingProfile.stage, 'capture');
});

test('the first payment that arrived by itself shows with the watched limit it moved', async () => {
  const cafe = { id: 't1', type: 'expense', source: 'sms', date: '2026-09-20', ts: 5, category: 'dining',
    amountFils: 2400, title: 'Cafe', accountId: 'a' };
  const h = await gate({ profile: profile('capture'), params: { onboarding: 'complete' },
    ledger: { transactions: [cafe], budgets: [{ category: 'dining', limitFils: 120000 }],
      ledgerMoney: { schemaVersion: 2, currency: 'AED', exponent: 2 } } });
  at(h, 'working');
  assert.ok(h.byTestID('onboarding-first-payment'));
  assert.ok(h.byTestID('onboarding-first-payment-watch'));
  const statementOnly = await gate({ profile: profile('capture'), params: { onboarding: 'complete' },
    ledger: { transactions: [{ ...cafe, captureSource: 'pdf' }] } });
  at(statementOnly, 'waiting');
  assert.equal(statementOnly.byTestID('onboarding-first-payment'), undefined, 'an imported row did not arrive by itself');
});

test('ordinary profile save failure cannot be turned into a successful final completion', async () => {
  const h = await gate({ profile: profile('focus'), services: {
    setCaptureOptOut: async () => { throw new Error('synthetic encrypted persistence failure'); },
  } });
  at(h, 'goals'); await h.press('continue');
  await h.setFailure({ operation: 'write', message: 'synthetic profile persistence failure' });
  await h.press('notNow'); await h.press('notNow'); at(h, 'live');
  await h.press('addByHand');
  assert.equal(h.state.onboarded, false); assert.deepEqual(h.routes, []);
  assert.equal(calls(h, 'committed').length, 0);
  assert.ok(h.text().includes(h.t('onboardCompleteNeedsAttentionTitle')));
});

test('welcome draws the example pattern and offers no language switch', async () => {
  const h = await gate({ reducedMotion: false });
  at(h, 'welcome');
  assert.ok(h.byTestID('onboarding-example-pattern'));
  assert.ok(!h.nodes().some(node => node.props?.testID === 'onboarding-language-switch'));
  await toLive(h);
  assert.deepEqual(h.routes, []); assert.equal(h.state.onboarded, false);
});
}

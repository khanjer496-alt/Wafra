'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../repair/load-typescript.cjs');
const root = path.resolve(__dirname, '../../..');
const PROGRESS = 'wafra/ios-message-setup-progress/v1';
const HANDOFF = 'wafra/ios-history-handoff-started-at/v1';
const ORIGIN = 'wafra/ios-history-return-origin/v1';
const INSTALLED = 'wafra/ios-history-shortcut-installed/v2';
const LIVE_URL = 'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef';
const HISTORY_URL = 'https://www.icloud.com/shortcuts/abcdef0123456789abcdef0123456789';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

// Actual route, controller, translations, progress reducer, and history storage
// coordinator. Only the native/React/router/storage host boundaries are replaced.
// This exercises handlers and rendered state, not source-text assertions or Apple UI.
async function screen(t, options = {}) {
  const slots = [], effects = [], listeners = new Set(), receipts = [], routes = [];
  const urls = [], discards = [], storageEvents = [], growth = [], announcements = [];
  let cursor = 0, tree, disposed = false, onboarded = false, durableCalls = 0, chunksRead = 0, dismissals = 0;
  const params = { fromOnboarding: '1', ...options.params };
  const slot = initial => slots[cursor++] ?? (slots[cursor - 1] = initial());
  const react = {
    useState(initial) {
      const state = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
      return [state.value, next => { state.value = typeof next === 'function' ? next(state.value) : next; }];
    },
    useRef: value => slot(() => ({ current: value })),
    useCallback(fn, deps) {
      const memo = slot(() => ({}));
      if (!memo.deps || deps.some((value, i) => value !== memo.deps[i])) { memo.value = fn; memo.deps = deps; }
      return memo.value;
    },
    useEffect(fn, deps) {
      const memo = slot(() => ({}));
      if (!memo.deps || deps.some((value, i) => value !== memo.deps[i])) {
        memo.deps = deps;
        effects.push(() => { memo.cleanup?.(); memo.cleanup = fn(); });
      }
    },
  };
  react.useMemo = (fn, deps) => react.useCallback(fn, deps)();
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const environment = { process: { env: {
    EXPO_PUBLIC_WAFRA_SHORTCUT_URL: options.liveUrl === undefined ? LIVE_URL : options.liveUrl,
    EXPO_PUBLIC_WAFRA_HISTORY_SHORTCUT_URL: options.historyUrl === undefined ? HISTORY_URL : options.historyUrl,
    EXPO_PUBLIC_WAFRA_PAGED_HISTORY_BETA: '0',
  } } };
  const source = (file, deps = {}) => load(path.join(root, file), deps, environment);
  const copy = source('src/lib/i18n.ts');
  copy.setLanguage(options.language ?? 'en');
  const values = options.values ?? new Map();
  if (options.progress) values.set(PROGRESS, JSON.stringify({
    version: 1, activeSection: 'future', futureShortcutConfirmed: false,
    futureAutomationConfirmed: false, futureStatus: 'not-started', historyShortcutConfirmed: false,
    historyStatus: 'not-started', returnToOnboarding: false, ...options.progress,
  }));
  if (options.handoff !== undefined) {
    values.set(HANDOFF, String(options.handoff)); values.set(ORIGIN, 'onboarding');
  }
  const controls = { available: true, nativeAvailable: true, ...options.controls };
  const storage = {
    async getItem(key) { await controls.beforeStorage?.('get', key); return values.get(key) ?? null; },
    async setItem(key, value) {
      await controls.beforeStorage?.('set', key, value);
      values.set(key, value); storageEvents.push(['set', key, value]);
    },
    async removeItem(key) {
      await controls.beforeStorage?.('remove', key);
      values.delete(key); storageEvents.push(['remove', key]);
    },
  };
  const nativeStatus = {
    enabled: false, entitled: true, setupProofVersion: null, firstCapturedAt: null,
    pending: 0, dropped: 0, corrupt: false, ...options.nativeStatus,
  };
  const native = {
    notificationCaptureSupported: options.notificationCaptureSupported === true,
    applePayCaptureSupported: options.applePayCaptureSupported === true,
    ...(options.bundled ? { getMessageShortcutURL: async () => 'file:///app/Wafra%20Capture%20v3.shortcut' } : {}),
    ...(options.bundledHistory ? { getHistoryShortcutURL: async () => 'file:///app/Wafra%20History%20v8.shortcut' } : {}),
    async getCaptureStatus() { await controls.beforeStatus?.(); return { ...nativeStatus }; },
    async setCaptureEnabled(value) { await controls.beforeEnable?.(value); nativeStatus.enabled = value; receipts.push(['enabled', value]); },
    async getCompletedSession() { return null; },
    async recoverCompletedSession(startedAt) { return await controls.recover?.(startedAt) ?? null; },
    async readChunk() { chunksRead++; return []; },
    async discardSession(id) { await controls.beforeDiscard?.(id); discards.push(id); },
  };
  const platform = {
    Platform: { OS: 'ios', Version: options.version ?? '26.6' },
    Linking: {
      async canOpenURL(url) { await controls.beforeCanOpen?.(url); return controls.available; },
      async openURL(url) { urls.push(url); await controls.beforeOpen?.(url); },
    },
    AppState: { addEventListener(_kind, fn) { listeners.add(fn); return { remove: () => listeners.delete(fn) }; } },
    AccessibilityInfo: { announceForAccessibility: text => announcements.push(text) },
    ScrollView: 'ScrollView', View: 'View', Pressable: 'Pressable',
    StyleSheet: { create: styles => styles, hairlineWidth: 1 },
  };
  const history = source('src/lib/ios-history-setup.ts', { '@react-native-async-storage/async-storage': storage });
  const journey = source('src/lib/ios-setup-journey.ts');
  const progress = source('src/lib/ios-message-onboarding.ts', {
    '@react-native-async-storage/async-storage': storage, './ios-history-setup': history, './ios-setup-journey': journey,
  });
  const protocol = source('src/lib/ios-local-capture-protocol.ts');
  const capture = source('src/lib/ios-capture-setup.ts', {
    'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async url => urls.push(url) },
    'react-native': platform, '@/lib/ios-local-capture-protocol': protocol,
    './ios-capture-health': source('src/lib/ios-capture-health.ts'),
    '@/lib/capture': { getIosCaptureNativeModule: () => controls.nativeAvailable ? native : null,
      subscribeIosCaptureStatusRefresh: () => () => {} },
  });
  const router = {
    push: value => routes.push(['push', value]), replace: value => routes.push(['replace', value]),
    navigate: value => routes.push(['navigate', value]),
    // Pops to the existing root; not a destination. The navigate after it is.
    dismissAll: () => { dismissals++; },
    back: () => routes.push(['back']), canGoBack: () => options.canGoBack !== false,
    setParams: patch => Object.assign(params, patch),
  };
  const store = {
    // "Which banks text you?" gates both sections; these journeys exercise the
    // checklist behind it, so the question is answered unless a case says
    // otherwise (scripts/test/ios-setup-ux.test.js pins the question itself).
    state: { accounts: [], transactions: [], language: options.language ?? 'en', onboardingProfile: null,
      marketId: 'AE', knownBanks: options.knownBanks ?? ['Emirates NBD'] },
    async ensureDurable() { durableCalls++; await controls.beforeDurable?.(durableCalls); },
    setOnboarded() { onboarded = true; receipts.push(['onboarded']); },
    setOnboardingProfile(profile) { store.state.onboardingProfile = profile; },
    async setCaptureOptOut(value) { receipts.push(['optOut', value]); await controls.beforeOptOut?.(value); },
    setKnownBanks(names) { store.state.knownBanks = [...names]; receipts.push(['knownBanks', [...names]]); },
  };
  const ui = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': platform, '@/lib/i18n': copy,
    '@/components/themed-text': { ThemedText: 'Text' },
    '@/components/ui/controls': { Button: 'Button', Chip: 'Chip' },
    '@/constants/theme': { Spacing: {}, Radius: {}, ScreenPadding: 20, MaxContentWidth: 600 },
  };
  const Details = source('src/components/ios-message-setup/details-sheet.tsx', {
    ...ui, '@/components/ui/bottom-sheet': { BottomSheet: 'BottomSheet' },
  }).DetailsSheet;
  const component = source('src/app/ios-setup.tsx', {
    ...ui, react,
    '@react-native-async-storage/async-storage': storage,
    'expo-router': { Stack: { Screen: 'StackScreen' }, useRouter: () => router, useLocalSearchParams: () => params },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/ios-message-setup/checklist-row': { ChecklistRow: 'ChecklistRow' },
    '@/components/ios-message-setup/automation-guide': { AutomationGuide: 'AutomationGuide' },
    '@/components/ios-message-setup/details-sheet': { DetailsSheet: 'DetailsSheet' },
    '@/components/onboarding/setup-shell': { SetupShell: 'SetupShell', SetupHeader: 'ScreenHeader' },
    '@/components/themed-view': { ThemedView: 'ThemedView' },
    '@/components/ui/confirm-sheet': { ConfirmSheet: 'ConfirmSheet' },
    '@/components/ui/layout': { Block: 'Block' },
    '@/components/ui/screen-header': { ScreenHeader: 'ScreenHeader' },
    '@/hooks/use-large-text-layout': { useLargeTextLayout: () => false },
    '@/hooks/use-language': { useLanguage: () => options.language ?? 'en' },
    '@/lib/ios-local-capture-protocol': protocol, '@/lib/ios-capture-setup': capture,
    '@/lib/ios-history-setup': history, '@/lib/ios-message-onboarding': progress,
    '@/lib/ios-shortcut-setup-copy': source('src/lib/ios-shortcut-setup-copy.ts'),
    '@/lib/ios-setup-journey': journey, '@/lib/ios-paged-setup': source('src/lib/ios-paged-setup.ts'),
    '@/lib/growth-funnel': { GROWTH_PLACEMENTS: { onboarding: 'onboarding_main' }, trackGrowthEvent: (...args) => growth.push(args) },
    // Real module, with only the two surfaces this harness pins overridden —
    // a hand-listed stub silently drops functions setup later starts calling.
    '@/lib/onboarding': {
      ...require('../build/onboarding'),
      onboardingLandingPath: () => '/',
      onboardingInsightKeys: () => ({
        title: 'onboardInsightOverviewTitle',
        body: 'onboardInsightOverviewBody',
      }),
    }, '@/lib/store': { useStore: () => store },
    '../../modules/wafra-message-history': { __esModule: true, default: options.historyAvailable === false ? {} : native },
  }).default;
  const render = () => { if (disposed) return; cursor = 0; tree = component(); for (const effect of effects.splice(0)) effect(); };
  const flush = async () => { for (let n = 0; n < 8; n++) { render(); await new Promise(resolve => setImmediate(resolve)); } };
  const all = () => {
    const result = [];
    const visit = node => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node || typeof node !== 'object') return;
      if (['DetailsSheet', 'BottomSheet', 'ConfirmSheet'].includes(node.type) && !node.props.visible) return;
      result.push(node);
      if (node.type === 'DetailsSheet') return visit(Details(node.props));
      if (node.type === 'ChecklistRow' && !node.props.expanded) return;
      visit(node.props.children);
    };
    visit(tree); return result;
  };
  const button = key => {
    const label = copy.t(key), nodes = all();
    const item = nodes.find(node => node.type === 'Button' && node.props.label === label);
    if (item) return item.props;
    const header = nodes.find(node => node.type === 'ScreenHeader')?.props;
    return [header?.back, ...(header?.actions ?? [])].find(action => action?.label === label);
  };
  const press = async key => {
    const action = button(key);
    assert.ok(action, `Visible action ${key}: ${all().filter(n => n.type === 'Button').map(n => n.props.label)}`);
    assert.ok(!action.disabled, `Enabled action ${key}`);
    action.onPress(); await flush();
  };
  const dispose = () => { disposed = true; slots.forEach(memo => memo.cleanup?.()); };
  t.after(dispose);
  await flush();
  return {
    all, button, press, flush, values, controls, nativeStatus, receipts, routes, urls, discards, storageEvents,
    get dismissals() { return dismissals; },
    growth, announcements, store, copy, dispose, history, progress,
    saved: () => JSON.parse(values.get(PROGRESS)),
    get durableCalls() { return durableCalls; }, get onboarded() { return onboarded; }, get chunksRead() { return chunksRead; },
    text: () => all().filter(node => node.type === 'Text').flatMap(node => node.props.children).join(' '),
    async foreground(count = 1) { for (let n = 0; n < count; n++) for (const fn of listeners) fn('active'); await flush(); },
    /** Wafra really left (e.g. to Shortcuts) and came back. */
    async leaveAndReturn() { for (const fn of [...listeners]) fn('background'); for (const fn of [...listeners]) fn('active'); await flush(); },
    async callback(result) { params.shortcutResult = result; await flush(); },
    async returnWith(patch) { Object.assign(params, patch); await flush(); },
    async section(section) {
      const title = copy.t(section === 'history' ? 'iosMessagePastTitle' : 'iosMessageFutureTitle');
      all().find(node => node.type === 'ChecklistRow' && node.props.title === title).props.onPress(); await flush();
    },
    async help(key) { await press('iosMessageLearnMore'); await press(key); },
    async confirm(key, cancel = false) {
      const sheet = all().find(node => node.type === 'ConfirmSheet' && node.props.confirmLabel === copy.t(key));
      assert.ok(sheet, `Visible confirmation ${key}`);
      (cancel ? sheet.props.onClose : sheet.props.onConfirm)(); await flush();
    },
  };
}

const ready = { futureShortcutConfirmed: true, futureAutomationConfirmed: true,
  futureStatus: 'complete', historyStatus: 'skipped', historySkippedForNow: true };
const proven = { enabled: true, setupProofVersion: 1 };

test('rapid install taps and foreground reentry launch once and never prove capture', async t => {
  const pending = deferred();
  const s = await screen(t, { controls: { beforeOpen: () => pending.promise } });
  const action = s.button('iosLocalInstallShortcut');
  action.onPress(); action.onPress(); action.onPress();
  await s.flush();
  assert.equal(s.button('back').disabled, true);
  await s.foreground(4);
  assert.deepEqual(s.urls, [LIVE_URL]);
  assert.equal(s.saved().futureShortcutConfirmed, false);
  assert.equal(s.nativeStatus.firstCapturedAt, null);
  pending.resolve(); await s.flush();
  assert.equal(s.button('back').disabled, false);
  assert.ok(s.button('iosLocalAlreadyAdded'));
});

test('failed live install displays retryable error and retry does not confirm installation', async t => {
  const s = await screen(t, { controls: { beforeOpen: async () => { throw Error('offline'); } } });
  await s.press('iosLocalInstallShortcut');
  assert.ok(s.text().includes(s.copy.t('iosLocalShortcutInstallFailed')));
  assert.ok(s.announcements.includes(s.copy.t('iosLocalShortcutInstallFailed')));
  assert.equal(s.saved().futureShortcutConfirmed, false);
  s.controls.beforeOpen = undefined;
  await s.press('iosLocalInstallShortcut');
  assert.deepEqual(s.urls, [LIVE_URL, LIVE_URL]);
  assert.equal(s.saved().futureShortcutConfirmed, false);
});

test('history HTTPS install failure restores its actionable initial state in both languages', async t => {
  for (const language of ['en', 'ar']) {
    const s = await screen(t, { language, params: { section: 'history' },
      controls: { available: false, beforeOpen: async () => { throw Error('offline'); } } });
    await s.press('historyAddAction');
    assert.deepEqual(s.urls, [HISTORY_URL]);
    assert.equal(s.saved().historyStatus, 'not-started');
    assert.equal(s.saved().historyShortcutConfirmed, false);
    assert.equal(s.values.has(HANDOFF), false);
    assert.ok(s.text().includes(s.copy.t('iosLocalShortcutInstallFailed')));
    s.controls.beforeOpen = undefined;
    await s.press('historyAddAction');
    assert.equal(s.saved().historyStatus, 'in-progress');
    assert.ok(s.button('iosMessageHistoryStartAfterAdding'));
  }
});

test('missing Shortcuts blocks protected history run and offers installation without losing progress', async t => {
  const s = await screen(t, { params: { section: 'history' }, controls: { available: false } });
  await s.press('historyAddAction');
  await s.press('iosMessageHistoryStartAfterAdding');
  assert.equal(s.saved().historyShortcutConfirmed, false);
  assert.equal(s.values.has(HANDOFF), false);
  assert.equal(s.chunksRead, 0);
  assert.ok(s.button('iosInstallShortcuts'));
  await s.press('iosInstallShortcuts');
  assert.equal(s.urls.at(-1), 'https://apps.apple.com/app/shortcuts/id1462947752');
  s.controls.available = true;
  await s.press('iosMessageHistoryStartAfterAdding');
  assert.equal(s.saved().historyShortcutConfirmed, true);
  assert.equal(s.values.get(ORIGIN), 'onboarding');
});

test('invalid release Shortcut URLs leave setup unavailable without opening an unapproved URL', async t => {
  for (const invalid of ['', 'https://example.invalid/capture', LIVE_URL + '?token=wrong']) {
    const s = await screen(t, { liveUrl: invalid, historyUrl: invalid });
    assert.equal(s.button('iosLocalInstallShortcut').disabled, true);
    await s.section('history');
    assert.equal(s.button('historyAddAction'), undefined);
    assert.deepEqual(s.urls, []);
    assert.equal(s.values.has(HANDOFF), false);
    assert.equal(s.saved().returnToOnboarding, true);
  }
});

test('native capture unavailable on entry recovers through Retry without claiming setup proof', async t => {
  const s = await screen(t, { controls: { nativeAvailable: false } });
  assert.ok(s.text().includes(s.copy.t('iosLocalUpdateRequired')));
  assert.equal(s.button('iosLocalInstallShortcut'), undefined);
  assert.deepEqual(s.urls, []);
  s.controls.nativeAvailable = true;
  await s.press('iosMessageRetrySetup');
  assert.ok(s.button('iosLocalInstallShortcut'));
  assert.equal(s.saved().futureShortcutConfirmed, false);
  assert.equal(s.nativeStatus.enabled, false);
});

test('iOS 27 can choose notifications before answering the bank-name question', async t => {
  const s = await screen(t, { version: '27.0', knownBanks: [], notificationCaptureSupported: true });
  await s.press('iosNotificationSetupAction');
  // Opening another source's setup is navigation only; nothing saved changes.
  assert.equal(s.saved().futureCaptureSource, undefined);
  assert.equal(s.saved().futureAutomationConfirmed, false);
  assert.equal(s.routes.at(-1)[1].pathname, '/ios-notification-setup');
  assert.deepEqual(s.store.state.knownBanks, []);
  assert.equal(s.nativeStatus.enabled, false);
});

test('notification-only onboarding finishes with its own proof and never requires SMS setup or a bank-name choice', async t => {
  const s = await screen(t, { version: '27.0', knownBanks: [], notificationCaptureSupported: true,
    nativeStatus: { enabled: true, notificationSetupProofAt: Date.now(), setupProofVersion: null },
    progress: { futureCaptureSource: 'notification', futureAutomationConfirmed: true, historyStatus: 'complete' } });
  assert.equal(s.all().some(node => node.props?.testID === 'ios-message-setup-banks'), false);
  await s.press('iosMessageContinue');
  assert.equal(s.onboarded, true);
  assert.deepEqual(s.store.state.knownBanks, []);
});

test('SMS proof cannot finish a selected notification automation', async t => {
  const s = await screen(t, { version: '27.0', notificationCaptureSupported: true,
    nativeStatus: { enabled: true, setupProofVersion: 1 },
    progress: { futureCaptureSource: 'notification', futureAutomationConfirmed: true, historyStatus: 'complete' } });
  assert.equal(s.button('iosMessageContinue'), undefined);
  assert.equal(s.onboarded, false);
  await s.press('iosNotificationChooseSms');
  // Viewing SMS setup neither switches nor erases the confirmed notification setup.
  assert.equal(s.saved().futureCaptureSource, 'notification');
  assert.equal(s.saved().futureAutomationConfirmed, true);
  assert.equal(s.saved().historyStatus, 'complete');
  assert.ok(s.button('iosLocalOpenAutomation'));
  // Returning from another source's screen shows the recorded source again.
  await s.returnWith({ notificationReturn: String(Date.now()) });
  assert.equal(s.button('iosLocalOpenAutomation'), undefined);
  assert.ok(s.button('iosNotificationChooseSms'));
});

test('installing the SMS Shortcut while viewing it cannot rewrite the recorded notification status', async t => {
  const s = await screen(t, { version: '27.0', notificationCaptureSupported: true,
    nativeStatus: { enabled: true, notificationSetupProofAt: Date.now() },
    progress: { futureCaptureSource: 'notification', futureAutomationConfirmed: true,
      futureStatus: 'complete', historyStatus: 'complete' } });
  await s.press('iosNotificationChooseSms');
  const before = s.urls.length;
  await s.press('iosLocalInstallShortcut');
  assert.ok(s.urls.length > before, 'the SMS Shortcut install still opens');
  assert.equal(s.saved().futureCaptureSource, 'notification');
  assert.equal(s.saved().futureStatus, 'complete', 'viewing SMS setup must not mark the notification setup in progress');
  assert.equal(s.saved().futureAutomationConfirmed, true);
});

test('notification help cannot open an invisible SMS guide or run its permission check', async t => {
  const s = await screen(t, { version: '27.0', notificationCaptureSupported: true,
    nativeStatus: { enabled: true, notificationSetupProofAt: Date.now() },
    progress: { futureCaptureSource: 'notification', futureAutomationConfirmed: true, historyStatus: 'complete' } });
  await s.press('iosMessageLearnMore');
  assert.equal(s.button('iosMessageReviewAutomation'), undefined);
  assert.equal(s.button('iosMessageAddAgain'), undefined);
  assert.equal(s.button('iosMessageRunPermissionCheck'), undefined);
  assert.ok(!s.text().includes(s.copy.t('iosMessageGuideSender')));
  assert.ok(s.button('iosMessageContinue'));
});

test('failed Shortcuts scheme probe on future proof offers App Store and never enables capture', async t => {
  const s = await screen(t, { progress: { futureShortcutConfirmed: true },
    controls: { beforeCanOpen: async () => { throw Error('scheme unavailable'); } } });
  await s.press('iosMessageRunPermissionCheck');
  assert.ok(s.text().includes(s.copy.t('iosShortcutsMissing')));
  assert.equal(s.nativeStatus.enabled, false);
  assert.deepEqual(s.urls, []);
  assert.ok(s.button('iosInstallShortcuts'));
  s.controls.beforeCanOpen = undefined;
  await s.press('iosMessageRunPermissionCheck');
  assert.equal(s.nativeStatus.enabled, true);
  assert.equal(s.nativeStatus.firstCapturedAt, null);
  assert.equal(s.onboarded, false);
});

test('older iOS or absent history bridge cannot expose an executable history run', async t => {
  for (const options of [{ version: '25.9' }, { historyAvailable: false }]) {
    const s = await screen(t, { ...options, params: { section: 'history' },
      progress: { historyShortcutConfirmed: true } });
    assert.equal(s.button('historyStartAction'), undefined);
    assert.equal(s.button('iosMessageContinue'), undefined);
    assert.equal(s.values.has(HANDOFF), false);
    assert.deepEqual(s.urls, []);
    if (options.version === '25.9') {
      // History is impossible before iOS 26: the optional card is not shown at all.
      assert.equal(s.all().some(node => node.type === 'ChecklistRow' && node.props.title === s.copy.t('iosMessagePastTitle')), false);
    } else await s.press('iosMessageNextFuture');
    assert.ok(s.button('iosLocalInstallShortcut'));
  }
});

test('history confirmation storage failures cannot launch or manufacture an in-flight handoff', async t => {
  for (const blockedKey of [INSTALLED, HANDOFF, ORIGIN]) {
    const s = await screen(t, { params: { section: 'history' } });
    await s.press('historyAddAction');
    s.controls.beforeStorage = async (operation, key) => {
      if (operation === 'set' && key === blockedKey) throw Error('disk full');
    };
    await s.press('iosMessageHistoryStartAfterAdding');
    assert.deepEqual(s.urls, [HISTORY_URL]);
    assert.equal(s.values.has(HANDOFF), false, blockedKey);
    assert.equal(s.values.has(ORIGIN), false, blockedKey);
    assert.equal(s.saved().returnToOnboarding, true);
    assert.ok(s.button('iosMessageRetrySetup'));
  }
});

test('failed history run clears its handoff and reports a run failure rather than an installation failure', async t => {
  const s = await screen(t, { params: { section: 'history' } });
  await s.press('historyAddAction');
  s.controls.beforeOpen = async url => { if (url.startsWith('shortcuts:')) throw Error('run failed'); };
  await s.press('iosMessageHistoryStartAfterAdding');
  assert.equal(s.values.has(HANDOFF), false);
  assert.equal(s.values.has(ORIGIN), false);
  assert.equal(s.saved().historyShortcutConfirmed, true);
  assert.ok(s.button('historyStartAction'));
  assert.ok(s.text().includes(s.copy.t('iosLocalShortcutRunFailed')),
    'A failed run needs run recovery copy; the Shortcut has already been added.');
});

test('history double start and returning from Shortcuts never start a second extraction', async t => {
  const pending = deferred();
  const s = await screen(t, { params: { section: 'history' } });
  await s.press('historyAddAction');
  s.controls.beforeOpen = url => url.startsWith('shortcuts:') ? pending.promise : undefined;
  const start = s.button('iosMessageHistoryStartAfterAdding');
  start.onPress(); start.onPress(); await s.flush();
  const marker = s.values.get(HANDOFF);
  await s.foreground(5);
  assert.equal(s.urls.filter(url => url.includes('run-shortcut')).length, 1);
  pending.resolve(); await s.flush();
  await s.press('historyContinueAction');
  assert.equal(s.urls.at(-1), 'shortcuts://');
  assert.equal(s.values.get(HANDOFF), marker);
  assert.equal(s.chunksRead, 0);
  assert.equal(s.saved().historyStatus, 'in-progress');
  assert.ok(s.text().includes(s.copy.t('iosMessageHistoryRunningHelp')));
});

test('proof callback success cannot fabricate first SMS and error callback gets actionable feedback', async t => {
  const s = await screen(t, { progress: { futureShortcutConfirmed: true, futureAutomationConfirmed: true } });
  await s.press('iosMessageRunPermissionCheck');
  await s.callback('success');
  assert.equal(s.saved().futureStatus, 'in-progress');
  assert.equal(s.nativeStatus.firstCapturedAt, null);
  assert.ok(s.button('iosMessageRunPermissionCheck'));
  await s.callback('error');
  assert.ok(s.text().includes('The Shortcut did not finish the setup check.'),
    'Apple x-error return must explain that the Shortcut failed instead of silently showing the same guide.');
  await s.foreground(2);
  assert.ok(s.text().includes('The Shortcut did not finish the setup check.'),
    'Foreground notifications after the callback must not erase the failure before the user retries.');
  const repair = s.all().find(n => n.type === 'Button' && n.props.label === 'Add the correct Shortcut');
  assert.ok(repair, 'repair must be on the failed step, not buried in Help');
  repair.props.onPress(); await s.flush();
  assert.ok(s.urls.some(url => url.startsWith('https://www.icloud.com/shortcuts/')));
  assert.equal(s.nativeStatus.firstCapturedAt, null);
});

test('canceled proof and unknown callbacks preserve retry without inventing capture or completing onboarding', async t => {
  const s = await screen(t, { progress: { futureShortcutConfirmed: true, futureAutomationConfirmed: true } });
  await s.press('iosMessageRunPermissionCheck');
  for (const callback of ['cancel', 'unknown', '', 'success']) {
    await s.callback(callback); await s.foreground(2);
    // A stopped check says so instead of silently showing the same step.
    if (callback === 'cancel') assert.ok(s.text().includes('Check was stopped — run it again when ready.'));
    assert.equal(s.saved().futureStatus, 'in-progress');
    assert.equal(s.nativeStatus.firstCapturedAt, null);
    assert.equal(s.onboarded, false);
    assert.ok(s.button('iosMessageRunPermissionCheck'));
  }
});

test('native proof, real first-alert receipt, and lost native readiness remain visibly distinct', async t => {
  const s = await screen(t, { progress: { futureAutomationConfirmed: true }, nativeStatus: proven });
  const row = () => s.all().find(node => node.type === 'ChecklistRow' && node.props.title === s.copy.t('iosMessageFutureTitle')).props;
  assert.equal(row().status, 'complete');
  assert.equal(s.nativeStatus.firstCapturedAt, null);
  assert.notEqual(row().detail, s.copy.t('iosLocalFirstAlertCaptured'));
  s.nativeStatus.firstCapturedAt = Date.now(); await s.foreground();
  assert.equal(row().detail, s.copy.t('iosLocalFirstAlertCaptured'));
  assert.ok(s.announcements.includes(s.copy.t('iosLocalFirstAlertCaptured')));
  s.controls.beforeStatus = async () => { throw Error('native unavailable'); };
  await s.foreground();
  assert.notEqual(row().status, 'complete');
  assert.ok(s.text().includes(s.copy.t('iosLocalUpdateRequired')));
  assert.equal(s.button('iosMessageContinue'), undefined);
});

test('canceling reset preserves the original handoff and any protected session', async t => {
  const handoff = Date.now() - 1000;
  const s = await screen(t, { params: { section: 'history' }, handoff,
    progress: { historyShortcutConfirmed: true, historyStatus: 'in-progress' } });
  await s.help('iosMessageResetHistory');
  s.controls.recover = async () => ({ sessionId: 'protected_history_original' });
  await s.confirm('iosMessageResetHistory', true);
  assert.deepEqual(s.discards, []);
  assert.equal(s.values.get(HANDOFF), String(handoff));
  assert.equal(s.saved().historyStatus, 'in-progress');
});

test('reset confirmation cannot discard a newer history attempt created while the sheet is open', async t => {
  const handoff = Date.now() - 2000, replacement = Date.now() - 100;
  const s = await screen(t, { params: { section: 'history' }, handoff,
    progress: { historyShortcutConfirmed: true, historyStatus: 'in-progress' } });
  await s.help('iosMessageResetHistory');
  s.values.set(HANDOFF, String(replacement));
  s.controls.recover = async () => ({ sessionId: 'protected_history_new_attempt' });
  await s.confirm('iosMessageResetHistory');
  assert.deepEqual(s.discards, [], 'The confirmation was for the earlier attempt, not a newer protected session.');
  assert.equal(s.values.get(HANDOFF), String(replacement));
  assert.equal(s.saved().historyStatus, 'in-progress');
});

for (const key of ['iosMessageResetHistory', 'iosMessageSkipHistory']) {
  test(`foreground refresh must not retarget an already-open ${key} confirmation`, async t => {
    const handoff = Date.now() - 2000, replacement = Date.now() - 100;
    const s = await screen(t, { params: { section: 'history' }, handoff, nativeStatus: proven,
      progress: { futureAutomationConfirmed: true, historyShortcutConfirmed: true, historyStatus: 'in-progress' } });
    if (key === 'iosMessageResetHistory') await s.help(key);
    else await s.press(key);
    s.values.set(HANDOFF, String(replacement));
    await s.foreground();
    s.controls.recover = async () => ({ sessionId: 'protected_history_after_foreground' });
    await s.confirm(key);
    assert.deepEqual(s.discards, [], `${key}: confirmation consent belongs to the attempt shown when opened.`);
    assert.equal(s.values.get(HANDOFF), String(replacement));
    assert.equal(s.saved().historyStatus, 'in-progress');
  });
}

test('reset lookup or native discard failure preserves markers and exposes retry', async t => {
  for (const failure of ['recover', 'discard']) {
    const handoff = Date.now() - 1000;
    const s = await screen(t, { params: { section: 'history' }, handoff,
      progress: { historyShortcutConfirmed: true, historyStatus: 'in-progress' } });
    await s.help('iosMessageResetHistory');
    s.controls.recover = async () => { if (failure === 'recover') throw Error('locked'); return { sessionId: 'protected_history_retry' }; };
    s.controls.beforeDiscard = async () => { throw Error('locked'); };
    await s.confirm('iosMessageResetHistory');
    assert.equal(s.values.get(HANDOFF), String(handoff));
    assert.equal(s.values.get(ORIGIN), 'onboarding');
    assert.equal(s.saved().historyStatus, 'in-progress');
    assert.ok(s.text().includes(s.copy.t('historyCancelCleanupFailed')));
    assert.ok(s.button('iosMessageRetrySetup'));
  }
});

test('expired completed history opens explicit review without discarding, reading, or claiming saved SMS', async t => {
  const handoff = Date.now() - 3_600_100;
  const s = await screen(t, { params: { section: 'history' }, handoff,
    progress: { historyStatus: 'in-progress' },
    controls: { recover: async () => ({ sessionId: 'protected_history_late_result' }) } });
  assert.equal(s.routes.at(-1)[1].pathname, '/import-sms');
  assert.equal(s.routes.at(-1)[1].params.history, 'protected_history_late_result');
  assert.deepEqual(s.discards, []);
  assert.equal(s.chunksRead, 0);
  assert.equal(s.saved().historyStatus, 'in-progress');
  assert.equal(s.values.get(ORIGIN), 'onboarding');
});

test('expired history with failed native lookup retains recovery and successful retry can recover', async t => {
  const handoff = Date.now() - 3_600_100;
  const s = await screen(t, { params: { section: 'history' }, handoff,
    progress: { historyStatus: 'in-progress' }, controls: { recover: async () => { throw Error('locked'); } } });
  assert.equal(s.values.get(HANDOFF), String(handoff));
  assert.equal(s.routes.length, 0);
  assert.ok(s.text().includes(s.copy.t('historySetupStateFailed')));
  s.controls.recover = async () => ({ sessionId: 'protected_history_after_unlock' });
  await s.press('iosMessageRetrySetup');
  assert.equal(s.routes.at(-1)[1].params.history, 'protected_history_after_unlock');
});

test('deferral cancel and stale confirmation cannot disable capture or dispose a newer handoff', async t => {
  const s = await screen(t, { progress: { futureAutomationConfirmed: true }, nativeStatus: proven });
  await s.section('history');
  await s.press('iosMessageSkipHistory');
  await s.confirm('iosMessageSkipHistory', true);
  assert.equal(s.saved().historySkippedForNow, undefined);
  assert.deepEqual(s.receipts, []);
  await s.press('iosMessageSkipHistory');
  const replacement = Date.now(); s.values.set(HANDOFF, String(replacement));
  await s.confirm('iosMessageSkipHistory');
  assert.equal(s.values.get(HANDOFF), String(replacement));
  assert.equal(s.saved().historySkippedForNow, undefined);
  assert.deepEqual(s.discards, []);
  assert.ok(s.text().includes(s.copy.t('iosMessageSkipHistoryChanged')));
});

test('failed initial durable save cannot leave onboarding and can finish after retry', async t => {
  const s = await screen(t, { progress: ready, nativeStatus: proven,
    controls: { beforeDurable: async () => { throw Error('disk full'); } } });
  await s.press('iosMessageContinue');
  assert.equal(s.onboarded, false);
  assert.equal(s.saved().returnToOnboarding, true);
  assert.deepEqual(s.routes, []);
  assert.deepEqual(s.growth, []);
  assert.ok(s.text().includes(s.copy.t('iosMessageFinishFailed')));
  s.controls.beforeDurable = undefined;
  await s.press('iosMessageContinue');
  assert.equal(s.onboarded, true);
  assert.equal(s.saved().returnToOnboarding, false);
  assert.equal(s.routes.at(-1)[1], '/');
  assert.equal(s.growth.length, 1);
});

test('failed final durable save locks back navigation until a successful finish retry', async t => {
  const s = await screen(t, { progress: ready, nativeStatus: proven,
    controls: { beforeDurable: async count => { if (count >= 2) throw Error('disk full'); } } });
  await s.press('iosMessageContinue');
  assert.equal(s.onboarded, true, 'The store updates in memory before its second durable save.');
  assert.equal(s.saved().returnToOnboarding, true);
  assert.equal(s.button('back').disabled, true);
  assert.deepEqual(s.routes, []);
  assert.deepEqual(s.growth, []);
  const route = s.all().find(node => node.type === 'StackScreen');
  assert.equal(route.props.options.gestureEnabled, false);
  s.controls.beforeDurable = undefined;
  await s.press('iosMessageContinue');
  assert.equal(s.saved().returnToOnboarding, false);
  assert.equal(s.routes.at(-1)[1], '/');
  assert.equal(s.receipts.filter(receipt => receipt[0] === 'onboarded').length, 1);
});

test('repeated Finish while persistence is pending produces a single completion and route', async t => {
  const pending = deferred();
  const s = await screen(t, { progress: ready, nativeStatus: proven,
    controls: { beforeDurable: () => pending.promise } });
  const finish = s.button('iosMessageContinue'); finish.onPress(); finish.onPress();
  await s.flush();
  assert.equal(s.button('back').disabled, true);
  assert.equal(s.durableCalls, 1);
  pending.resolve(); await s.flush();
  assert.equal(s.routes.length, 1);
  assert.equal(s.growth.length, 1);
  assert.equal(s.receipts.filter(receipt => receipt[0] === 'onboarded').length, 1);
});

test('failed progress restore remains actionable and retries without silently finishing', async t => {
  let fail = true;
  const s = await screen(t, { controls: { beforeStorage: async (_op, key) => {
    if (fail && key === PROGRESS) throw Error('unavailable');
  } } });
  assert.ok(s.text().includes(s.copy.t('historySetupStateFailed')));
  assert.equal(s.onboarded, false);
  assert.deepEqual(s.urls, []);
  fail = false;
  await s.press('iosMessageRetrySetup');
  assert.ok(s.button('iosLocalInstallShortcut'));
  assert.deepEqual(s.routes, []);
  assert.equal((await s.progress.loadIosMessageSetupProgress()).returnToOnboarding, true,
    'Retry after a failed onboarding-started write must restore the onboarding return context.');
});

test('retrying an action failure preserves the section selected after the initial deep link', async t => {
  const s = await screen(t, { params: { section: 'history' } });
  await s.press('iosMessageNextFuture');
  s.controls.beforeOpen = async () => { throw Error('offline'); };
  await s.press('iosLocalInstallShortcut');
  assert.equal(s.saved().activeSection, 'future');
  s.controls.beforeOpen = undefined;
  await s.press('iosMessageRetrySetup');
  assert.equal(s.saved().activeSection, 'future',
    'Only failed initialization should replay the requested section; ordinary retry retains the current step.');
});

const labelled = (s, label) => s.all().find(n => n.type === 'Button' && n.props.label === label)?.props;
const futureRow = s => s.all().find(n => n.type === 'ChecklistRow' && n.props.title === s.copy.t('iosMessageFutureTitle')).props;

test('a working v2 setup is shown as one upgrade card, not a broken setup, until its owner starts', async t => {
  const s = await screen(t, { bundled: true, progress: ready, nativeStatus: { ...proven, setupProofAt: Date.now() - 60_000 } });
  assert.ok(s.all().some(n => n.props?.testID === 'ios-capture-upgrade'));
  assert.ok(labelled(s, 'Update Shortcut'));
  assert.equal(s.button('iosLocalInstallShortcut'), undefined, 'no unexplained "Add the Shortcut" step');
  assert.deepEqual([futureRow(s).status, futureRow(s).detail], ['complete', 'Working · update available']);
  await s.foreground(2);
  assert.equal(s.saved().futureStatus, 'complete', 'no downgraded status is written before the owner starts');
  assert.equal(s.saved().futureAutomationConfirmed, true, 'Home keeps reporting the working setup');
});

test('replacing v2 requires v3 installation, a fresh v3 check and re-pointing the existing automation', async t => {
  const s = await screen(t, { bundled: true, progress: ready,
    nativeStatus: { ...proven, setupProofAt: Date.now() - 60_000, firstCapturedAt: Date.now() - 60_000 } });
  labelled(s, 'Update Shortcut').onPress(); await s.flush();
  assert.equal(s.urls[0], 'file:///app/Wafra%20Capture%20v3.shortcut');
  assert.equal(s.saved().futureAutomationConfirmed, true, 'starting the update never flips Home');
  assert.equal(s.saved().futureAutomationRelink, true);
  labelled(s, 'I added it — run setup check').onPress(); await s.flush();
  assert.ok(s.button('iosMessageRunPermissionCheck'));
  assert.equal(s.urls.length, 2, 'confirmation starts the setup check');
  assert.equal(new URL(s.urls[1]).searchParams.get('name'), 'Wafra Capture v3');
  await s.callback('success');
  assert.ok(s.button('iosMessageRunPermissionCheck'), 'old v2 receipt cannot prove the v3 run');
  s.nativeStatus.setupProofVersion = 3; s.nativeStatus.setupProofAt = Date.now() + 1; await s.callback('success');
  // Proven, but the old automation still runs the old Shortcut: point it at v3.
  assert.ok(labelled(s, 'Edit an existing automation'));
  assert.equal(s.button('iosMessageContinue'), undefined);
  labelled(s, 'I updated the automation').onPress(); await s.flush();
  assert.equal(s.saved().futureAutomationRelink, undefined);
  assert.equal(s.saved().futureShortcutVersion, 3);
  assert.ok(s.button('iosMessageContinue'));
  assert.equal(s.onboarded, false);
});

test('reinstalling keeps the confirmed automation; a stopped check cannot reuse the older proof', async t => {
  const provenAt = Date.now() - 60_000;
  const s = await screen(t, { bundled: true,
    progress: { ...ready, futureShortcutVersion: 3, futureAutomationConfirmedAt: provenAt },
    nativeStatus: { enabled: true, setupProofVersion: 3, setupProofAt: provenAt } });
  assert.ok(s.button('iosMessageContinue'));
  await s.help('iosMessageAddAgain');
  assert.equal(s.saved().futureAutomationConfirmed, true, 'Home is unchanged until a new check succeeds');
  assert.ok(Number.isSafeInteger(s.saved().futureAttemptStartedAt));
  labelled(s, 'I added it — run setup check').onPress(); await s.flush();
  await s.callback('cancel');
  assert.ok(s.text().includes('Check was stopped — run it again when ready.'));
  assert.ok(s.button('iosMessageRunPermissionCheck'), 'the older proof is not the result of this attempt');
  assert.equal(s.button('iosMessageContinue'), undefined);
  assert.equal(s.saved().futureAutomationConfirmed, true);
  s.nativeStatus.setupProofAt = Date.now() + 1; await s.callback('success');
  assert.ok(s.button('iosMessageContinue'), 'a new successful check restores the finished setup without re-confirming');
});

test('returning from the Shortcuts share sheet runs the setup check once, without another tap', async t => {
  const s = await screen(t, { bundled: true });
  await s.press('iosLocalInstallShortcut');
  assert.equal(s.urls.length, 1);
  await s.foreground(); // The share sheet closing is not a return from Shortcuts.
  assert.equal(s.urls.length, 1);
  await s.leaveAndReturn();
  assert.equal(s.urls.length, 2);
  assert.equal(new URL(s.urls[1]).searchParams.get('name'), 'Wafra Capture v3');
  assert.equal(s.saved().futureShortcutConfirmed, true);
  await s.leaveAndReturn();
  assert.equal(s.urls.length, 2, 'the automatic check runs once per install');
});

test('automation step leads with Open Shortcuts and says honestly how the automation is verified', async t => {
  const s = await screen(t, { bundled: true, progress: { futureShortcutConfirmed: true, futureShortcutVersion: 3 },
    nativeStatus: { enabled: true, setupProofVersion: 3, setupProofAt: Date.now() - 1000 } });
  const buttons = s.all().filter(n => n.type === 'Button');
  const open = buttons.find(n => n.props.label === 'Open Shortcuts'), done = buttons.find(n => n.props.label === 'I set it up');
  assert.ok(open && done);
  assert.equal(open.props.variant, undefined, 'Open Shortcuts is the primary action');
  assert.equal(done.props.variant, 'outline');
  assert.ok(buttons.indexOf(open) < buttons.indexOf(done));
  await s.press('iosLocalAutomationAdded');
  assert.equal(futureRow(s).detail, 'Setup checked. Wafra will confirm the automation when your next message arrives.');
  // A message from the automation after the confirmation is real evidence it fires.
  s.nativeStatus.lastReceivedAt = s.saved().futureAutomationConfirmedAt + 5; await s.foreground();
  assert.equal(futureRow(s).detail, 'Automation verified — a new message reached Wafra.');
  // An Apple Pay receipt on the shared queue clock is not Message evidence.
  s.nativeStatus.lastApplePayReceivedAt = s.nativeStatus.lastReceivedAt; await s.foreground();
  assert.equal(futureRow(s).detail, 'Setup checked. Wafra will confirm the automation when your next message arrives.');
});

test('a failed check overrides an already-open automation review guide', async t => {
  const s = await screen(t, { progress: ready, nativeStatus: proven });
  await s.help('iosMessageReviewAutomation');
  assert.ok(s.all().some(n => n.type === 'AutomationGuide'));
  await s.help('iosMessageRunPermissionCheck');
  await s.callback('error');
  assert.equal(s.all().some(n => n.type === 'AutomationGuide'), false);
  assert.ok(s.all().some(n => n.type === 'Button' && n.props.label === 'Add the correct Shortcut'));
  assert.match(s.text(), /did not finish the setup check/);
});


test('Apple Pay is a secondary option below SMS and merely opening it keeps a finished SMS setup', async t => {
  const s = await screen(t, { knownBanks: [], applePayCaptureSupported: true, bundled: true,
    progress: { futureShortcutConfirmed: true, futureShortcutVersion: 3, futureAutomationConfirmed: true, futureStatus: 'complete' },
    nativeStatus: { enabled: true, setupProofVersion: 3, setupProofAt: Date.now() - 1000 } });
  const nodes = s.all();
  const other = nodes.findIndex(n => n.props?.testID === 'ios-setup-other-sources');
  assert.ok(other > nodes.findIndex(n => n.props?.testID === 'ios-message-setup-checklist'), 'other sources come after the SMS checklist');
  const action = nodes.find(n => n.type === 'Button' && n.props.label === 'Set up Apple Pay');
  assert.ok(action); action.props.onPress(); await s.flush();
  assert.equal(s.saved().futureCaptureSource, undefined);
  assert.equal(s.saved().futureShortcutConfirmed, true);
  assert.equal(s.saved().futureAutomationConfirmed, true);
  assert.equal(s.saved().futureShortcutVersion, 3);
  assert.equal(s.saved().futureStatus, 'complete');
  assert.equal(s.routes.at(-1)[1].pathname, '/ios-apple-pay-setup');
  assert.deepEqual(s.store.state.knownBanks, []);
  assert.equal(s.receipts.some(r => r[0] === 'enabled'), false, 'opening Apple Pay setup changes no native capture state');
});
test('Apple Pay onboarding requires its own proof and manual automation confirmation', async t => {
  for (const proven of [false, true]) {
    const s = await screen(t, { knownBanks: [], applePayCaptureSupported: true, bundled: true,
      nativeStatus: { enabled: true, setupProofVersion: 3, firstCapturedAt: Date.now(),
        ...(proven ? { applePaySetupProofAt: Date.now() } : {}) },
      progress: { futureCaptureSource: 'apple-pay', futureAutomationConfirmed: true, historyStatus: 'complete' } });
    assert.equal(s.all().some(n => n.props?.testID === 'ios-message-setup-banks'), false);
    if (proven) { await s.press('iosMessageContinue'); assert.equal(s.onboarded, true); }
    else { assert.equal(s.button('iosMessageContinue'), undefined); assert.equal(s.onboarded, false); }
  }
});

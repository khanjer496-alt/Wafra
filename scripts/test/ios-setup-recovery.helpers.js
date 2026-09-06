// Exercise the real route/controller/progress reducer with only platform and
// React-host boundaries replaced. The assertions cover user actions and state,
// not source spelling or callback mock counts.
module.exports = async ({ execute, ok, eq, translated }) => {
  const disposers = [];
  const makeScreen = async ({ available = true, progress: restored = {}, historyAvailable = true, historyInFlight = false, captureOptOut = false, optInFails = false, params = { fromOnboarding: '1' } } = {}) => {
    const slots = [];
    const effects = [];
    let cursor = 0;
    const slot = (initial) => slots[cursor++] ?? (slots[cursor - 1] = initial());
    const react = {
      useState(initial) {
        const state = slot(() => ({ value: typeof initial === 'function' ? initial() : initial }));
        return [state.value, (next) => { state.value = typeof next === 'function' ? next(state.value) : next; }];
      },
      useRef: (value) => slot(() => ({ current: value })),
      useCallback(callback, deps) {
        const memo = slot(() => ({}));
        if (!memo.deps || deps.some((value, index) => value !== memo.deps[index])) {
          memo.deps = deps;
          memo.value = callback;
        }
        return memo.value;
      },
      useEffect(effect, deps) {
        const memo = slot(() => ({}));
        if (!memo.deps || deps.some((value, index) => value !== memo.deps[index])) {
          memo.deps = deps;
          effects.push(() => { memo.cleanup?.(); memo.cleanup = effect(); });
        }
      },
    };
    // These recovery scenarios deliberately restore the Future section. New
    // installations use History first, covered in the journey regression suite.
    react.useMemo = (factory, deps) => react.useCallback(factory, deps)();
    const defaults = {
      version: 1, activeSection: 'future', futureShortcutConfirmed: false,
      futureAutomationConfirmed: false, futureStatus: 'not-started',
      historyShortcutConfirmed: false, historyStatus: 'not-started', returnToOnboarding: params.fromOnboarding === '1',
    };
    const values = new Map([['wafra/ios-message-setup-progress/v1', JSON.stringify({ ...defaults, ...restored })]]);
    const startedAt = Date.now();
    if (historyInFlight) {
      values.set('wafra/ios-history-handoff-started-at/v1', String(startedAt));
      values.set('wafra/ios-history-return-origin/v1', 'onboarding');
    }
    const storage = {
      async getItem(key) { return values.get(key) ?? null; },
      async setItem(key, value) { values.set(key, value); },
      async removeItem(key) { values.delete(key); },
    };
    const urls = [];
    const preferenceEvents = [];
    let optedOut = captureOptOut;
    const routes = [];
    let onboarded = false;
    const foregroundListeners = [];
    const nativeStatus = { enabled: false, entitled: true, setupProofVersion: null, firstCapturedAt: null };
    let statusFailure = false;
    const native = {
      async getCaptureStatus() { if (statusFailure) throw new Error('unavailable'); return { ...nativeStatus }; },
      async setCaptureEnabled(value) { preferenceEvents.push(`native:${value}`); nativeStatus.enabled = value; },
      async recoverCompletedSession() { return null; },
      async getCompletedSession() { return null; },
      async readChunk() { return []; },
      async discardSession() {},
    };
    const linking = {
      async canOpenURL() { return available; },
      async openURL(url) { urls.push(url); },
    };
    const platform = {
      Platform: { OS: 'ios', Version: '26.6' }, Linking: linking,
      AppState: { addEventListener(_name, listener) { foregroundListeners.push(listener); return { remove() {} }; } },
      AccessibilityInfo: { announceForAccessibility() {} },
      ScrollView: 'ScrollView', View: 'View', Pressable: 'Pressable',
      StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
    };
    const history = execute('src/lib/ios-history-setup.ts', { '@react-native-async-storage/async-storage': storage });
    const progress = execute('src/lib/ios-message-onboarding.ts', {
      '@react-native-async-storage/async-storage': storage, './ios-history-setup': history,
    });
    const protocol = execute('src/lib/ios-local-capture-protocol.ts');
    const controller = execute('src/lib/ios-capture-setup.ts', {
      'react-native': platform,
      '@/lib/capture': { getIosCaptureNativeModule: () => native, subscribeIosCaptureStatusRefresh: () => () => {} },
      '@/lib/ios-local-capture-protocol': protocol,
    });
    const router = { replace: (route) => routes.push(route), push: (route) => routes.push(route), back() {}, canGoBack: () => true, setParams() {} };
    const store = {
      state: { accounts: [], transactions: [], language: 'en' },
      ensureDurable: async () => {},
      setOnboarded() { onboarded = true; },
      async setCaptureOptOut(value) {
        preferenceEvents.push(`opt-out:${value}`);
        optedOut = value; // The real store dispatches before persistence.
        if (optInFails) throw new Error('storage failed');
        preferenceEvents.push('preference-saved');
      },
    };
    const jsx = (type, props) => ({ type, props: props ?? {} });
    const details = execute('src/components/ios-message-setup/details-sheet.tsx', {
      'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
      'react-native': platform,
      '@/components/themed-text': { ThemedText: 'ThemedText' },
      '@/components/ui/controls': { Button: 'Button' },
      '@/components/ui/bottom-sheet': { BottomSheet: 'BottomSheet' },
      '@/constants/theme': { Spacing: {} },
      '@/lib/i18n': execute('src/lib/i18n.ts'),
    }).DetailsSheet;
    const component = execute('src/app/ios-setup.tsx', {
      react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
      'react-native': platform,
      'expo-router': { Stack: { Screen: 'StackScreen' }, useRouter: () => router, useLocalSearchParams: () => params },
      'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
      '@/components/ios-message-setup/checklist-row': { ChecklistRow: 'ChecklistRow' },
      '@/components/ios-message-setup/details-sheet': { DetailsSheet: 'DetailsSheet' },
      '@/components/ios-message-setup/automation-guide': { AutomationGuide: 'AutomationGuide' },
      '@/components/themed-text': { ThemedText: 'ThemedText' },
      '@/components/themed-view': { ThemedView: 'ThemedView' },
      '@/components/ui/controls': { Button: 'Button' },
      '@/components/ui/confirm-sheet': { ConfirmSheet: 'ConfirmSheet' },
      '@/components/ui/layout': { Block: 'Block' },
      '@/components/ui/screen-header': { ScreenHeader: 'ScreenHeader' },
      '@/constants/theme': { Spacing: {}, Radius: {}, ScreenPadding: 20, MaxContentWidth: 600 },
      '@/hooks/use-large-text-layout': { useLargeTextLayout: () => false },
      '@/hooks/use-theme': { useTheme: () => ({}) },
      '@/hooks/use-language': { useLanguage: () => 'en' },
      '@/components/ios-message-setup/setup-journey': { IosSetupJourney: 'IosSetupJourney' },
      '@/lib/ios-setup-journey': execute('src/lib/ios-setup-journey.ts'),
      '@/lib/i18n': execute('src/lib/i18n.ts'),
      '@/lib/ios-capture-setup': { ...controller, createIosCaptureSetup: (options) => controller.createIosCaptureSetup({
        ...options, dependencies: { shortcutUrl: 'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef' },
      }) },
      '@/lib/ios-history-setup': { ...history, historyShortcutInstallUrl: () => 'https://www.icloud.com/shortcuts/abcdef0123456789abcdef0123456789' },
      '@/lib/ios-message-onboarding': progress,
      '@/lib/store': { useStore: () => store },
      '../../modules/wafra-message-history': historyAvailable ? native : {},
    }).default;
    let tree;
    const settle = async () => {
      for (let count = 0; count < 8; count += 1) {
        cursor = 0;
        tree = component();
        while (effects.length) effects.shift()();
        await new Promise((resolve) => setImmediate(resolve));
      }
    };
    const all = () => {
      const result = [];
      const visit = (node) => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (node === null || typeof node !== 'object') return;
        if ((node.type === 'DetailsSheet' || node.type === 'BottomSheet') && !node.props.visible) return;
        result.push(node);
        if (node.type === 'DetailsSheet') { visit(details(node.props)); return; }
        if (node.type === 'ChecklistRow' && !node.props.expanded) return;
        visit(node.props?.children);
      };
      visit(tree);
      return result;
    };
    const button = (key) => {
      const label = translated(key, 'en');
      const nodes = all();
      const rendered = nodes.find((node) => (node.type === 'Button' && node.props.label === label) ||
        (node.type === 'Pressable' && node.props.accessibilityLabel === label));
      if (rendered) return rendered;
      const header = nodes.find((node) => node.type === 'ScreenHeader');
      const action = [header?.props.back, ...(header?.props.actions ?? [])].find((item) => item?.label === label);
      return action ? { type: 'Button', props: action } : undefined;
    };
    const press = async (key) => { const action = button(key); if (!action || action.props.disabled) return false; await action.props.onPress(); await settle(); return true; };
    const foreground = async () => { foregroundListeners.forEach((listener) => listener('active')); await settle(); };
    await settle();
    disposers.push(() => slots.forEach((memo) => memo.cleanup?.()));
    return { all, button, press, urls, routes, nativeStatus, foreground, native, values, preferenceEvents,
      optedOut: () => optedOut,
      help: async (key) => { await press('iosMessageLearnMore'); return press(key); },
      onboarded: () => onboarded,
      confirmReset: async () => {
        const sheet = all().find((node) => node.type === 'ConfirmSheet' && node.props.visible);
        if (!sheet) return false;
        sheet.props.onConfirm();
        await settle();
        return true;
      },
      failStatus: () => { statusFailure = true; },
      selectHistory: async () => { all().find((node) => node.type === 'ChecklistRow' && node.props.title === translated('iosMessagePastTitle', 'en')).props.onPress(); await settle(); },
      saved: () => JSON.parse(values.get('wafra/ios-message-setup-progress/v1')),
      handoffPreserved: () => values.get('wafra/ios-history-handoff-started-at/v1') === String(startedAt) &&
        values.get('wafra/ios-history-return-origin/v1') === 'onboarding',
    };
  };

  const future = await makeScreen();
  await future.press('iosLocalInstallShortcut');
  await future.foreground(); // User canceled installation in Apple Shortcuts.
  ok('iOS recovery: canceled future install can open the published link again',
    await future.help('iosMessageAddAgain') && future.urls.length === 2);
  eq('iOS recovery: opening a canceled install again never confirms installation', future.saved().futureShortcutConfirmed, false);

  const wordyHistory = await makeScreen({ params: { section: 'history' }, progress: { historyStatus: 'in-progress' } });
  const words = wordyHistory.all().flatMap((node) => {
    if (node.type === 'ChecklistRow' && !node.props.expanded) return [node.props.title, node.props.detail];
    if (node.type === 'ScreenHeader') return [node.props.title, node.props.subtitle, ...(node.props.actions ?? []).map((action) => action.label)];
    if (node.type === 'ThemedText' && typeof node.props.children === 'string') return [node.props.children];
    if (node.type === 'Button') return [node.props.label];
    return [];
  }).join(' ').split(/\s+/).filter(Boolean).length;
  ok('iOS setup: history installation fits a short screen instead of a wall of copy', words <= 70);

  const history = await makeScreen();
  await history.selectHistory();
  await history.press('historyAddAction');
  await history.foreground();
  ok('iOS recovery: canceled history install can open the published link again',
    await history.help('iosMessageAddAgain') && history.urls.length === 2);
  eq('iOS recovery: reopening history installation does not start protected history', history.saved().historyShortcutConfirmed, false);

  const missing = await makeScreen({ available: false });
  await missing.press('iosLocalInstallShortcut');
  ok('iOS recovery: missing Shortcuts offers an actionable App Store recovery',
    await missing.press('iosInstallShortcuts') && missing.urls[0] === 'https://apps.apple.com/app/shortcuts/id1462947752');

  const noHistoryBridge = await makeScreen({ historyAvailable: false, progress: { historyShortcutConfirmed: true } });
  await noHistoryBridge.selectHistory();
  eq('iOS recovery: absent history native actions block the long-running handoff',
    await noHistoryBridge.press('historyStartAction'), false);
  eq('iOS recovery: unavailable history cannot complete required setup',
    await noHistoryBridge.press('iosMessageContinue'), false);
  eq('iOS recovery: unavailable history preserves onboarding return state', noHistoryBridge.saved().returnToOnboarding, true);

  const missingHistoryShortcuts = await makeScreen({ available: false });
  await missingHistoryShortcuts.selectHistory();
  await missingHistoryShortcuts.press('historyAddAction');
  ok('iOS recovery: missing Shortcuts on the history path also opens App Store recovery',
    await missingHistoryShortcuts.press('iosInstallShortcuts') && missingHistoryShortcuts.urls[0] === 'https://apps.apple.com/app/shortcuts/id1462947752');

  const runningHistory = await makeScreen({ historyInFlight: true });
  await runningHistory.selectHistory();
  await runningHistory.press('historyContinueAction');
  eq('iOS recovery: continuing a running history opens Shortcuts without launching another import', runningHistory.urls, ['shortcuts://']);
  ok('iOS recovery: continuing history preserves the original timestamp and return origin', runningHistory.handoffPreserved());
  eq('iOS recovery: active history does not offer a competing new import', await runningHistory.press('historyStartAction'), false);

  const skipped = await makeScreen({ progress: { futureStatus: 'skipped', historyStatus: 'skipped' } });
  ok('iOS recovery: individual statuses describe setup without a misleading aggregate score',
    !skipped.all().some((node) => node.props.accessibilityRole === 'progressbar'));
  eq('iOS recovery: skipped choices retain individual truthful statuses',
    skipped.all().filter((node) => node.type === 'ChecklistRow').map((node) => node.props.status), ['skipped', 'skipped']);

  const disabled = await makeScreen({ progress: { futureShortcutConfirmed: true, futureAutomationConfirmed: true, futureStatus: 'complete' } });
  eq('iOS recovery: disabled native capture cannot leave a completed Future row',
    disabled.all().find((node) => node.type === 'ChecklistRow' && node.props.title === translated('iosMessageFutureTitle', 'en')).props.status, 'in-progress');
  disabled.nativeStatus.enabled = true;
  disabled.nativeStatus.setupProofVersion = 1;
  await disabled.foreground();
  eq('iOS recovery: harmless native proof restores readiness after enable',
    disabled.all().find((node) => node.type === 'ChecklistRow' && node.props.title === translated('iosMessageFutureTitle', 'en')).props.status, 'complete');
  disabled.failStatus();
  await disabled.foreground();
  eq('iOS recovery: a failed native refresh cannot keep advertising readiness',
    disabled.all().find((node) => node.type === 'ChecklistRow' && node.props.title === translated('iosMessageFutureTitle', 'en')).props.status, 'in-progress');
  const directHistory = await makeScreen({ params: { section: 'history' } });
  eq('iOS setup: a Settings history link opens the requested section without starting onboarding',
    [directHistory.saved().activeSection, directHistory.urls.length, directHistory.saved().returnToOnboarding], ['history', 0, false]);

  const installAndRun = await makeScreen({ params: { section: 'history' } });
  await installAndRun.press('historyAddAction');
  await installAndRun.foreground();
  ok('iOS setup: after adding history, one explicit action confirms and starts import',
    await installAndRun.press('iosMessageHistoryStartAfterAdding'));
  eq('iOS setup: explicit start records installation before handing off to Apple',
    [installAndRun.saved().historyShortcutConfirmed, installAndRun.urls.filter((url) => url.startsWith('shortcuts://x-callback-url/')).length], [true, 1]);

  const proofOnly = await makeScreen({ progress: { historyStatus: 'complete' } });
  proofOnly.nativeStatus.enabled = true;
  proofOnly.nativeStatus.setupProofVersion = 1;
  await proofOnly.foreground();
  eq('iOS setup: local proof cannot bypass user automation confirmation',
    [!!proofOnly.button('iosMessageContinue'), proofOnly.saved().futureStatus, proofOnly.onboarded()],
    [false, 'not-started', false]);
  ok('iOS setup: local proof keeps the automation confirmation action reachable',
    !!proofOnly.button('iosLocalAutomationAdded'));

  const ready = await makeScreen({ progress: { futureAutomationConfirmed: true } });
  ready.nativeStatus.enabled = true;
  ready.nativeStatus.setupProofVersion = 1;
  await ready.foreground();
  ok('iOS setup: future-ready users can choose history as their next action',
    await ready.press('iosMessageNextHistory') && ready.saved().activeSection === 'history');
  eq('iOS setup: future capture alone cannot finish onboarding before history',
    await ready.press('iosMessageContinue'), false);
  await ready.button('iosMessageContinue')?.props.onPress(); // Exercise the callback even if a caller bypasses disabled UI.
  eq('iOS setup: guarded completion rejects incomplete history even when invoked directly',
    [ready.saved().futureStatus, ready.saved().historyStatus, ready.saved().returnToOnboarding, ready.onboarded()],
    ['complete', 'not-started', true, false]);

  const skippedHistory = await makeScreen({ progress: { historyStatus: 'skipped' } });
  skippedHistory.nativeStatus.enabled = true;
  skippedHistory.nativeStatus.setupProofVersion = 1;
  await skippedHistory.foreground();
  eq('iOS setup: previously skipped history does not satisfy required setup',
    await skippedHistory.press('iosMessageContinue'), false);

  const bothReady = await makeScreen({ progress: { historyStatus: 'complete', futureAutomationConfirmed: true } });
  bothReady.nativeStatus.enabled = true;
  bothReady.nativeStatus.setupProofVersion = 1;
  await bothReady.foreground();
  ok('iOS setup: completed history and ready future capture can finish onboarding',
    await bothReady.press('iosMessageContinue'));
  eq('iOS setup: completing both preserves history completion and durably finishes onboarding',
    [bothReady.saved().historyStatus, bothReady.saved().returnToOnboarding, bothReady.onboarded(), bothReady.routes.at(-1)],
    ['complete', false, true, '/']);

  const historyOnly = await makeScreen({ progress: { historyStatus: 'complete' } });
  eq('iOS setup: history alone cannot finish without future capture setup',
    await historyOnly.press('iosMessageContinue'), false);

  const stopped = await makeScreen({ historyInFlight: true, params: { section: 'history' }, progress: { historyShortcutConfirmed: true } });
  await stopped.help('iosMessageResetHistory');
  ok('iOS setup: resetting a stopped import needs an explicit confirmation', stopped.handoffPreserved());
  ok('iOS setup: a stopped import exposes the reset confirmation', await stopped.confirmReset());
  eq('iOS setup: confirmed reset clears the handoff and restores history import without changing future setup',
    [stopped.values.has('wafra/ios-history-handoff-started-at/v1'), stopped.values.has('wafra/ios-history-return-origin/v1'), !!stopped.button('historyStartAction'), stopped.saved().futureStatus],
    [false, false, true, 'not-started']);

  const cleanupFailure = await makeScreen({ historyInFlight: true, params: { section: 'history' } });
  cleanupFailure.native.recoverCompletedSession = async () => ({ sessionId: 'protected_history' });
  cleanupFailure.native.discardSession = async () => { throw new Error('locked'); };
  await cleanupFailure.help('iosMessageResetHistory');
  ok('iOS setup: cleanup failure is exercised through the real reset action', await cleanupFailure.confirmReset());
  ok('iOS setup: failed cleanup preserves the recovery marker and withholds competing imports',
    cleanupFailure.handoffPreserved() && !cleanupFailure.button('historyStartAction'));
  const resetting = await makeScreen({ historyInFlight: true, params: { section: 'history' } });
  let finishDiscard;
  const discardPending = new Promise((resolve) => { finishDiscard = resolve; });
  resetting.native.recoverCompletedSession = async () => ({ sessionId: 'resetting_history' });
  resetting.native.discardSession = async () => discardPending;
  await resetting.help('iosMessageResetHistory');
  await resetting.confirmReset();
  await resetting.foreground();
  eq('iOS setup: foreground recovery cannot navigate into a history session being discarded', resetting.routes, []);
  finishDiscard();
  await resetting.foreground();
  eq('iOS setup: a refresh waiting for reset rereads the cleared handoff',
    [resetting.routes, resetting.values.has('wafra/ios-history-handoff-started-at/v1')], [[], false]);

  const expiryRace = await makeScreen({ historyInFlight: true, params: { section: 'history' }, progress: { historyShortcutConfirmed: true } });
  expiryRace.values.set('wafra/ios-history-handoff-started-at/v1', String(Date.now() - 3_600_001));
  let finishExpiry;
  const expiryPending = new Promise((resolve) => { finishExpiry = resolve; });
  let recoveries = 0;
  expiryRace.native.recoverCompletedSession = async () => ++recoveries === 1 ? expiryPending : null;
  await expiryRace.foreground();
  await expiryRace.help('iosMessageResetHistory');
  await expiryRace.confirmReset();
  eq('iOS setup: reset waits for already-running expiry recovery before allowing restart',
    await expiryRace.press('historyStartAction'), false);
  finishExpiry(null);
  await expiryRace.foreground();
  await expiryRace.press('historyStartAction');
  ok('iOS setup: a new handoff survives an older expiry reconciliation',
    Number(expiryRace.values.get('wafra/ios-history-handoff-started-at/v1')) > Date.now() - 30_000);

  const fromSettings = await makeScreen({ params: {}, progress: { futureStatus: 'in-progress', historyStatus: 'not-started', returnToOnboarding: false } });
  ok('iOS setup: Back leaves incomplete setup without claiming completion',
    await fromSettings.press('back'));
  eq('iOS setup: Settings Done preserves incomplete choices without finishing onboarding',
    [fromSettings.saved().futureStatus, fromSettings.saved().historyStatus, fromSettings.onboarded()],
    ['in-progress', 'not-started', false]);
  const manualToAutomatic = await makeScreen({ captureOptOut: true, progress: { futureShortcutConfirmed: true } });
  eq('iOS setup: opening setup never opts manual users into capture', manualToAutomatic.preferenceEvents, []);
  await manualToAutomatic.press('iosLocalAutomationAdded');
  eq('iOS setup: explicit automation confirmation saves opt-in before enabling native capture',
    manualToAutomatic.preferenceEvents, ['opt-out:false', 'preference-saved', 'native:true']);
  eq('iOS setup: a manual user can explicitly enable automatic capture',
    [manualToAutomatic.optedOut(), manualToAutomatic.nativeStatus.enabled], [false, true]);

  const failedOptIn = await makeScreen({ captureOptOut: true, optInFails: true, progress: { futureShortcutConfirmed: true } });
  await failedOptIn.press('iosLocalAutomationAdded');
  eq('iOS setup: failed preference save cannot enable capture or run its check',
    [failedOptIn.nativeStatus.enabled, failedOptIn.urls, failedOptIn.saved().futureAutomationConfirmed],
    [false, [], false]);

  const compactHelp = await makeScreen({ params: { section: 'history' } });
  await compactHelp.press('iosMessageLearnMore');
  const helpCopy = compactHelp.all().filter((node) => node.type === 'ThemedText' && typeof node.props.children === 'string')
    .map((node) => node.props.children).join(' ');
  ok('iOS setup: Help is concise and omits internal algorithms and test-run stories',
    helpCopy.split(/\s+/).length <= 100 && !/bounded halves|overlap|2,374/.test(helpCopy));
  const privacyHelp = await makeScreen();
  await privacyHelp.press('iosMessageLearnMore');
  const hasPrivacy = () => privacyHelp.all().some((node) => node.type === 'ThemedText' && node.props.children === translated('iosLocalPrivacyBody', 'en'));
  eq('iOS setup: detailed retention copy is collapsed by default', hasPrivacy(), false);
  ok('iOS setup: Privacy details reveals the exact retention and legacy information',
    await privacyHelp.press('iosMessagePrivacyDetails') && hasPrivacy() &&
    privacyHelp.all().some((node) => node.props.children === translated('iosLocalMigrationBody', 'en')));
  await privacyHelp.press('iosMessagePrivacyDetails');
  eq('iOS setup: privacy disclosure collapses without changing capture consent',
    [hasPrivacy(), privacyHelp.preferenceEvents], [false, []]);
  disposers.forEach((dispose) => dispose());

};

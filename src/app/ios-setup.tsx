import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState as RNAppState,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChecklistRow } from '@/components/ios-message-setup/checklist-row';
import { AutomationGuide } from '@/components/ios-message-setup/automation-guide';
import { DetailsSheet } from '@/components/ios-message-setup/details-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button, Chip } from '@/components/ui/controls';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Block } from '@/components/ui/layout';
import { SetupShell, SetupHeader } from '@/components/onboarding/setup-shell';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { t, tf, type StringKey } from '@/lib/i18n';
import { IOS_LOCAL_CAPTURE_SHORTCUT_NAME } from '@/lib/ios-local-capture-protocol';
import { iosShortcutSetupCopy } from '@/lib/ios-shortcut-setup-copy';
import { knownBankOptions } from '@/lib/known-banks';
import {
  completeIosMessageOnboardingAttempt,
  createIosCaptureSetup,
  INITIAL_IOS_SETUP_MODEL,
  iosSupportsNotificationAutomation,
  resolveIosSelectedReadiness,
  resolveIosFutureSetupStep,
  type IosSetupFailure,
  type IosSetupIntent,
} from '@/lib/ios-capture-setup';
import {
  beginIosHistoryHandoffForOrigin,
  cancelIosHistoryHandoff,
  clearIosHistoryHandoff,
  clearIosHistoryReturnOrigin,
  confirmIosHistoryShortcutInstalled,
  historyShortcutContinueUrl,
  historyShortcutInstallUrl,
  historyShortcutRunUrl,
  iosSupportsMessageHistory,
  iosHistorySetupStorageCoordinator,
  IOS_HISTORY_HANDOFF_MARKER,
  IOS_HISTORY_SHORTCUT_NAME,
  IOS_HISTORY_HANDOFF_TTL_MS,
  loadIosHistorySetup,
  reconcileIosHistorySetup,
  recoverIosHistoryHandoff,
} from '@/lib/ios-history-setup';
import {
  dispatchIosMessageSetup,
  loadIosMessageSetupProgress,
  type IosMessageSetupEvent,
  type IosMessageSetupProgress,
} from '@/lib/ios-message-onboarding';
import { GROWTH_PLACEMENTS, trackGrowthEvent } from '@/lib/growth-funnel';
import {
  onboardingHistoryGap,
  onboardingInsightKeys,
  onboardingLandingPath,
  onboardingProfileAtStage,
} from '@/lib/onboarding';
import { useStore } from '@/lib/store';
import { useLanguage } from '@/hooks/use-language';
import { canFinishIosMessageSetup, futureSetupConfigured, iosSetupJourneyCopy } from '@/lib/ios-setup-journey';
import {
  pagedHistoryEnabled,
  pagedHistoryCopy,
  parsePagedHistoryProgress,
  type PagedHistoryProgress,
} from '@/lib/ios-paged-setup';

const INITIAL_PROGRESS: IosMessageSetupProgress = {
  version: 1,
  activeSection: 'future',
  futureShortcutConfirmed: false,
  futureAutomationConfirmed: false,
  futureStatus: 'not-started',
  historyShortcutConfirmed: false,
  historyStatus: 'not-started',
  returnToOnboarding: false,
};

const historyNativeModule = async () =>
  (await import('../../modules/wafra-message-history')).default;

const failureCopy = (failure: Exclude<IosSetupFailure, null>): string => {
  switch (failure) {
    case 'shortcut-install':
      return t('iosLocalShortcutInstallFailed');
    case 'shortcut-run':
      return t('iosLocalShortcutRunFailed');
    case 'shortcuts-missing':
      return t('iosShortcutsMissing');
    case 'load':
    default:
      return t('iosLocalUpdateRequired');
  }
};

export default function IosSetupScreen() {
  const largeText = useLargeTextLayout();
  const router = useRouter();
  const params = useLocalSearchParams<{
    fromOnboarding?: string;
    shortcutResult?: string;
    notificationReturn?: string;
    section?: string;
  }>();
  const { state, ensureDurable, setOnboarded, setOnboardingProfile, setCaptureOptOut, setKnownBanks } = useStore();
  const language = useLanguage();
  const journeyCopy = iosSetupJourneyCopy(language);
  const shortcutCopy = iosShortcutSetupCopy(language);
  const onboardingInsight = onboardingInsightKeys(state.onboardingProfile?.focus ?? null);
  // The History Shortcut returns through `wafra://ios-setup?section=history`,
  // which cannot carry the onboarding query, and a deep link into the mounted
  // route replaces its params. First-run state is durable in the store, so
  // latch onboarding mode from it: losing the flag used to hide the manual
  // exit and turn Back into a loop through the onboarding gate's redirect.
  const onboardingLatch = useRef(false);
  if (params.fromOnboarding === '1' || (state.hydrated === true && state.onboarded === false)) {
    onboardingLatch.current = true;
  }
  const fromOnboarding = onboardingLatch.current;
  const requestedSection = params.section === 'history' || params.section === 'future'
    ? params.section : null;
  const historyReturnOrigin = fromOnboarding ? 'onboarding' : 'ios-setup';
  const historyInstallUrl = historyShortcutInstallUrl();
  const historySupported = Platform.OS === 'ios' &&
    iosSupportsMessageHistory(Platform.Version);
  const pagingCopy = pagedHistoryCopy[language === 'ar' ? 'ar' : 'en'];
  const controllerRef = useRef<ReturnType<typeof createIosCaptureSetup> | null>(null);
  const screenActive = useRef(true);
  const operationInFlight = useRef<Promise<void> | null>(null);
  const refreshGeneration = useRef(0);
  const consumedShortcutCallback = useRef<string | null>(null);
  const previousReadiness = useRef(INITIAL_IOS_SETUP_MODEL.readiness);
  const [rawSetup, setSetup] = useState(INITIAL_IOS_SETUP_MODEL);
  const pagedEnabled = historySupported && pagedHistoryEnabled(rawSetup.bundledHistorySupported === true);
  const [progress, setProgress] = useState(INITIAL_PROGRESS);
  const notificationMode = progress.futureCaptureSource === 'notification';
  const setup = { ...rawSetup, readiness: resolveIosSelectedReadiness(progress.futureCaptureSource, rawSetup, progress.futureShortcutVersion) };
  const offersNotifications = Platform.OS === 'ios' && iosSupportsNotificationAutomation(Platform.Version);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [historySetup, setHistorySetup] = useState({
    installed: false,
    handoffStartedAt: null as number | null,
  });
  const [pagedProgress, setPagedProgress] = useState<PagedHistoryProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [finishRetryRequired, setFinishRetryRequired] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [privacyExpanded, setPrivacyExpanded] = useState(false);
  const [shortcutsMissing, setShortcutsMissing] = useState(false);
  const [showAutomationGuide, setShowAutomationGuide] = useState(false);
  const [resetHistoryVisible, setResetHistoryVisible] = useState(false);
  const resetHistoryAttempt = useRef<number | null>(null);
  const [skipHistoryVisible, setSkipHistoryVisible] = useState(false);
  // "Which banks text you?": asked once before either section can start, because
  // iOS 26's Find Messages gives Wafra no sender and some banks never name
  // themselves in an alert, so this answer is what labels those accounts.
  // Skip hides it for this visit only; the answer itself persists in the ledger.
  const [banksSkipped, setBanksSkipped] = useState(false);
  const [bankPicks, setBankPicks] = useState<string[]>([]);
  const banksStep = !notificationMode && (state.knownBanks ?? []).length === 0 && !banksSkipped;
  const toggleBankPick = (name: string) => setBankPicks((picks) =>
    picks.includes(name) ? picks.filter((pick) => pick !== name) : [...picks, name]);
  const saveKnownBanks = () => { setKnownBanks(bankPicks); };
  const skipHistoryAttempt = useRef<number | null | undefined>(undefined);
  const setupInitialized = useRef(false);
  const futureReadyLabel = setup.readiness === 'first-alert-captured'
    ? t('iosLocalFirstAlertCaptured')
    : t('iosLocalWaitingTitle');
  const activeMessageCheckFailed = !notificationMode && progress.activeSection === 'future' &&
    (setup.failure === 'shortcut-run' || localError === t('iosLocalShortcutRunFailed'));
  const futureConfigured = !activeMessageCheckFailed && futureSetupConfigured(setup.readiness, progress.futureAutomationConfirmed);
  const setupComplete = !activeMessageCheckFailed && progressLoaded && !setup.loading &&
    canFinishIosMessageSetup(progress, setup.readiness);

  useEffect(() => {
    screenActive.current = true;
    return () => {
      screenActive.current = false;
      refreshGeneration.current += 1;
    };
  }, []);

  useEffect(() => {
    const controller = createIosCaptureSetup({ fromOnboarding });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setSetup);
    void controller.send({ type: 'load' });
    return () => {
      unsubscribe();
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [fromOnboarding]);

  const send = useCallback(
    (intent: IosSetupIntent): Promise<void> =>
      controllerRef.current?.send(intent) ?? Promise.resolve(),
    [],
  );

  const updateProgress = useCallback(
    async (event: IosMessageSetupEvent): Promise<IosMessageSetupProgress> => {
      const next = await dispatchIosMessageSetup(event);
      if (screenActive.current) setProgress(next);
      return next;
    },
    [],
  );

  const refreshSetup = useCallback(async (duringOperation = false): Promise<void> => {
    // Foreground/callback recovery must not reopen a session while reset is
    // discarding it. The explicit retry action may refresh inside its own lock.
    while (!duringOperation && operationInFlight.current) {
      await operationInFlight.current;
    }
    if (!screenActive.current) return;
    const generation = ++refreshGeneration.current;
    let restored: IosMessageSetupProgress;
    try {
      restored = await loadIosMessageSetupProgress();
    } catch {
      if (!screenActive.current || generation !== refreshGeneration.current) return;
      setProgressLoaded(true);
      setLocalError(t('historySetupStateFailed'));
      return;
    }
    if (!screenActive.current || generation !== refreshGeneration.current) return;
    setProgress(restored);
    setProgressLoaded(true);

    try {
      let nextHistory: Awaited<ReturnType<typeof loadIosHistorySetup>>;
      let recoveredSessionId: string | null = null;
      let nextPagedProgress: PagedHistoryProgress | null = null;
      if (historySupported) {
        const native = await historyNativeModule();
        if (!native || typeof native.getCompletedSession !== 'function' ||
          typeof native.recoverCompletedSession !== 'function' ||
          typeof native.readChunk !== 'function' || typeof native.discardSession !== 'function') {
          throw new Error('history_native_unavailable');
        }
        const reconciliation = await iosHistorySetupStorageCoordinator.run(
          () => reconcileIosHistorySetup({ native }),
        );
        nextHistory = reconciliation.snapshot;
        recoveredSessionId = reconciliation.recoveredSessionId;
        if (pagedEnabled && typeof native.getPagedStatus === 'function') {
          // The paged Shortcut says "open Wafra to check progress" when it
          // pauses. Source-free counts only; a malformed status reads as none.
          try {
            nextPagedProgress = parsePagedHistoryProgress(await native.getPagedStatus());
          } catch {
            nextPagedProgress = null;
          }
        }
      } else {
        nextHistory = await iosHistorySetupStorageCoordinator.run(() => loadIosHistorySetup());
      }
      if (!screenActive.current || generation !== refreshGeneration.current) return;
      setHistoryReady(historySupported);
      setHistorySetup({
        installed: nextHistory.installed,
        handoffStartedAt: nextHistory.handoffStartedAt,
      });
      setPagedProgress(nextPagedProgress);
      if (recoveredSessionId) {
        router.replace({
          pathname: '/import-sms',
          params: { history: recoveredSessionId },
        });
      }
    } catch {
      if (!screenActive.current || generation !== refreshGeneration.current) return;
      setHistoryReady(false);
      setLocalError(t('historySetupStateFailed'));
    }
  }, [historySupported, pagedEnabled, router]);

  // A navigation hint only: returning to the existing screen refreshes native
  // proof and saved progress. The URL itself cannot enable or confirm capture.
  useEffect(() => {
    if (params.notificationReturn) void refreshSetup();
  }, [params.notificationReturn, refreshSetup]);

  // `router.replace` from this pushed screen swaps it for a NEW tabs route
  // while the original tabs route stays at the stack root, so two tab
  // navigators end up mounted: two Home screens, doubled scans and a first
  // screen that flickers. Pop to the existing root and switch tabs there. A
  // cold deep-link launch with nothing beneath this screen keeps the replace.
  /**
   * Where setup lets go of the user.
   *
   * Normally the view they chose. But an iPhone has no completion screen in
   * the gate — setup exits straight into the app — so the statement offer that
   * Android shows there has nowhere to appear. For a bank that leaves no
   * history to read, this exit IS the offer: it finishes the sentence the
   * alert question started rather than dropping them on Home having been told
   * their past is missing and then shown nothing about it. One tap backs out.
   */
  const finishDestination = useCallback(() => (
    onboardingHistoryGap(state.onboardingProfile?.alerts)
      ? '/statement-import' as const
      : onboardingLandingPath(state.onboardingProfile?.focus ?? null)
  ), [state.onboardingProfile?.alerts, state.onboardingProfile?.focus]);

  const exitToRoot = useCallback((href: ReturnType<typeof onboardingLandingPath> | '/statement-import') => {
    if (router.canGoBack()) {
      router.dismissAll();
      router.navigate(href);
      return;
    }
    router.replace(href);
  }, [router]);

  useEffect(() => {
    let active = true;
    setupInitialized.current = false;
    void (async () => {
      try {
        if (fromOnboarding) {
          await dispatchIosMessageSetup({ type: 'onboarding-started' });
        }
        if (requestedSection) {
          await dispatchIosMessageSetup({ type: 'active-section-changed', section: requestedSection });
        }
        if (active) {
          setupInitialized.current = true;
          await refreshSetup();
        }
      } catch {
        if (active) {
          setProgressLoaded(true);
          setLocalError(t('historySetupStateFailed'));
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [fromOnboarding, requestedSection, refreshSetup]);

  useEffect(() => {
    const subscription = RNAppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void send({ type: 'refresh-status' });
      if (progress.activeSection === 'history' || progress.historyStatus !== 'not-started') {
        void refreshSetup();
      }
    });
    return () => subscription.remove();
  }, [progress.activeSection, progress.historyStatus, refreshSetup, send]);

  useEffect(() => {
    if (setup.loading) return;
    const result = params.shortcutResult;
    if (result === undefined) {
      consumedShortcutCallback.current = null;
      return;
    }
    if (result !== 'success' && result !== 'cancel' && result !== 'error') return;
    if (consumedShortcutCallback.current === result) return;
    consumedShortcutCallback.current = result;
    void (async () => {
      await send({ type: 'shortcut-callback', result });
      await refreshSetup();
      if (result === 'error' && screenActive.current &&
        controllerRef.current?.getModel().failure !== 'load') {
        // Foreground receipt refreshes can succeed even when the Shortcut
        // failed. Keep the error visible until the owner takes a retry action.
        setLocalError((current) => current ?? t('iosLocalShortcutRunFailed'));
      }
    })();
    router.setParams({ shortcutResult: undefined });
  }, [params.shortcutResult, refreshSetup, router, send, setup.loading]);

  useEffect(() => {
    if (setup.loading || !progressLoaded) return;
    // Stored completion describes a previous setup attempt. Native admission
    // can be disabled or unavailable later, so never present it as live proof.
    const status = futureConfigured
      ? 'complete'
      : progress.futureStatus === 'complete' ? 'in-progress' : progress.futureStatus;
    if (status === progress.futureStatus) return;
    void updateProgress({ type: 'future-status-changed', status }).catch(() => {
      if (screenActive.current) setLocalError(t('historySetupStateFailed'));
    });
  }, [futureConfigured, progress.futureStatus, progressLoaded, setup.loading, updateProgress]);

  useEffect(() => {
    if (
      previousReadiness.current !== setup.readiness &&
      setup.readiness !== 'not-added'
    ) {
      AccessibilityInfo.announceForAccessibility(futureReadyLabel);
    }
    previousReadiness.current = setup.readiness;
  }, [futureReadyLabel, setup.readiness]);

  useEffect(() => {
    if (setup.failure) {
      AccessibilityInfo.announceForAccessibility(failureCopy(setup.failure));
    }
  }, [setup.failure]);

  const runOperation = useCallback((
    operation: () => Promise<void>,
    errorMessage = t('historySetupStateFailed'),
  ): Promise<void> => {
    if (operationInFlight.current) return operationInFlight.current;
    refreshGeneration.current += 1;
    setBusy(true);
    setLocalError(null);
    const running = operation()
      .catch(() => {
        if (screenActive.current) setLocalError(errorMessage);
      })
      .finally(() => {
        operationInFlight.current = null;
        if (screenActive.current) setBusy(false);
      });
    operationInFlight.current = running;
    return running;
  }, []);

  const selectSection = useCallback((section: 'future' | 'history') => {
    void runOperation(async () => {
      setShowAutomationGuide(false);
      await updateProgress({ type: 'active-section-changed', section });
      if (section === 'history') await refreshSetup(true);
    });
  }, [refreshSetup, runOperation, updateProgress]);

  const installFutureShortcut = useCallback(() => {
    void runOperation(async () => {
      if (setup.shortcutVersion === 3) await updateProgress({ type: 'future-shortcut-install-started', version: 3 });
      else await updateProgress({ type: 'future-status-changed', status: 'in-progress' });
      await send({ type: 'install-shortcut' });
    });
  }, [runOperation, send, updateProgress, setup.shortcutVersion]);

  const confirmFutureShortcut = useCallback(() => {
    void runOperation(async () => {
      await updateProgress({ type: 'future-shortcut-confirmed', ...(setup.shortcutVersion ? { version: setup.shortcutVersion } : {}) });
      await send({ type: 'shortcut-added' });
      if (setup.shortcutVersion === 3) {
        await setCaptureOptOut(false);
        await send({ type: 'check-shortcut' });
      }
    });
  }, [runOperation, send, updateProgress, setup.shortcutVersion, setCaptureOptOut]);

  const checkFutureShortcut = useCallback(() => {
    void runOperation(async () => {
      await setCaptureOptOut(false);
      await updateProgress({ type: 'future-status-changed', status: 'in-progress' });
      await send({ type: 'check-shortcut' });
    }, t('capturePreferenceFailed'));
  }, [runOperation, send, setCaptureOptOut, updateProgress]);

  const openAutomation = useCallback(() => {
    void runOperation(async () => {
      await updateProgress({ type: 'future-status-changed', status: 'in-progress' });
      await send({ type: 'open-automation' });
    });
  }, [runOperation, send, updateProgress]);

  const openNotificationSetup = () => {
    void runOperation(async () => {
      await updateProgress({ type: 'future-source-changed', source: 'notification' });
      setShowAutomationGuide(false);
      router.push({ pathname: '/ios-notification-setup', params: { fromOnboarding: fromOnboarding ? '1' : undefined } });
    });
  };
  const chooseMessageCapture = () => {
    void runOperation(async () => {
      await updateProgress({ type: 'future-source-changed', source: 'message' });
    });
  };

  const confirmAutomation = useCallback(() => {
    void runOperation(async () => {
      await setCaptureOptOut(false);
      await updateProgress({ type: 'future-automation-confirmed' });
      await send({ type: 'automation-added' });
      setShowAutomationGuide(false);
    }, t('capturePreferenceFailed'));
  }, [runOperation, send, setCaptureOptOut, updateProgress]);

  const openHistoryInstall = useCallback(() => {
    if (!historyInstallUrl) return;
    void runOperation(async () => {
      // Open the public iCloud Shortcut share directly. Do not gate this on
      // canOpenURL('shortcuts://'): the scheme probe is not required for an
      // HTTPS install URL and can fail spuriously on real devices.
      setShortcutsMissing(false);
      await updateProgress({ type: 'history-status-changed', status: 'in-progress' });
      try {
        await Linking.openURL(historyInstallUrl);
      } catch (error) {
        await updateProgress({ type: 'history-status-changed', status: 'not-started' });
        throw error;
      }
    }, t('iosLocalShortcutInstallFailed'));
  }, [historyInstallUrl, runOperation, updateProgress]);

  const openHistoryRun = useCallback((newHandoff: boolean, confirmInstall = false) => {
    void runOperation(async () => {
      if (!await Linking.canOpenURL('shortcuts://')) {
        setShortcutsMissing(true);
        return;
      }
      setShortcutsMissing(false);
      if (confirmInstall) {
        await iosHistorySetupStorageCoordinator.run(async () => {
          await confirmIosHistoryShortcutInstalled();
        });
        await updateProgress({ type: 'history-shortcut-confirmed' });
        if (screenActive.current) {
          setHistorySetup((current) => ({ ...current, installed: true }));
        }
      }
      await updateProgress({ type: 'history-status-changed', status: 'in-progress' });
      const startedAt = Date.now();
      if (newHandoff) {
        await iosHistorySetupStorageCoordinator.run(async () => {
          await beginIosHistoryHandoffForOrigin(historyReturnOrigin, startedAt);
        });
      }
      try {
        // A handoff already in progress owns its native session and timestamp.
        // Reopening its run URL would start a second import, not resume Apple.
        await Linking.openURL(newHandoff ? historyShortcutRunUrl() : historyShortcutContinueUrl());
        if (newHandoff && screenActive.current) {
          setHistorySetup((current) => ({
            ...current,
            handoffStartedAt: startedAt,
          }));
        }
      } catch (error) {
        if (newHandoff) {
          await iosHistorySetupStorageCoordinator.run(async () => {
            await Promise.all([clearIosHistoryHandoff(), clearIosHistoryReturnOrigin()]);
          });
        }
        throw error;
      }
    }, t('iosLocalShortcutRunFailed'));
  }, [historyReturnOrigin, runOperation, updateProgress]);

  const resetStoppedHistory = useCallback(() => {
    const confirmedAttempt = resetHistoryAttempt.current;
    resetHistoryAttempt.current = null;
    setResetHistoryVisible(false);
    if (confirmedAttempt === null) return;
    void runOperation(async () => {
      const native = await historyNativeModule();
      const reset = await iosHistorySetupStorageCoordinator.run(async () => {
        // Read without expiring/clearing markers: this confirmation belongs
        // only to the attempt visible when the owner opened the sheet.
        const currentAttempt = await AsyncStorage.getItem(IOS_HISTORY_HANDOFF_MARKER);
        if (currentAttempt !== String(confirmedAttempt)) {
          if (screenActive.current) setLocalError(t('historySetupStateFailed'));
          return false;
        }
        await cancelIosHistoryHandoff({
          recover: () => recoverIosHistoryHandoff(confirmedAttempt, native),
          discard: (sessionId) => native.discardSession(sessionId),
          clearHandoff: async () => {
            await clearIosHistoryHandoff();
            await clearIosHistoryReturnOrigin();
          },
        });
        return true;
      });
      if (!reset) return;
      await updateProgress({ type: 'history-status-changed', status: 'not-started' });
      if (screenActive.current) {
        setHistorySetup((current) => ({ ...current, handoffStartedAt: null }));
      }
    }, t('historyCancelCleanupFailed'));
  }, [runOperation, updateProgress]);

  const skipHistory = useCallback(() => {
    const confirmedAttempt = skipHistoryAttempt.current;
    skipHistoryAttempt.current = undefined;
    setSkipHistoryVisible(false);
    if (confirmedAttempt === undefined) return;
    void runOperation(async () => {
      // Recheck the native action after the confirmation sheet. This choice
      // cannot enable capture or replace the owner's automation confirmation.
      await send({ type: 'refresh-status' });
      const current = await loadIosMessageSetupProgress();
      const readiness = resolveIosSelectedReadiness(current.futureCaptureSource, controllerRef.current?.getModel(), current.futureShortcutVersion);
      if (!futureSetupConfigured(readiness, current.futureAutomationConfirmed)) {
        if (screenActive.current) setLocalError(t('iosMessageFutureBeforeSkip'));
        return;
      }
      if (current.historyStatus === 'complete') return;
      const native = await historyNativeModule();
      await iosHistorySetupStorageCoordinator.run(async () => {
        const currentAttempt = await AsyncStorage.getItem(IOS_HISTORY_HANDOFF_MARKER);
        if (currentAttempt !== (confirmedAttempt === null ? null : String(confirmedAttempt))) {
          const startedAt = currentAttempt === null ? NaN : Number(currentAttempt);
          if (Number.isSafeInteger(startedAt) && startedAt >= 0 &&
            Date.now() - startedAt >= IOS_HISTORY_HANDOFF_TTL_MS) {
            // A late completed import can still be reviewed. Recover it
            // without expiring its marker or treating stale consent as
            // permission to delete the replacement attempt.
            const recovered = await recoverIosHistoryHandoff(startedAt, native);
            if (recovered !== null) {
              router.replace({ pathname: '/import-sms', params: { history: recovered } });
              return;
            }
          }
          if (screenActive.current) setLocalError(t('iosMessageSkipHistoryChanged'));
          return;
        }
        // Read the durable marker under the same lock used by import/reset.
        // An unavailable lookup must preserve recovery, including expired
        // handoffs whose completed protected session is still readable.
        const reconciliation = await reconcileIosHistorySetup({ native });
        if (screenActive.current) {
          setHistorySetup({
            installed: reconciliation.snapshot.installed,
            handoffStartedAt: reconciliation.snapshot.handoffStartedAt,
          });
        }
        if ((reconciliation.snapshot.expired || confirmedAttempt === null) &&
          reconciliation.recoveredSessionId !== null) {
          // Expiry hides the original timestamp from the visible snapshot.
          // A late completed session may belong to a different attempt than
          // the one confirmed here. Preserve it for explicit review/decline.
          router.replace({ pathname: '/import-sms', params: { history: reconciliation.recoveredSessionId } });
          return;
        }
        if (reconciliation.snapshot.handoffStartedAt !== null &&
          reconciliation.snapshot.handoffStartedAt !== confirmedAttempt) {
          if (screenActive.current) setLocalError(t('iosMessageSkipHistoryChanged'));
          return;
        }
        await cancelIosHistoryHandoff({
          recover: async () => reconciliation.recoveredSessionId,
          discard: (sessionId) => native.discardSession(sessionId),
          clearHandoff: async () => {
            await clearIosHistoryHandoff();
            await clearIosHistoryReturnOrigin();
          },
        });
        if (screenActive.current) {
          setHistorySetup((value) => ({ ...value, handoffStartedAt: null }));
        }
        await updateProgress({ type: 'history-skipped-for-now', readiness });
      });
    }, t('historyCancelCleanupFailed'));
  }, [router, runOperation, send, updateProgress]);

  const confirmSkipHistory = () => {
    skipHistoryAttempt.current = historySetup.handoffStartedAt;
    setSkipHistoryVisible(true);
  };

  const resumeHistory = useCallback(() => {
    void runOperation(async () => {
      await updateProgress({ type: 'history-status-changed', status: 'not-started' });
      await updateProgress({ type: 'active-section-changed', section: 'history' });
    });
  }, [runOperation, updateProgress]);

  useEffect(() => {
    const startedAt = historySetup.handoffStartedAt;
    if (startedAt === null || busy) return;
    const remaining = Math.max(0, startedAt + IOS_HISTORY_HANDOFF_TTL_MS - Date.now());
    const timer = setTimeout(() => void refreshSetup(), remaining);
    return () => clearTimeout(timer);
  }, [busy, historySetup.handoffStartedAt, refreshSetup]);

  const finish = useCallback(() => {
    if (!setupComplete) return;
    void runOperation(async () => {
      await send({ type: 'refresh-status' });
      const current = await loadIosMessageSetupProgress();
      if (screenActive.current) setProgress(current);
      if (!canFinishIosMessageSetup(current,
        resolveIosSelectedReadiness(current.futureCaptureSource, controllerRef.current?.getModel(), current.futureShortcutVersion))) return;
      if (fromOnboarding) {
        const onboardingFocus = state.onboardingProfile?.focus ?? null;
        const onboardingTracking = state.onboardingProfile?.tracking ?? null;
        // Keep every answer the profile already holds. Rebuilding it here is
        // what erased the alert-delivery and country answers on completion.
        setOnboardingProfile(
          onboardingProfileAtStage(state.onboardingProfile, 'complete', Date.now()),
        );
        const outcome = await completeIosMessageOnboardingAttempt({
          retryRequired: finishRetryRequired,
          ensureDurable,
          markFinished: async () => {
            await updateProgress({ type: 'onboarding-finished' });
          },
          markStarted: async () => {
            await updateProgress({ type: 'onboarding-started' });
          },
          setOnboarded,
        });
        if (outcome === 'retry-required') {
          if (screenActive.current) setFinishRetryRequired(true);
          throw new Error('ios_message_onboarding_finish_failed');
        }
        if (screenActive.current) setFinishRetryRequired(false);
        trackGrowthEvent('onboarding_completed', {
          focus: onboardingFocus,
          tracking: onboardingTracking,
          outcome: 'automatic',
          placement: GROWTH_PLACEMENTS.onboarding,
        });
        exitToRoot(finishDestination());
        return;
      }
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace('/');
    }, t('iosMessageFinishFailed'));
  }, [
    ensureDurable,
    exitToRoot,
    finishDestination,
    finishRetryRequired,
    fromOnboarding,
    setupComplete,
    router,
    runOperation,
    send,
    setOnboarded,
    setOnboardingProfile,
    state.onboardingProfile,
    updateProgress,
  ]);

  const continueWithoutAutomaticCapture = useCallback(() => {
    if (!fromOnboarding || busy || finishRetryRequired) return;
    void runOperation(async () => {
      // Manual entry is a valid product path, not a failure/recovery path.
      // Persist the opt-out first so no mounted capture worker can race the
      // navigation. Native disable is best-effort; the durable store flag is
      // the authority used by the app after this point.
      await setCaptureOptOut(true);
      try { await send({ type: 'manual-only' }); } catch { /* durable opt-out already wins */ }
      await iosHistorySetupStorageCoordinator.run(async () => {
        // Do not delete a partially staged history import here. Just stop the
        // onboarding redirect from owning it; the 24h native staging expiry or
        // an explicit later review/discard will clean it up safely.
        await Promise.all([clearIosHistoryHandoff(), clearIosHistoryReturnOrigin()]);
      });

      const onboardingFocus = state.onboardingProfile?.focus ?? null;
      const onboardingTracking = state.onboardingProfile?.tracking ?? null;
      // Same here: preserve the answers rather than reconstructing the profile.
      setOnboardingProfile(
        onboardingProfileAtStage(state.onboardingProfile, 'complete', Date.now()),
      );
      const outcome = await completeIosMessageOnboardingAttempt({
        retryRequired: finishRetryRequired,
        ensureDurable,
        markFinished: async () => {
          await updateProgress({ type: 'onboarding-finished' });
        },
        markStarted: async () => {
          await updateProgress({ type: 'onboarding-started' });
        },
        setOnboarded,
      });
      if (outcome === 'retry-required') {
        if (screenActive.current) setFinishRetryRequired(true);
        throw new Error('ios_message_onboarding_manual_finish_failed');
      }
      if (screenActive.current) setFinishRetryRequired(false);
      trackGrowthEvent('onboarding_completed', {
        focus: onboardingFocus,
        tracking: onboardingTracking,
        outcome: 'manual',
        placement: GROWTH_PLACEMENTS.onboarding,
      });
      exitToRoot(finishDestination());
    }, t('iosMessageFinishFailed'));
  }, [
    busy,
    ensureDurable,
    exitToRoot,
    finishDestination,
    finishRetryRequired,
    fromOnboarding,
    runOperation,
    send,
    setCaptureOptOut,
    setOnboarded,
    setOnboardingProfile,
    state.onboardingProfile,
    updateProgress,
  ]);

  const leave = useCallback(async () => {
    if (busy || finishRetryRequired) return;
    await runOperation(async () => {
      if (fromOnboarding) {
        await updateProgress({ type: 'onboarding-return-cleared' });
        // Do not walk back through every Shortcut/iCloud handoff that happened
        // during setup. Return to the root once and let the onboarding gate
        // show the previous product step exactly once.
        exitToRoot('/');
        return;
      }
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace('/');
    });
  }, [busy, exitToRoot, finishRetryRequired, fromOnboarding, router, runOperation, updateProgress]);

  const failedMessageCheck = !notificationMode && (setup.failure === 'shortcut-run' || localError === t('iosLocalShortcutRunFailed'));
  const futureStep = failedMessageCheck ? 'prove-shortcut' : setup.failure === 'shortcut-install' &&
    !progress.futureShortcutConfirmed
    ? 'add-shortcut'
    : resolveIosFutureSetupStep(progress, setup.readiness, notificationMode ? undefined : setup.shortcutVersion);
  const futureStatus = !setup.loading && !futureConfigured && progress.futureStatus === 'complete'
    ? 'in-progress' : progress.futureStatus;
  const error = localError ?? (setup.failure ? failureCopy(setup.failure) : null);
  const shortcutCheckFailed = progress.activeSection === 'future' && failedMessageCheck;
  const shortcutName = setup.shortcutName ?? IOS_LOCAL_CAPTURE_SHORTCUT_NAME;
  const historyConfirmed = progress.historyShortcutConfirmed || historySetup.installed;
  const historyRunning = historySetup.handoffStartedAt !== null;
  const historyComplete = progress.historyStatus === 'complete';
  const historyDeferred = progress.historyStatus === 'skipped' && progress.historySkippedForNow === true;
  const showingAutomation = !failedMessageCheck && (futureStep === 'create-automation' || showAutomationGuide);

  const openHelp = () => {
    setPrivacyExpanded(false);
    setDetailsVisible(true);
  };

  const primaryAction = (): { label: StringKey; onPress(): void; disabled?: boolean } => {
    if (setupComplete && !showAutomationGuide) {
      return { label: fromOnboarding ? 'iosMessageContinue' : 'iosMessageDone', onPress: finish };
    }
    if (progress.activeSection === 'history') {
      if (historyComplete) return { label: 'iosMessageNextFuture', onPress: () => selectSection('future') };
      if (pagedEnabled) return { label: 'historyStartAction', onPress: () => router.push({ pathname: '/ios-paging-beta', params: { origin: historyReturnOrigin } }) };
      if (!historySupported || !historyReady || !historyInstallUrl) {
        return { label: 'iosMessageLearnMore', onPress: openHelp };
      }
      if (historyRunning) return { label: 'historyContinueAction', onPress: () => openHistoryRun(false) };
      if (historyConfirmed) return { label: 'historyStartAction', onPress: () => openHistoryRun(true) };
      if (progress.historyStatus === 'in-progress') {
        return { label: 'iosMessageHistoryStartAfterAdding', onPress: () => openHistoryRun(true, true) };
      }
      return { label: 'historyAddAction', onPress: openHistoryInstall };
    }
    if (!setup.supported || setup.failure === 'load') {
      return { label: 'iosMessageLearnMore', onPress: openHelp };
    }
    if (notificationMode && !futureConfigured) return { label: 'iosNotificationSetupAction', onPress: openNotificationSetup };
    if (futureStep === 'add-shortcut') {
      return { label: 'iosLocalInstallShortcut', onPress: installFutureShortcut, disabled: !setup.shortcutAvailable };
    }
    if (futureStep === 'confirm-shortcut') return { label: 'iosLocalAlreadyAdded', onPress: confirmFutureShortcut };
    if (futureStep === 'prove-shortcut') return { label: 'iosMessageRunPermissionCheck', onPress: checkFutureShortcut };
    if (futureStep === 'ready' && !showAutomationGuide) {
      return { label: 'iosMessageSkipHistory', onPress: confirmSkipHistory };
    }
    return {
      label: progress.futureAutomationConfirmed ? 'iosMessageRetryCheck' : 'iosLocalAutomationAdded',
      onPress: confirmAutomation,
    };
  };
  const action = primaryAction();
  const showFooterAction = !showAutomationGuide && !banksStep && (
    setupComplete ||
    (futureConfigured && !historyComplete && !historyDeferred && progress.activeSection === 'future')
  );
  const helpActions: { label: string; onPress(): void }[] = [];
  if (progress.activeSection === 'future') {
    if (notificationMode) {
      helpActions.push({ label: t('iosNotificationSetupAction'), onPress: openNotificationSetup });
    } else if (setup.supported && setup.shortcutAvailable) {
      helpActions.push({ label: t('iosMessageAddAgain'), onPress: installFutureShortcut });
      helpActions.push({ label: t('iosMessageRunPermissionCheck'), onPress: checkFutureShortcut });
    }
    if (!notificationMode && futureStep === 'ready') {
      helpActions.push({ label: t('iosMessageReviewAutomation'), onPress: () => setShowAutomationGuide(true) });
    }
  } else if (pagedEnabled) {
    helpActions.push({ label: pagingCopy.title, onPress: () => {
      setDetailsVisible(false);
      router.push({ pathname: '/ios-paging-beta', params: { origin: historyReturnOrigin } });
    } });
  } else if (historyRunning) {
    helpActions.push({ label: t('iosMessageResetHistory'), onPress: () => {
      resetHistoryAttempt.current = historySetup.handoffStartedAt;
      setResetHistoryVisible(true);
    } });
  } else if (historyReady && historyInstallUrl) {
    helpActions.push({ label: t('iosMessageAddAgain'), onPress: openHistoryInstall });
    if (historyComplete) {
      helpActions.push({ label: t('iosMessageImportAgain'), onPress: () => openHistoryRun(true) });
    }
  }

  const onboardingPresentation = fromOnboarding || progress.returnToOnboarding;
  return (
    <SetupShell onboarding={onboardingPresentation}>
    <ThemedView style={[styles.root, onboardingPresentation && { backgroundColor: 'transparent' }]}>
      <Stack.Screen options={{ gestureEnabled: !fromOnboarding && !busy && !finishRetryRequired }} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          style={styles.scroll}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <SetupHeader
            onboarding={onboardingPresentation}
            title={t('iosMessageSetupHeading')}
            subtitle={t('iosMessageSetupSubtitle')}
            back={{ label: t('back'), onPress: leave, disabled: busy || finishRetryRequired }}
            actions={[{ label: t('iosMessageLearnMore'), onPress: openHelp, disabled: busy }]}
          />
          {offersNotifications && !notificationMode && (
            <Button label={t('iosNotificationSetupAction')} variant="outline" onPress={openNotificationSetup}
              disabled={busy || !progressLoaded || setup.loading} wrapLabel />
          )}
          {!progressLoaded || setup.loading ? (
            <ThemedText type="meta" themeColor="textSecondary">{t('stillLoading')}</ThemedText>
          ) : banksStep ? (
            <View testID="ios-message-setup-banks" style={styles.checklist}>
              <Block>
                <ThemedText type="subtitle">{t('iosBanksTitle')}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">{t('iosBanksBody')}</ThemedText>
                <View style={styles.bankChips} accessibilityRole="list">
                  {knownBankOptions(state.marketId).map((bank) => (
                    <Chip
                      key={bank.name}
                      label={bank.name}
                      active={bankPicks.includes(bank.name)}
                      onPress={() => toggleBankPick(bank.name)}
                    />
                  ))}
                </View>
                <ThemedText type="meta" themeColor="textSecondary">{tf('iosBanksSelected', { n: bankPicks.length })}</ThemedText>
                <Button label={t('iosBanksNext')} onPress={saveKnownBanks} disabled={busy || bankPicks.length === 0} wrapLabel />
                <Button label={t('iosBanksSkip')} variant="ghost" onPress={() => setBanksSkipped(true)} disabled={busy} wrapLabel />
              </Block>
            </View>
          ) : (
            <View testID="ios-message-setup-checklist" style={styles.checklist}>
              <ChecklistRow
                step={1}
                title={t('iosMessageFutureTitle')}
                detail={setup.readiness === 'first-alert-captured' ? futureReadyLabel
                  : futureConfigured ? journeyCopy.waiting : undefined}
                status={futureStatus}
                expanded={progress.activeSection === 'future'}
                onPress={() => selectSection('future')}>
                {notificationMode ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">{t('iosNotificationSetupSummary')}</ThemedText>
                    <Button label={t('iosNotificationSetupAction')} onPress={openNotificationSetup} disabled={busy} wrapLabel />
                    <Button label={t('iosNotificationChooseSms')} variant="ghost" onPress={chooseMessageCapture} disabled={busy} wrapLabel />
                  </>
                ) : !setup.supported ? (
                  <ThemedText type="small" themeColor="textSecondary">{t('iosLocalUnsupported')}</ThemedText>
                ) : setup.failure === 'load' ? (
                  <ThemedText type="small" themeColor="textSecondary">{t('iosLocalUpdateRequired')}</ThemedText>
                ) : showingAutomation ? (
                  <>
                    <ThemedText type="smallBold">{shortcutCopy.automate}</ThemedText>
                    <AutomationGuide shortcutName={shortcutName} />
                    <ThemedText type="small" themeColor="textSecondary">{shortcutCopy.existing}</ThemedText>
                    <Button label={t('iosLocalOpenAutomation')} variant="ghost" onPress={openAutomation} disabled={busy} wrapLabel />
                    <Button label={shortcutCopy.editExisting} variant="ghost"
                      onPress={() => void runOperation(() => send({ type: 'open-automation', existing: true }))} disabled={busy} wrapLabel />
                  </>
                ) : futureStep === 'prove-shortcut' ? (
                  <>
                    <ThemedText type="smallBold">{shortcutCopy.check}</ThemedText>
                    <ThemedText type="small">{shortcutCopy.checkBody}</ThemedText>
                    <ThemedText type="meta" themeColor="textSecondary">{`${shortcutCopy.name}: ${shortcutName}`}</ThemedText>
                    {shortcutCheckFailed ? <View testID="ios-shortcut-check-recovery" style={{ gap: Spacing.two }}>
                      <ThemedText accessibilityRole="alert" type="smallBold">{shortcutCopy.failed}</ThemedText>
                      <ThemedText type="small">{shortcutCopy.repairBody}</ThemedText>
                      <Button label={shortcutCopy.repair} onPress={installFutureShortcut} disabled={busy || !setup.shortcutAvailable} wrapLabel />
                      <Button label={shortcutCopy.retry} variant="outline" onPress={checkFutureShortcut} disabled={busy} wrapLabel />
                    </View> : <Button label={t('iosMessageRunPermissionCheck')} onPress={checkFutureShortcut} disabled={busy} wrapLabel />}
                    <ThemedText type="meta" themeColor="textSecondary">{shortcutCopy.checkNote}</ThemedText>
                    <Button label={shortcutCopy.permissions} variant="ghost" onPress={openHelp} disabled={busy} wrapLabel />
                  </>
                ) : futureStep === 'add-shortcut' || futureStep === 'confirm-shortcut' ? (
                  <>
                    <ThemedText type="smallBold">{shortcutCopy.add}</ThemedText>
                    <ThemedText type="meta" themeColor="textSecondary">{`${shortcutCopy.name}: ${shortcutName}`}</ThemedText>
                    {setup.shortcutVersion === 3 && <ThemedText type="small">{shortcutCopy.bundled}</ThemedText>}
                    <ThemedText type="small" themeColor="textSecondary">
                      {tf(!setup.shortcutAvailable ? 'iosLocalShortcutUnavailable'
                        : futureStep === 'add-shortcut' ? 'iosMessageFutureInstallHelp' : 'iosMessageFutureReturnHelp',
                      { shortcut: shortcutName })}
                    </ThemedText>
                    <Button
                      label={futureStep === 'confirm-shortcut' && setup.shortcutVersion === 3 ? shortcutCopy.addedCheck
                        : t(futureStep === 'add-shortcut' ? 'iosLocalInstallShortcut' : 'iosLocalAlreadyAdded')}
                      onPress={futureStep === 'add-shortcut' ? installFutureShortcut : confirmFutureShortcut}
                      disabled={busy || (futureStep === 'add-shortcut' && !setup.shortcutAvailable)}
                      wrapLabel
                    />
                    {futureStep === 'confirm-shortcut' && <Button label={t('iosMessageAddAgain')} variant="ghost"
                      onPress={installFutureShortcut} disabled={busy || !setup.shortcutAvailable} wrapLabel />}
                  </>
                ) : null}
                {!notificationMode && showingAutomation && (
                  <Button
                    label={t(progress.futureAutomationConfirmed ? 'iosMessageRetryCheck' : 'iosLocalAutomationAdded')}
                    onPress={confirmAutomation}
                    disabled={busy}
                    wrapLabel
                  />
                )}
                {futureConfigured && !historyComplete && !historyDeferred && !showAutomationGuide && (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">{t('iosMessageFutureReadyChoice')}</ThemedText>
                    <Button label={t('iosMessageNextHistory')} variant="ghost"
                      onPress={() => selectSection('history')} disabled={busy} wrapLabel />
                  </>
                )}
              </ChecklistRow>
              <ChecklistRow
                step={2}
                title={t('iosMessagePastTitle')}
                detail={historyComplete ? t('iosMessageHistoryDone')
                  : historyDeferred ? t('iosMessageHistoryDeferred') : undefined}
                status={progress.historyStatus}
                expanded={progress.activeSection === 'history'}
                onPress={() => selectSection('history')}>
                {historyDeferred ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">{t('iosMessageHistoryDeferredHelp')}</ThemedText>
                    <Button label={t('iosMessageResumeHistory')} variant="ghost" onPress={resumeHistory} disabled={busy} wrapLabel />
                  </>
                ) : pagedEnabled ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">{pagingCopy.intro}</ThemedText>
                    {pagedProgress ? (
                      <View testID="ios-setup-paged-progress" accessibilityLiveRegion="polite" style={styles.progress}>
                        <ThemedText type="smallBold">
                          {`${pagedProgress.checked.toLocaleString()} · ${pagingCopy.counts}`}
                        </ThemedText>
                        <ThemedText type="meta" themeColor="textSecondary">
                          {`${pagedProgress.accepted.toLocaleString()} ${pagingCopy.accepted} · ${pagedProgress.skipped.toLocaleString()} ${pagingCopy.skipped}`}
                        </ThemedText>
                        <ThemedText type="meta" themeColor="textSecondary">
                          {pagedProgress.status === 'complete' ? pagingCopy.completed : pagingCopy.paused}
                        </ThemedText>
                      </View>
                    ) : (
                      <ThemedText type="meta" themeColor="textSecondary">
                        {historyRunning ? pagingCopy.paused : pagingCopy.runningHelp}
                      </ThemedText>
                    )}
                    <Button
                      label={pagedProgress?.status === 'complete' ? pagingCopy.review
                        : pagedProgress || historyRunning ? pagingCopy.resume : pagingCopy.start}
                      variant="ghost"
                      onPress={() => {
                        if (pagedProgress?.status === 'complete') {
                          router.push({ pathname: '/import-sms', params: { history: pagedProgress.sessionId } });
                          return;
                        }
                        router.push({ pathname: '/ios-paging-beta', params: { origin: historyReturnOrigin } });
                      }}
                      disabled={busy}
                      wrapLabel
                    />
                  </>
                ) : !historySupported || !historyReady || !historyInstallUrl ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t(!historySupported ? 'historyRequiresIos26'
                      : !historyReady ? 'iosLocalUpdateRequired' : 'historyInstallUnavailable')}
                  </ThemedText>
                ) : !historyComplete ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      {tf(historyRunning ? 'iosMessageHistoryRunningHelp'
                        : historyConfirmed ? 'iosMessageHistoryStartHelp'
                          : progress.historyStatus === 'in-progress' ? 'iosMessageHistoryReturnHelp' : 'iosMessageHistoryInstallHelp',
                      { shortcut: IOS_HISTORY_SHORTCUT_NAME })}
                    </ThemedText>
                    <ThemedText type="meta" themeColor="textSecondary">
                      {!historyRunning && !historyConfirmed
                        ? t('iosMessageHistoryStartHelp') : journeyCopy.historyRequest}
                    </ThemedText>
                    {!historyRunning && (
                      // One hint line, not a third and fourth grey paragraph
                      // above the button; both facts read as one instruction.
                      <ThemedText type="meta" themeColor="textSecondary" style={styles.hints}>
                        {`${t('iosMessageHistoryKeepOpen')} · ${t('iosMessagePastTiming')}`}
                      </ThemedText>
                    )}
                    <Button
                      label={t(historyRunning ? 'historyContinueAction'
                        : historyConfirmed ? 'historyStartAction'
                          : progress.historyStatus === 'in-progress'
                            ? 'iosMessageHistoryStartAfterAdding' : 'historyAddAction')}
                      onPress={historyRunning ? () => openHistoryRun(false)
                        : historyConfirmed ? () => openHistoryRun(true)
                          : progress.historyStatus === 'in-progress'
                            ? () => openHistoryRun(true, true) : openHistoryInstall}
                      disabled={busy}
                      wrapLabel
                    />
                  </>
                ) : null}
                {!historyComplete && !historyDeferred && (
                  <>
                    {!futureConfigured && <Button label={t('iosMessageNextFuture')} variant="ghost"
                      onPress={() => selectSection('future')} disabled={busy} wrapLabel />}
                    <Button label={t('iosMessageSkipHistory')} variant="ghost"
                      onPress={confirmSkipHistory} disabled={busy || !futureConfigured} wrapLabel />
                  </>
                )}
              </ChecklistRow>
            </View>
          )}
          {fromOnboarding && setupComplete && (
            <Block style={styles.completionReveal}>
              <ThemedText type="smallBold">{t('onboardCompleteAutomaticTitle')}</ThemedText>
              <ThemedText type="small">{t(onboardingInsight.title)}</ThemedText>
              <ThemedText type="meta" themeColor="textSecondary">
                {t(onboardingInsight.body)}
              </ThemedText>
            </Block>
          )}
          {error && !shortcutCheckFailed && (
            <View accessibilityLiveRegion="polite">
              <Block tone="expense">
                <ThemedText type="small" selectable>{error}</ThemedText>
                <Button
                  label={t('iosMessageRetrySetup')}
                  variant="ghost"
                  onPress={() => void runOperation(async () => {
                    // A failed first write must be retried before restoring
                    // the route; otherwise imported history loses its origin.
                    if (!setupInitialized.current) {
                      if (fromOnboarding) {
                        await updateProgress({ type: 'onboarding-started' });
                      }
                      if (requestedSection) {
                        await updateProgress({ type: 'active-section-changed', section: requestedSection });
                      }
                      setupInitialized.current = true;
                    }
                    await send({ type: 'refresh-status' });
                    await refreshSetup(true);
                  })}
                  disabled={busy}
                  wrapLabel
                />
              </Block>
            </View>
          )}
          {(shortcutsMissing || setup.failure === 'shortcuts-missing') && (
            <Button
              label={t('iosInstallShortcuts')}
              onPress={() => void runOperation(async () => {
                await send({ type: 'open-shortcuts-store' });
                setShortcutsMissing(false);
              })}
              disabled={busy}
              wrapLabel
            />
          )}
        </ScrollView>
        {showFooterAction && (
          <View style={[styles.footer, largeText ? styles.footerLargeText : undefined]}>
            <Button label={t(action.label)} onPress={action.onPress} disabled={busy || setup.loading || !progressLoaded || action.disabled} wrapLabel />
            {fromOnboarding && !setupComplete && (
              <Button
                label={t('iosMessageContinueManual')}
                variant="ghost"
                onPress={continueWithoutAutomaticCapture}
                disabled={busy || !progressLoaded}
                wrapLabel
              />
            )}
          </View>
        )}
        {fromOnboarding && !showFooterAction && progressLoaded && (
          <View style={[styles.footer, largeText ? styles.footerLargeText : undefined]}>
            <Button
              label={t('iosMessageContinueManual')}
              variant="ghost"
              onPress={continueWithoutAutomaticCapture}
              disabled={busy}
              wrapLabel
            />
          </View>
        )}
        <ConfirmSheet
          visible={skipHistoryVisible}
          onClose={() => setSkipHistoryVisible(false)}
          question={t(historyRunning ? 'iosMessageResetHistoryTitle' : 'iosMessageSkipHistoryTitle')}
          body={t(historyRunning ? 'iosMessageSkipStoppedHistoryBody' : 'iosMessageSkipHistoryBody')}
          confirmLabel={t('iosMessageSkipHistory')}
          onConfirm={skipHistory}
        />
        <ConfirmSheet
          visible={resetHistoryVisible}
          onClose={() => setResetHistoryVisible(false)}
          question={t('iosMessageResetHistoryTitle')}
          body={t('iosMessageResetHistoryBody')}
          confirmLabel={t('iosMessageResetHistory')}
          onConfirm={resetStoppedHistory}
        />
        <DetailsSheet
          source={notificationMode ? 'notification' : 'message'}
          visible={detailsVisible}
          onClose={() => setDetailsVisible(false)}
          section={progress.activeSection}
          fromOnboarding={fromOnboarding}
          actions={helpActions}
          privacyExpanded={privacyExpanded}
          onTogglePrivacy={() => setPrivacyExpanded((value) => !value)}
        />
      </SafeAreaView>
    </ThemedView>
    </SetupShell>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center',
    paddingHorizontal: ScreenPadding, paddingBottom: 18, gap: 14,
  },
  checklist: { gap: Spacing.two },
  bankChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  hints: { marginTop: Spacing.one },
  progress: { gap: Spacing.one },
  completionReveal: { gap: Spacing.one },
  footer: {
    width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center',
    paddingHorizontal: ScreenPadding, paddingVertical: 12,
  },
  footerLargeText: { paddingBottom: Spacing.four },
});

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Button } from '@/components/ui/controls';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Block } from '@/components/ui/layout';
import { ScreenHeader } from '@/components/ui/screen-header';
import { MaxContentWidth, ScreenPadding, Spacing } from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { t, type StringKey } from '@/lib/i18n';
import {
  completeIosMessageOnboardingAttempt,
  createIosCaptureSetup,
  INITIAL_IOS_SETUP_MODEL,
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
  historyShortcutInstallUrl,
  historyShortcutRunUrl,
  iosSupportsMessageHistory,
  iosHistorySetupStorageCoordinator,
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
import { useStore } from '@/lib/store';
import { useLanguage } from '@/hooks/use-language';
import { IosSetupJourney } from '@/components/ios-message-setup/setup-journey';
import { detectedSetupBanks, futureSetupConfigured, iosSetupJourneyCopy } from '@/lib/ios-setup-journey';

const INITIAL_PROGRESS: IosMessageSetupProgress = {
  version: 1,
  activeSection: 'history',
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
    section?: string;
  }>();
  const { state, ensureDurable, setOnboarded, setCaptureOptOut } = useStore();
  const language = useLanguage();
  const journeyCopy = iosSetupJourneyCopy(language);
  const detectedBanks = useMemo(() => detectedSetupBanks(state.accounts, state.transactions),
    [state.accounts, state.transactions]);
  const fromOnboarding = params.fromOnboarding === '1';
  const requestedSection = params.section === 'history' || params.section === 'future'
    ? params.section : null;
  const historyReturnOrigin = fromOnboarding ? 'onboarding' : 'ios-setup';
  const historyInstallUrl = historyShortcutInstallUrl();
  const historySupported = Platform.OS === 'ios' &&
    iosSupportsMessageHistory(Platform.Version);
  const controllerRef = useRef<ReturnType<typeof createIosCaptureSetup> | null>(null);
  const screenActive = useRef(true);
  const operationInFlight = useRef<Promise<void> | null>(null);
  const refreshGeneration = useRef(0);
  const consumedShortcutCallback = useRef<string | null>(null);
  const previousReadiness = useRef(INITIAL_IOS_SETUP_MODEL.readiness);
  const [setup, setSetup] = useState(INITIAL_IOS_SETUP_MODEL);
  const [progress, setProgress] = useState(INITIAL_PROGRESS);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [historySetup, setHistorySetup] = useState({
    installed: false,
    handoffStartedAt: null as number | null,
  });
  const [busy, setBusy] = useState(false);
  const [finishRetryRequired, setFinishRetryRequired] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [privacyExpanded, setPrivacyExpanded] = useState(false);
  const [shortcutsMissing, setShortcutsMissing] = useState(false);
  const [showAutomationGuide, setShowAutomationGuide] = useState(false);
  const [resetHistoryVisible, setResetHistoryVisible] = useState(false);
  const futureReadyLabel = setup.readiness === 'first-alert-captured'
    ? t('iosLocalFirstAlertCaptured')
    : t('iosLocalWaitingTitle');
  const futureConfigured = futureSetupConfigured(setup.readiness, progress.futureAutomationConfirmed);
  const setupComplete = progressLoaded && !setup.loading &&
    futureConfigured && progress.historyStatus === 'complete';

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
      } else {
        nextHistory = await iosHistorySetupStorageCoordinator.run(() => loadIosHistorySetup());
      }
      if (!screenActive.current || generation !== refreshGeneration.current) return;
      setHistoryReady(historySupported);
      setHistorySetup({
        installed: nextHistory.installed,
        handoffStartedAt: nextHistory.handoffStartedAt,
      });
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
  }, [historySupported, router]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (fromOnboarding) {
          await dispatchIosMessageSetup({ type: 'onboarding-started' });
        }
        if (requestedSection) {
          await dispatchIosMessageSetup({ type: 'active-section-changed', section: requestedSection });
        }
        if (active) await refreshSetup();
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
      void refreshSetup();
    });
    return () => subscription.remove();
  }, [refreshSetup, send]);

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
    });
  }, [runOperation, updateProgress]);

  const installFutureShortcut = useCallback(() => {
    void runOperation(async () => {
      await updateProgress({ type: 'future-status-changed', status: 'in-progress' });
      await send({ type: 'install-shortcut' });
    });
  }, [runOperation, send, updateProgress]);

  const confirmFutureShortcut = useCallback(() => {
    void runOperation(async () => {
      await updateProgress({ type: 'future-shortcut-confirmed' });
      await send({ type: 'shortcut-added' });
    });
  }, [runOperation, send, updateProgress]);

  const openAutomation = useCallback(() => {
    void runOperation(async () => {
      await updateProgress({ type: 'future-status-changed', status: 'in-progress' });
      await send({ type: 'open-automation' });
    });
  }, [runOperation, send, updateProgress]);

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
      if (!await Linking.canOpenURL('shortcuts://')) {
        setShortcutsMissing(true);
        return;
      }
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
        await Linking.openURL(newHandoff ? historyShortcutRunUrl() : 'shortcuts://');
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
    }, t('iosLocalShortcutInstallFailed'));
  }, [historyReturnOrigin, runOperation, updateProgress]);

  const resetStoppedHistory = useCallback(() => {
    setResetHistoryVisible(false);
    void runOperation(async () => {
      const native = await historyNativeModule();
      await iosHistorySetupStorageCoordinator.run(() => cancelIosHistoryHandoff({
        recover: () => recoverIosHistoryHandoff(historySetup.handoffStartedAt, native),
        discard: (sessionId) => native.discardSession(sessionId),
        clearHandoff: async () => {
          await clearIosHistoryHandoff();
          await clearIosHistoryReturnOrigin();
        },
      }));
      await updateProgress({ type: 'history-status-changed', status: 'not-started' });
      if (screenActive.current) {
        setHistorySetup((current) => ({ ...current, handoffStartedAt: null }));
      }
    }, t('historyCancelCleanupFailed'));
  }, [historySetup.handoffStartedAt, runOperation, updateProgress]);

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
      if (fromOnboarding) {
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
        router.replace('/');
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
    finishRetryRequired,
    fromOnboarding,
    setupComplete,
    router,
    runOperation,
    setOnboarded,
    updateProgress,
  ]);

  const leave = useCallback(async () => {
    if (busy || finishRetryRequired) return;
    await runOperation(async () => {
      if (fromOnboarding) {
        await updateProgress({ type: 'onboarding-return-cleared' });
      }
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace('/');
    });
  }, [busy, finishRetryRequired, fromOnboarding, router, runOperation, updateProgress]);

  const futureStep = setup.failure === 'shortcut-install' &&
    !progress.futureShortcutConfirmed
    ? 'add-shortcut'
    : resolveIosFutureSetupStep(progress, setup.readiness);
  const futureStatus = !setup.loading && !futureConfigured && progress.futureStatus === 'complete'
    ? 'in-progress' : progress.futureStatus;
  const error = localError ?? (setup.failure ? failureCopy(setup.failure) : null);
  const historyConfirmed = progress.historyShortcutConfirmed || historySetup.installed;
  const historyRunning = historySetup.handoffStartedAt !== null;
  const historyComplete = progress.historyStatus === 'complete';
  const showingAutomation = futureStep === 'create-automation' ||
    futureStep === 'prove-shortcut' || showAutomationGuide;

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
    if (futureStep === 'add-shortcut') {
      return { label: 'iosLocalInstallShortcut', onPress: installFutureShortcut, disabled: !setup.shortcutAvailable };
    }
    if (futureStep === 'confirm-shortcut') return { label: 'iosLocalAlreadyAdded', onPress: confirmFutureShortcut };
    if (futureStep === 'ready' && !showAutomationGuide) {
      return { label: 'iosMessageNextHistory', onPress: () => selectSection('history') };
    }
    return {
      label: progress.futureAutomationConfirmed ? 'iosMessageRetryCheck' : 'iosLocalAutomationAdded',
      onPress: confirmAutomation,
    };
  };
  const action = primaryAction();
  const helpActions: { label: string; onPress(): void }[] = [];
  if (progress.activeSection === 'future') {
    if (setup.supported && setup.shortcutAvailable) {
      helpActions.push({ label: t('iosMessageAddAgain'), onPress: installFutureShortcut });
    }
    if (futureStep === 'ready') {
      helpActions.push({ label: t('iosMessageReviewAutomation'), onPress: () => setShowAutomationGuide(true) });
    }
  } else if (historyRunning) {
    helpActions.push({ label: t('iosMessageResetHistory'), onPress: () => setResetHistoryVisible(true) });
  } else if (historyReady && historyInstallUrl) {
    helpActions.push({ label: t('iosMessageAddAgain'), onPress: openHistoryInstall });
    if (historyComplete) {
      helpActions.push({ label: t('iosMessageImportAgain'), onPress: () => openHistoryRun(true) });
    }
  }

  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ gestureEnabled: !fromOnboarding && !busy && !finishRetryRequired }} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          style={styles.scroll}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <ScreenHeader
            mode="inline"
            title={t('iosMessageSetupHeading')}
            subtitle={t('iosMessageSetupSubtitle')}
            back={{ label: t('back'), onPress: leave, disabled: busy || finishRetryRequired }}
            actions={[{ label: t('iosMessageLearnMore'), onPress: openHelp, disabled: busy }]}
          />
          {!progressLoaded || setup.loading ? (
            <ThemedText type="meta" themeColor="textSecondary">{t('stillLoading')}</ThemedText>
          ) : (
            <View testID="ios-message-setup-checklist" style={styles.checklist}>
              <IosSetupJourney
                language={language}
                historyStatus={progress.historyStatus}
                futureReadiness={setup.readiness}
                automationConfirmed={progress.futureAutomationConfirmed}
                detectedBanks={detectedBanks}
                captureHealth={setup.captureHealth}
              />
              <ChecklistRow
                step={1}
                title={t('iosMessagePastTitle')}
                detail={historyComplete ? t('iosMessageHistoryDone') : undefined}
                status={progress.historyStatus}
                expanded={progress.activeSection === 'history'}
                onPress={() => selectSection('history')}>
                {!historySupported || !historyReady || !historyInstallUrl ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t(!historySupported ? 'historyRequiresIos26'
                      : !historyReady ? 'iosLocalUpdateRequired' : 'historyInstallUnavailable')}
                  </ThemedText>
                ) : !historyComplete ? (
                  <>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t(historyRunning ? 'iosMessageHistoryRunningHelp'
                        : historyConfirmed ? 'iosMessageHistoryStartHelp'
                          : progress.historyStatus === 'in-progress' ? 'iosMessageHistoryReturnHelp' : 'iosMessageHistoryInstallHelp')}
                    </ThemedText>
                    <ThemedText type="meta" themeColor="textSecondary">{journeyCopy.historyRequest}</ThemedText>
                    {historyRunning && <Button label={journeyCopy.configureWhileImporting} variant="ghost"
                      onPress={() => selectSection('future')} disabled={busy} wrapLabel />}
                    {!historyRunning && (
                      <View style={styles.hints}>
                        <ThemedText type="meta" themeColor="textSecondary">{t('iosMessagePastTiming')}</ThemedText>
                        <ThemedText type="meta" themeColor="textSecondary">{t('iosMessageHistoryKeepOpen')}</ThemedText>
                        <ThemedText type="meta" themeColor="textSecondary">{t('iosMessageHistoryCoverage')}</ThemedText>
                      </View>
                    )}
                  </>
                ) : null}
              </ChecklistRow>
              <ChecklistRow
                step={2}
                title={t('iosMessageFutureTitle')}
                detail={setup.readiness === 'first-alert-captured' ? futureReadyLabel
                  : futureConfigured ? journeyCopy.waiting : undefined}
                status={futureStatus}
                expanded={progress.activeSection === 'future'}
                onPress={() => selectSection('future')}>
                {!setup.supported ? (
                  <ThemedText type="small" themeColor="textSecondary">{t('iosLocalUnsupported')}</ThemedText>
                ) : setup.failure === 'load' ? (
                  <ThemedText type="small" themeColor="textSecondary">{t('iosLocalUpdateRequired')}</ThemedText>
                ) : showingAutomation ? (
                  <>
                    <AutomationGuide />
                    <ThemedText type="meta" themeColor="textSecondary">{journeyCopy.senderHelp}</ThemedText>
                    <Button label={t('iosLocalOpenAutomation')} variant="ghost" onPress={openAutomation} disabled={busy} wrapLabel />
                  </>
                ) : futureStep === 'add-shortcut' || futureStep === 'confirm-shortcut' ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t(!setup.shortcutAvailable ? 'iosLocalShortcutUnavailable'
                      : futureStep === 'add-shortcut' ? 'iosMessageFutureInstallHelp' : 'iosMessageFutureReturnHelp')}
                  </ThemedText>
                ) : null}
              </ChecklistRow>
            </View>
          )}
          {error && (
            <View accessibilityLiveRegion="polite">
              <Block tone="expense">
                <ThemedText type="small" selectable>{error}</ThemedText>
                <Button
                  label={t('iosMessageRetrySetup')}
                  variant="ghost"
                  onPress={() => void runOperation(async () => {
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
        <View style={[styles.footer, largeText ? styles.footerLargeText : undefined]}>
          <Button label={t(action.label)} onPress={action.onPress} disabled={busy || setup.loading || !progressLoaded || action.disabled} wrapLabel />
        </View>
        <ConfirmSheet
          visible={resetHistoryVisible}
          onClose={() => setResetHistoryVisible(false)}
          question={t('iosMessageResetHistoryTitle')}
          body={t('iosMessageResetHistoryBody')}
          confirmLabel={t('iosMessageResetHistory')}
          onConfirm={resetStoppedHistory}
        />
        <DetailsSheet
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
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { flex: 1 },
  content: {
    width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center',
    paddingHorizontal: ScreenPadding, paddingBottom: Spacing.four, gap: Spacing.four,
  },
  checklist: { gap: Spacing.two },
  hints: { gap: Spacing.one },
  footer: {
    width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center',
    paddingHorizontal: ScreenPadding, paddingVertical: Spacing.three,
  },
  footerLargeText: { paddingBottom: Spacing.four },
});

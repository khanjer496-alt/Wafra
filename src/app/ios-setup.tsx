import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState as RNAppState,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/controls';
import { Block, ScreenHeader } from '@/components/ui/layout';
import {
  MaxContentWidth,
  Radius,
  ScreenPadding,
  Spacing,
} from '@/constants/theme';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { t, tf, type StringKey } from '@/lib/i18n';
import {
  createIosCaptureSetup,
  INITIAL_IOS_SETUP_MODEL,
  type IosSetupFailure,
  type IosSetupIntent,
  type IosSetupModel,
} from '@/lib/ios-capture-setup';
import { useStore } from '@/lib/store';

const STEPS: readonly StringKey[] = [
  'iosLocalStepShortcut',
  'iosLocalStepAutomation',
] as const;

const AUTOMATION_CHOICES: readonly StringKey[] = [
  'iosLocalChoiceMessage',
  'iosLocalChoiceAnySender',
  'iosLocalChoiceContainsEmpty',
  'iosLocalChoiceImmediate',
  'iosLocalChoiceRunShortcut',
  'iosLocalChoiceCompleteMessage',
] as const;

function automationGuideLabel(): string {
  return [
    t('iosLocalAutomationGuideLabel'),
    ...AUTOMATION_CHOICES.map((key) => t(key)),
  ].join('. ');
}

function failureCopy(
  failure: Exclude<IosSetupFailure, null>,
  manualExitFailed: boolean,
): string {
  switch (failure) {
    case 'shortcut-install':
      return t('iosLocalShortcutInstallFailed');
    case 'shortcut-run':
      return t('iosLocalShortcutRunFailed');
    case 'shortcuts-missing':
      return t('iosShortcutsMissing');
    case 'load':
    default:
      return t(manualExitFailed ? 'iosLocalManualExitFailed' : 'iosLocalUpdateRequired');
  }
}

type AnnouncedState = Pick<IosSetupModel, 'stage' | 'readiness' | 'failure'>;

export default function IosSetupScreen() {
  const theme = useTheme();
  const largeText = useLargeTextLayout();
  const router = useRouter();
  const params = useLocalSearchParams<{
    fromOnboarding?: string;
    shortcutResult?: string;
  }>();
  const { setCaptureOptOut, setOnboarded } = useStore();
  const fromOnboarding = params.fromOnboarding === '1';
  const screenActive = useRef(true);
  const controllerRef = useRef<ReturnType<typeof createIosCaptureSetup> | null>(null);
  const manualExitInFlight = useRef<Promise<void> | null>(null);
  const [setup, setSetup] = useState(INITIAL_IOS_SETUP_MODEL);
  const [manualExitFailed, setManualExitFailed] = useState(false);
  const [manualExiting, setManualExiting] = useState(false);
  const consumedShortcutCallback = useRef<string | null>(null);
  const previousAnnounced = useRef<AnnouncedState>({
    stage: 'shortcut',
    readiness: 'not-added',
    failure: null,
  });

  useEffect(() => {
    screenActive.current = true;
    return () => {
      screenActive.current = false;
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

  useEffect(() => {
    const subscription = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') void send({ type: 'refresh-status' });
    });
    return () => subscription.remove();
  }, [send]);

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
    void send({ type: 'shortcut-callback', result });
    router.setParams({ shortcutResult: undefined });
  }, [params.shortcutResult, router, send, setup.loading]);

  useEffect(() => {
    if (setup.loading) return;
    const previous = previousAnnounced.current;
    const announcements: string[] = [];

    if (setup.stage !== previous.stage) {
      const stepIndex = setup.stage === 'shortcut' ? 0 : 1;
      announcements.push(tf('iosStepProgress', {
        n: stepIndex + 1,
        total: STEPS.length,
        name: t(STEPS[stepIndex]),
      }));
    }
    if (setup.readiness !== previous.readiness) {
      if (setup.readiness === 'first-alert-captured') {
        announcements.push(t('iosLocalFirstAlertCaptured'));
      } else if (setup.readiness === 'shortcut-proven') {
        announcements.push(t('iosLocalWaitingTitle'));
      }
    }
    if (setup.failure !== previous.failure && setup.failure) {
      announcements.push(failureCopy(setup.failure, manualExitFailed));
    }

    previousAnnounced.current = {
      stage: setup.stage,
      readiness: setup.readiness,
      failure: setup.failure,
    };
    if (announcements.length > 0) {
      AccessibilityInfo.announceForAccessibility(announcements.join('. '));
    }
  }, [
    manualExitFailed,
    setup.failure,
    setup.loading,
    setup.readiness,
    setup.stage,
  ]);

  const installShortcut = useCallback(() => {
    if (manualExitInFlight.current) return;
    setManualExitFailed(false);
    void send({ type: 'install-shortcut' });
  }, [send]);

  const shortcutAdded = useCallback(() => {
    if (manualExitInFlight.current) return;
    setManualExitFailed(false);
    void send({ type: 'shortcut-added' });
  }, [send]);

  const openAutomation = useCallback(() => {
    if (manualExitInFlight.current) return;
    setManualExitFailed(false);
    void send({ type: 'open-automation' });
  }, [send]);

  const automationAdded = useCallback(() => {
    if (manualExitInFlight.current) return;
    setManualExitFailed(false);
    void send({ type: 'automation-added' });
  }, [send]);

  const finish = useCallback(() => {
    if (manualExitInFlight.current) return;
    if (fromOnboarding) {
      router.replace('/?onboarding=complete');
      return;
    }
    setOnboarded();
    router.replace('/');
  }, [fromOnboarding, router, setOnboarded]);

  const continueManually = useCallback((): Promise<void> => {
    if (manualExitInFlight.current) return manualExitInFlight.current;
    setManualExitFailed(false);
    setManualExiting(true);
    const operation = (async () => {
      try {
        await send({ type: 'manual-only' });
      } catch {
        if (screenActive.current) setManualExitFailed(true);
        return;
      }
      try {
        await setCaptureOptOut(true);
      } catch {
        if (screenActive.current) {
          setManualExitFailed(true);
          AccessibilityInfo.announceForAccessibility(t('iosLocalManualExitFailed'));
        }
        return;
      }

      if (!screenActive.current) return;
      if (fromOnboarding) {
        router.replace('/?onboarding=complete');
        return;
      }
      router.push('/add-transaction');
    })();
    manualExitInFlight.current = operation.finally(() => {
      manualExitInFlight.current = null;
      if (screenActive.current) setManualExiting(false);
    });
    return manualExitInFlight.current;
  }, [fromOnboarding, router, send, setCaptureOptOut]);

  const importPastAlerts = useCallback(() => {
    if (manualExitInFlight.current) return;
    if (fromOnboarding) setOnboarded();
    router.push('/import-sms');
  }, [fromOnboarding, router, setOnboarded]);

  const leave = useCallback(() => {
    if (manualExitInFlight.current) return;
    if (router.canGoBack()) {
      router.back();
      return;
    }
    finish();
  }, [finish, router]);

  const goToShortcut = useCallback(() => {
    if (manualExitInFlight.current) return;
    void send({ type: 'go-to-stage', stage: 'shortcut' });
  }, [send]);

  const openShortcutsStore = useCallback(() => {
    if (manualExitInFlight.current) return;
    void send({ type: 'open-shortcuts-store' });
  }, [send]);

  const {
    loading,
    supported,
    shortcutAvailable,
    stage,
    readiness,
    opening,
    failure,
  } = setup;
  const stepIndex = stage === 'shortcut' ? 0 : 1;
  const error = manualExitFailed
    ? t('iosLocalManualExitFailed')
    : failure && !(failure === 'load' && stage === 'shortcut')
      ? failureCopy(failure, false)
      : null;
  const showInstallCta =
    supported && shortcutAvailable && failure !== 'load';
  const actionsBlocked = opening || manualExiting;

  return (
    <ThemedView style={styles.root}>
      <Stack.Screen options={{ gestureEnabled: !manualExiting }} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <View
            pointerEvents={manualExiting ? 'none' : 'auto'}
            accessibilityElementsHidden={manualExiting}
            importantForAccessibility={manualExiting ? 'no-hide-descendants' : 'auto'}>
            <ScreenHeader title={t('iosSetupTitle')} onBack={leave} />
          </View>

          <ThemedText type="meta" themeColor="textSecondary">
            {tf('iosStepProgress', {
              n: stepIndex + 1,
              total: STEPS.length,
              name: t(STEPS[stepIndex]),
            })}
          </ThemedText>
          <View
            style={styles.progress}
            accessibilityRole="progressbar"
            accessibilityLabel={tf('iosStepProgress', {
              n: stepIndex + 1,
              total: STEPS.length,
              name: t(STEPS[stepIndex]),
            })}
            accessibilityValue={{
              min: 1,
              max: STEPS.length,
              now: stepIndex + 1,
              text: t(STEPS[stepIndex]),
            }}>
            {STEPS.map((key, index) => (
              <View
                key={key}
                style={[
                  styles.progressSegment,
                  {
                    backgroundColor:
                      index <= stepIndex ? theme.primary : theme.track,
                  },
                ]}
              />
            ))}
          </View>

          {loading && (
            <View accessibilityLiveRegion="polite">
              <ThemedText type="meta" themeColor="textSecondary">
                {t('stillLoading')}
              </ThemedText>
            </View>
          )}

          {!loading && stage === 'shortcut' && (
            <View style={styles.section}>
              <View style={styles.heading}>
                <ThemedText type="title" accessibilityRole="header">
                  {t('iosLocalShortcutTitle')}
                </ThemedText>
                <ThemedText type="default" themeColor="textSecondary">
                  {t('iosLocalShortcutBody')}
                </ThemedText>
              </View>

              {!supported ? (
                <Block>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('iosLocalUnsupported')}
                  </ThemedText>
                </Block>
              ) : failure === 'load' && !manualExitFailed && !manualExiting ? (
                <Block tone="expense">
                  <ThemedText type="small" selectable>
                    {t('iosLocalUpdateRequired')}
                  </ThemedText>
                </Block>
              ) : (
                <>
                  {!shortcutAvailable && (
                    <Block>
                      <ThemedText type="small" themeColor="textSecondary">
                        {t('iosLocalShortcutUnavailable')}
                      </ThemedText>
                    </Block>
                  )}
                  {showInstallCta && (
                    <Button
                      label={t('iosLocalInstallShortcut')}
                      onPress={installShortcut}
                      disabled={actionsBlocked}
                      wrapLabel
                    />
                  )}
                  <Button
                    label={t('iosLocalAlreadyAdded')}
                    variant="outline"
                    onPress={shortcutAdded}
                    disabled={actionsBlocked}
                    wrapLabel
                  />
                </>
              )}

              <Block>
                <View style={styles.noteCopy}>
                  <ThemedText type="smallBold">
                    {t('iosLocalPrivacyTitle')}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('iosLocalPrivacyBody')}
                  </ThemedText>
                </View>
              </Block>

              <Block>
                <View style={styles.noteCopy}>
                  <ThemedText type="smallBold">
                    {t('iosLocalMigrationTitle')}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('iosLocalMigrationBody')}
                  </ThemedText>
                </View>
              </Block>
            </View>
          )}

          {!loading && stage === 'automation' && (
            <View style={styles.section}>
              <View style={styles.heading}>
                <ThemedText type="title" accessibilityRole="header">
                  {t('iosLocalAutomationTitle')}
                </ThemedText>
                <ThemedText type="default" themeColor="textSecondary">
                  {t('iosLocalAutomationBody')}
                </ThemedText>
              </View>

              <View
                style={[
                  styles.automationGuide,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder },
                ]}
                accessible
                accessibilityRole="image"
                accessibilityLabel={automationGuideLabel()}>
                <View style={styles.mockHeader}>
                  <View style={[styles.mockDot, { backgroundColor: theme.primary }]} />
                  <ThemedText type="smallBold">
                    {t('iosLocalStepAutomation')}
                  </ThemedText>
                </View>
                <View>
                  {AUTOMATION_CHOICES.map((key, index) => (
                    <View
                      key={key}
                      style={[
                        styles.choiceRow,
                        index === AUTOMATION_CHOICES.length - 1
                          ? styles.choiceRowLast
                          : { borderBottomColor: theme.cardBorder },
                      ]}>
                      <View
                        style={[
                          styles.choiceNumber,
                          { backgroundColor: theme.primarySoft },
                        ]}>
                        <ThemedText type="micro" style={{ color: theme.primary }} tabular>
                          {index + 1}
                        </ThemedText>
                      </View>
                      <ThemedText type="small" style={styles.choiceText}>
                        {t(key)}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              </View>

              <View style={[styles.actionRow, largeText ? styles.largeTextActions : undefined]}>
                <Button
                  label={t('iosLocalOpenAutomation')}
                  variant="outline"
                  onPress={openAutomation}
                  disabled={actionsBlocked}
                  inline={!largeText}
                  wrapLabel
                />
                <Button
                  label={t('iosLocalAutomationAdded')}
                  onPress={automationAdded}
                  disabled={actionsBlocked}
                  inline={!largeText}
                  wrapLabel
                />
              </View>

              <ThemedText type="meta" themeColor="textSecondary">
                {t('iosLocalTestExplainer')}
              </ThemedText>

              <Block>
                <View
                  style={styles.noteCopy}
                  accessibilityLiveRegion="polite">
                  <ThemedText type="smallBold">
                    {readiness === 'first-alert-captured'
                      ? t('iosLocalFirstAlertCaptured')
                      : readiness === 'shortcut-proven'
                        ? t('iosLocalWaitingTitle')
                        : t('iosLocalNotProvenTitle')}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {readiness === 'first-alert-captured'
                      ? t('iosLocalFirstAlertBody')
                      : readiness === 'shortcut-proven'
                        ? t('iosLocalWaitingBody')
                        : t('iosLocalNotProvenBody')}
                  </ThemedText>
                </View>
              </Block>

              <Button
                label={t('iosLocalBackToShortcut')}
                variant="ghost"
                onPress={goToShortcut}
                disabled={actionsBlocked}
                wrapLabel
              />
              {readiness !== 'not-added' && (
                <Button
                  label={t('iosLocalContinue')}
                  variant="outline"
                  onPress={finish}
                  disabled={actionsBlocked}
                  wrapLabel
                />
              )}
            </View>
          )}

          {error && (
            <View accessibilityLiveRegion="polite">
              <Block tone="expense">
                <ThemedText type="small" selectable>
                  {error}
                </ThemedText>
              </Block>
              {failure === 'shortcuts-missing' && (
                <Button
                  label={t('iosInstallShortcuts')}
                  variant="outline"
                  onPress={openShortcutsStore}
                  disabled={actionsBlocked}
                  wrapLabel
                  style={styles.recoveryButton}
                />
              )}
            </View>
          )}

          <View
            style={[
              styles.fallbackActions,
              largeText ? styles.largeTextActions : undefined,
            ]}>
            <Button
              label={t('iosLocalManualTracking')}
              variant="ghost"
              onPress={() => void continueManually()}
              disabled={actionsBlocked}
              inline={!largeText}
              wrapLabel
            />
            <Button
              label={t('iosLocalImportPast')}
              variant="ghost"
              onPress={importPastAlerts}
              disabled={actionsBlocked}
              inline={!largeText}
              wrapLabel
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  content: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.six,
    gap: Spacing.four,
  },
  progress: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: Radius.full,
  },
  section: {
    gap: Spacing.four,
  },
  heading: {
    gap: Spacing.two,
  },
  noteCopy: {
    flex: 1,
    gap: Spacing.two,
  },
  automationGuide: {
    borderWidth: 1,
    borderRadius: Radius.sheet,
    borderCurve: 'continuous',
    padding: Spacing.three,
    gap: Spacing.two,
  },
  mockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  mockDot: {
    width: 10,
    height: 10,
    borderRadius: Radius.full,
  },
  choiceRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.two,
  },
  choiceRowLast: {
    borderBottomWidth: 0,
  },
  choiceNumber: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: {
    flex: 1,
    flexShrink: 1,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'stretch',
  },
  fallbackActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'stretch',
    paddingTop: Spacing.two,
  },
  largeTextActions: {
    flexDirection: 'column',
  },
  recoveryButton: {
    marginTop: Spacing.two,
  },
});

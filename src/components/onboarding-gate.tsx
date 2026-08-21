import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type AccessibilityRole,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StorageRecovery } from '@/components/storage-recovery';
import { ThemedText } from '@/components/themed-text';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { Colors, Fonts, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import {
  buildImportPlan,
  isSmsInboxAccessError,
  isSmsScanningAvailable,
  requestSmsPermission,
  scanInbox,
} from '@/lib/auto-import';
import { committed, tapped } from '@/lib/haptics';
import { t, tf, type StringKey } from '@/lib/i18n';
import { disableRelayBackgroundSync } from '@/lib/background-relay';
import {
  BUDGET_PRESETS,
  DEFAULT_ONBOARDING_PLAN,
  GOAL_PRESETS,
  type OnboardingBudgetId,
  type OnboardingGoalId,
} from '@/lib/onboarding';
import { getRelayConfigStrict, unpairDevice } from '@/lib/relay';
import { openShortcutsApp } from '@/lib/shortcut-cleanup';
import { useStore } from '@/lib/store';
import NotificationReader from '../../modules/notification-reader';

type Step =
  | 'welcome'
  | 'goals'
  | 'budget'
  | 'capture'
  | 'scanning'
  | 'complete';
const QUESTION_STEPS: readonly Step[] = ['goals', 'budget', 'capture'];
type CompletionOutcome = 'automatic' | 'manual' | 'denied' | 'failed';
type ShortcutCleanupState = 'revoked' | 'uncertain' | null;

const isWebPlatform = () => Platform.OS === 'web';
const isPublicWebSurface = () =>
  isWebPlatform() && process.env.EXPO_PUBLIC_WAFRA_E2E_DEMO !== '1';

/** Onboarding is night mode regardless of the OS theme: the first screen sets
 * the tone, and the mark is at its strongest on charcoal. */
const night = Colors.dark;

function captureCopy(): { title: StringKey; body: StringKey } {
  if (Platform.OS === 'ios') {
    return { title: 'onboardCaptureTitleIos', body: 'onboardCaptureBodyIos' };
  }
  if (Platform.OS === 'android') {
    return { title: 'onboardCaptureTitleAndroid', body: 'onboardCaptureBodyAndroid' };
  }
  return { title: 'onboardCaptureTitleWeb', body: 'onboardCaptureBodyWeb' };
}

function MoneyPreview({ reducedMotion }: { reducedMotion: boolean }) {
  const items = [
    { icon: 'briefcase' as const, label: t('onboardPreviewIncome'), detail: t('onboardPreviewIncomeDetail'), tone: night.income },
    { icon: 'bolt' as const, label: t('onboardPreviewBill'), detail: t('onboardPreviewBillDetail'), tone: night.warning },
    { icon: 'check' as const, label: t('onboardPreviewCard'), detail: t('onboardPreviewCardDetail'), tone: night.primary },
  ];
  return (
    <View
      style={styles.moneyPreview}
      accessible
      accessibilityLabel={t('onboardPreviewAccessibility')}>
      <View style={styles.previewHeader}>
        <ThemedText style={styles.previewOverline}>{t('onboardPreviewOverline')}</ThemedText>
        <View style={styles.livePill}>
          <ThemedText style={styles.liveLabel}>{t('onboardPreviewLive')}</ThemedText>
        </View>
      </View>
      <View style={styles.previewRows}>
        {items.map((item, index) => (
          <Animated.View
            key={item.label}
            entering={reducedMotion ? undefined : FadeInDown.delay(160 + index * 70).duration(360)}
            style={[styles.previewRow, index > 0 && styles.previewRowBorder]}>
            <View style={[styles.previewIcon, { backgroundColor: `${item.tone}1A` }]}>
              <Icon name={item.icon} size={17} color={item.tone} />
            </View>
            <View style={styles.previewCopy}>
              <ThemedText style={styles.previewLabel}>{item.label}</ThemedText>
              <ThemedText style={styles.previewDetail}>{item.detail}</ThemedText>
            </View>
            <Icon name="chevron-right" size={16} color={night.textTertiary} />
          </Animated.View>
        ))}
      </View>
      <View style={styles.previewFooter}>
        <Icon name="spark" size={15} color={night.primary} />
        <ThemedText style={styles.previewFooterText}>{t('onboardPreviewFooter')}</ThemedText>
      </View>
    </View>
  );
}

function StartOption({
  automatic,
  onPress,
}: {
  automatic: boolean;
  onPress: () => void;
}) {
  const title = t(automatic ? 'onboardAutomaticChoice' : 'onboardManualChoice');
  const body = t(automatic
    ? Platform.OS === 'ios' ? 'onboardAutomaticChoiceIosBody' : 'onboardAutomaticChoiceAndroidBody'
    : 'onboardManualChoiceBody');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      onPress={() => {
        tapped();
        onPress();
      }}
      style={({ pressed }) => [
        styles.startOption,
        automatic && styles.startOptionFeatured,
        { opacity: pressed ? 0.72 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] },
      ]}>
      <View style={[styles.startOptionIcon, automatic && styles.startOptionIconFeatured]}>
        <Icon name={automatic ? 'spark' : 'plus'} size={20} color={automatic ? night.primary : night.textSecondary} />
      </View>
      <View style={styles.startOptionCopy}>
        <View style={styles.startOptionTitleLine}>
          <ThemedText style={styles.startOptionTitle}>{title}</ThemedText>
          {automatic && (
            <View style={styles.recommendedPill}>
              <ThemedText style={styles.recommendedText}>{t('recommended')}</ThemedText>
            </View>
          )}
        </View>
        <ThemedText style={styles.startOptionBody}>{body}</ThemedText>
      </View>
      <Icon name="chevron-right" size={18} color={automatic ? night.primary : night.textTertiary} />
    </Pressable>
  );
}

function SelectionRow({
  title,
  detail,
  icon,
  selected,
  onPress,
  role = 'radio',
  hint,
}: {
  title: string;
  detail: string;
  icon: IconName;
  selected: boolean;
  onPress: () => void;
  role?: AccessibilityRole;
  hint?: string;
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityHint={hint}
      accessibilityState={role === 'checkbox' ? { checked: selected } : { selected }}
      onPress={() => {
        tapped();
        onPress();
      }}
      style={({ pressed }) => [
        styles.choice,
        {
          backgroundColor: selected ? night.primarySoft : night.backgroundElement,
          borderColor: selected ? night.primary : night.cardBorder,
          opacity: pressed ? 0.82 : 1,
          transform: [{ scale: pressed ? 0.99 : 1 }],
        },
      ]}>
      <View
        style={[
          styles.choiceIcon,
          { backgroundColor: selected ? night.primary : night.backgroundSelected },
        ]}>
        <Icon name={icon} size={19} color={selected ? night.onPrimary : night.textSecondary} />
      </View>
      <View style={styles.choiceCopy}>
        <ThemedText style={styles.choiceTitle}>{title}</ThemedText>
        <ThemedText style={styles.choiceDetail}>{detail}</ThemedText>
      </View>
      <View
        style={[
          styles.selectionMark,
          {
            backgroundColor: selected ? night.primary : 'transparent',
            borderColor: selected ? night.primary : night.cardBorderStrong,
          },
        ]}>
        {selected && <Icon name="check" size={13} color={night.onPrimary} strokeWidth={2.2} />}
      </View>
    </Pressable>
  );
}

function BackHeader({ step, onBack }: { step: Step; onBack: () => void }) {
  const index = QUESTION_STEPS.indexOf(step);
  const visibleIndex = index < 0 ? QUESTION_STEPS.length - 1 : index;
  return (
    <View style={styles.progressHeader}>
      <View style={styles.progressTopline}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onboardBack')}
          hitSlop={10}
          onPress={() => {
            tapped();
            onBack();
          }}
          style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}>
          <Icon name="chevron-left" size={18} color={night.textSecondary} />
          <ThemedText style={styles.backLabel}>{t('onboardBack')}</ThemedText>
        </Pressable>
        <ThemedText style={styles.stepLabel}>
          {tf('onboardStepOf', { step: visibleIndex + 1, total: QUESTION_STEPS.length })}
        </ThemedText>
      </View>
      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 1, max: QUESTION_STEPS.length, now: visibleIndex + 1 }}>
        {QUESTION_STEPS.map((item, itemIndex) => (
          <View
            key={item}
            style={[
              styles.progressSegment,
              {
                backgroundColor:
                  itemIndex <= visibleIndex ? night.primary : night.backgroundSelected,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * First run questionnaire and platform capture hand-off.
 *
 * It remains an overlay above the mounted navigator. Replacing the navigator
 * itself corrupts expo-router route state, and keeping it mounted also lets
 * iOS return from its first-class Shortcut setup to the personalised summary.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ onboarding?: string }>();
  const router = useRouter();
  const reducedMotion = useReducedMotion();
  const {
    state,
    storageFailure,
    storageRecoveryState,
    hydrationFailed,
    importBatch,
    stageReviewAlerts,
    setMarket,
    setOnboarded,
    setOnboardingPlan,
    setCaptureOptOut,
  } = useStore();
  const [step, setStep] = useState<Step>('welcome');
  const [plan, setPlan] = useState(() => ({
    ...DEFAULT_ONBOARDING_PLAN,
    goalIds: [...DEFAULT_ONBOARDING_PLAN.goalIds],
  }));
  const [goalLimitAnnounced, setGoalLimitAnnounced] = useState(false);
  const [progress, setProgress] = useState({ scanned: 0, found: 0 });
  const [result, setResult] = useState<{ tx: number; accounts: number } | null>(null);
  const [smsDenied, setSmsDenied] = useState(false);
  const [completionOutcome, setCompletionOutcome] = useState<CompletionOutcome>('manual');
  const [shortcutCleanup, setShortcutCleanup] = useState<ShortcutCleanupState>(null);

  const activeStep: Step = params.onboarding === 'complete' ? 'complete' : step;
  const capture = captureCopy();

  /**
   * A failed read is not a first run, and an incomplete erase is not a usable
   * blank ledger. This gate is where both distinctions have to be made.
   *
   * `state.onboarded === false` means one of two completely different things:
   * this phone has never run the app, or the ledger could not be read and the
   * store is presenting an empty state it did not get from disk. They looked
   * identical here, so an unreadable database was answered with a welcome
   * screen and a "Start with sample data" button — an invitation to replace a
   * ledger that is still on the device. `hydrationFailed` is the store's answer
   * to which one it is, and while it is set NOTHING below runs: not the
   * questionnaire, not the demo data, not the welcome step.
   */
  const showRecovery = hydrationFailed;

  // The guided iOS setup is itself onboarding. Do not paint this gate over it.
  const showOverlay =
    !showRecovery && state.hydrated && !state.onboarded && pathname !== '/ios-setup';
  const notifAvailable = Platform.OS === 'android' &&
    NotificationReader?.isAvailable?.() === true;

  const chooseGoal = (id: OnboardingGoalId) => {
    setGoalLimitAnnounced(false);
    setPlan((current) => {
      if (current.goalIds.includes(id)) {
        return { ...current, goalIds: current.goalIds.filter((goalId) => goalId !== id) };
      }
      if (current.goalIds.length >= 2) {
        setGoalLimitAnnounced(true);
        return current;
      }
      return { ...current, goalIds: [...current.goalIds, id] };
    });
  };

  const finishPreferences = () => {
    setOnboardingPlan(plan);
    setStep('capture');
  };

  const startScan = async () => {
    setSmsDenied(false);
    let granted = false;
    try {
      granted = await requestSmsPermission();
    } catch {
      setCompletionOutcome('failed');
      setStep('complete');
      return;
    }
    if (!granted) {
      setSmsDenied(true);
      setCompletionOutcome('denied');
      setStep('complete');
      return;
    }
    try {
      // A user may return from the manual completion screen and choose
      // automatic capture instead. Clear the durable opt-out before the first
      // read so setup cannot report success over a permanently blocked pipe.
      await setCaptureOptOut(false);
      setStep('scanning');
      const {
        parsed,
        reviewCandidates,
        newestTs,
        inboxHistoryComplete,
        detectedLaunchMarket,
        commit,
      } = await scanInbox(0, {}, (scanned, found) => setProgress({ scanned, found }));
      if (detectedLaunchMarket && detectedLaunchMarket !== state.marketId) {
        if (!setMarket(detectedLaunchMarket)) {
          throw new Error('market_mismatch');
        }
      }
      const reviewReceipt = stageReviewAlerts(reviewCandidates);
      await reviewReceipt.durable;
      const importPlan = buildImportPlan(
        parsed,
        detectedLaunchMarket ? { ...state, marketId: detectedLaunchMarket } : state,
        newestTs,
      );
      if (!inboxHistoryComplete) throw new Error('sms_history_incomplete');
      await importBatch({ ...importPlan.batch, parserRereadComplete: true }).durable;
      await commit();
      setResult({ tx: importPlan.txCount, accounts: importPlan.newAccountCount });
      setCompletionOutcome('automatic');
      setStep('complete');
      committed();
    } catch (error) {
      setResult({ tx: 0, accounts: 0 });
      if (Platform.OS === 'android' && isSmsInboxAccessError(error)) {
        setSmsDenied(true);
        setCompletionOutcome('denied');
      } else {
        setCompletionOutcome('failed');
      }
      setStep('complete');
    }
  };

  const beginCapture = async () => {
    if (Platform.OS === 'ios') {
      try {
        await setCaptureOptOut(false);
      } catch {
        setCompletionOutcome('failed');
        setStep('complete');
        return;
      }
      // The return query survives a cold route remount and tells the gate to
      // show the summary instead of restarting the questionnaire.
      router.push('/ios-setup?fromOnboarding=1');
      return;
    }
    if (Platform.OS === 'android' && isSmsScanningAvailable()) {
      void startScan();
      return;
    }
    setCompletionOutcome('manual');
    setStep('complete');
  };

  const continueManually = async () => {
    setSmsDenied(false);
    setResult(null);
    try {
      // This choice says "no SMS access" even when Android retained a grant
      // from an older install or test run. Persist the capture opt-out before
      // showing success so a mounted foreground importer cannot race it.
      await setCaptureOptOut(true);
      if (Platform.OS === 'ios') {
        // The user may have started Shortcut setup and then backed out. An
        // app-only flag is not enough: that Shortcut would still send bank
        // alerts and the background task could still collect them. Revoke the
        // actual relay identity before calling this choice complete.
        try {
          const relay = await getRelayConfigStrict();
          if (relay) {
            // Revoke the server-side ingest token first. Removing only the
            // local wake registration would still leave the installed
            // Shortcut able to forward bank alerts over the network.
            await unpairDevice(relay);
            setShortcutCleanup('revoked');
          }
        } catch {
          // A strict Keychain read failure is just as uncertain as a failed
          // revoke: absence was not proven, so never claim the Shortcut's
          // remote token is gone. Keep Retry available and show the immediate
          // local stop (delete the Shortcut).
          setShortcutCleanup('uncertain');
          throw new Error('relay_cleanup_uncertain');
        } finally {
          // Once the app is opted out, the local background registration is
          // redundant. Its cleanup is best-effort and must never prevent the
          // more important authenticated relay revocation above.
          try {
            await disableRelayBackgroundSync();
          } catch {
            // CaptureExecutor still enforces the durable opt-out.
          }
        }
      }
      setCompletionOutcome('manual');
      setStep('complete');
    } catch {
      setCompletionOutcome('failed');
      setStep('complete');
    }
  };

  const goBack = () => {
    const index = QUESTION_STEPS.indexOf(activeStep);
    if (activeStep === 'complete') {
      setStep('capture');
      if (params.onboarding) router.setParams({ onboarding: undefined });
    } else if (activeStep === 'scanning') {
      setStep('capture');
    } else if (index > 0) {
      setStep(QUESTION_STEPS[index - 1]);
    } else {
      setStep('welcome');
    }
  };

  const openWafra = () => {
    committed();
    setOnboarded();
  };

  /**
   * Recovery replaces the app outright rather than overlaying it.
   *
   * The onboarding overlay keeps `children` mounted underneath because
   * expo-router's state does not survive the navigator being swapped out. Here
   * that trade does not apply and the opposite one does: the screens under
   * this would be rendering an empty ledger as though it were the user's, and
   * `storageFailure` tells us it is not. Nothing reads better than nothing.
   */
  if (isPublicWebSurface()) return <>{children}</>;

  if (showRecovery) {
    return <StorageRecovery failure={storageFailure} recoveryState={storageRecoveryState} />;
  }

  // Do not render financial screens against the reducer's blank bootstrap
  // state. Besides flashing false AED 0 figures, mounting every tab here used
  // to start expensive ledger projections before encrypted hydration finished.
  if (!state.hydrated) {
    return (
      <View style={styles.loadingRoot} accessibilityLiveRegion="polite">
        <StatusBar style="light" />
        <View style={styles.markHalo}>
          <WafraMark size={44} color={night.primary} />
        </View>
        <ThemedText style={styles.loadingLabel}>{t('loadingLedger')}</ThemedText>
      </View>
    );
  }

  if (!showOverlay) return <>{children}</>;

  const entering = reducedMotion ? undefined : FadeInDown.duration(320);
  const automaticCompletion =
    params.onboarding === 'complete' || completionOutcome === 'automatic';
  const failedCompletion =
    activeStep === 'complete' && !automaticCompletion && completionOutcome === 'failed';

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View
        style={styles.hidden}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {children}
      </View>
      <View style={[StyleSheet.absoluteFillObject, styles.root]}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {activeStep === 'welcome' ? (
            <Animated.ScrollView
              entering={reducedMotion ? undefined : FadeIn.duration(400)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.welcomeBody}>
              <View style={styles.welcomeTop}>
                <View style={styles.brandLine}>
                  <View style={styles.markHalo}>
                    <WafraMark size={32} color={night.primary} />
                  </View>
                  <ThemedText style={styles.brandName}>{t('appName')}</ThemedText>
                </View>
                <ThemedText style={styles.eyebrow}>{t('onboardEyebrow')}</ThemedText>
                <ThemedText
                  style={styles.headline}
                  accessibilityRole="header"
                  // Display type must still fit as a heading at the largest
                  // accessibility sizes; body/list text below remains fully
                  // scalable and the whole surface remains scrollable.
                  maxFontSizeMultiplier={1.6}>
                  {t(Platform.OS === 'ios' ? 'iosOnboardHeadline' : 'onboardHeadline')}
                </ThemedText>
                <ThemedText style={styles.sub}>
                  {t(Platform.OS === 'ios' ? 'iosOnboardSub' : 'onboardSub')}
                </ThemedText>
              </View>
              <MoneyPreview reducedMotion={reducedMotion} />
              <View style={styles.welcomeActions}>
                <Button
                  label={t('onboardPersonalizeCta')}
                  onPress={() => setStep('goals')}
                  labelColor={night.onPrimary}
                  style={{ backgroundColor: night.primary }}
                />
                <View style={styles.setupTime}>
                  <Icon name="lock" size={14} color={night.textTertiary} />
                  <ThemedText style={styles.setupTimeText}>{t('onboardSetupTime')}</ThemedText>
                </View>
              </View>
            </Animated.ScrollView>
          ) : (
            <>
              {activeStep !== 'scanning' && <BackHeader step={activeStep} onBack={goBack} />}
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}>
                <Animated.View key={activeStep} entering={entering} style={styles.questionBody}>
                  {activeStep === 'goals' && (
                    <>
                      <View style={styles.questionTop}>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t('onboardGoalsTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>
                          {t('onboardGoalsBody')}
                        </ThemedText>
                      </View>
                      <View style={styles.choiceList}>
                        {GOAL_PRESETS.map((preset) => (
                          <SelectionRow
                            key={preset.id}
                            title={t(preset.titleKey)}
                            detail={t(preset.detailKey)}
                            icon={preset.icon}
                            selected={plan.goalIds.includes(preset.id)}
                            onPress={() => chooseGoal(preset.id)}
                            role="checkbox"
                            hint={t('onboardGoalSelectionHint')}
                          />
                        ))}
                      </View>
                      {goalLimitAnnounced && (
                        <ThemedText
                          accessibilityLiveRegion="polite"
                          style={[styles.inlineNote, { color: night.warning }]}>
                          {t('onboardGoalMax')}
                        </ThemedText>
                      )}
                      <View style={styles.questionActions}>
                        <Button
                          label={t('continueWord')}
                          disabled={plan.goalIds.length === 0}
                          onPress={() => setStep('budget')}
                          labelColor={night.onPrimary}
                          style={styles.primaryButton}
                        />
                      </View>
                    </>
                  )}

                  {activeStep === 'budget' && (
                    <>
                      <View style={styles.questionTop}>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t('onboardBudgetTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>
                          {t('onboardBudgetBody')}
                        </ThemedText>
                      </View>
                      <View style={styles.choiceList}>
                        {BUDGET_PRESETS.map((preset) => {
                          const icon: IconName = preset.id === 'essentials'
                            ? 'lock'
                            : preset.id === 'balanced'
                              ? 'target'
                              : 'spark';
                          return (
                            <SelectionRow
                              key={preset.id}
                              title={t(preset.titleKey)}
                              detail={t(preset.detailKey)}
                              icon={icon}
                              selected={plan.budgetId === preset.id}
                              onPress={() => setPlan((current) => ({
                                ...current,
                                budgetId: preset.id as OnboardingBudgetId,
                              }))}
                            />
                          );
                        })}
                      </View>
                      <View style={styles.deferredPlanNote}>
                        <Icon name="lock" size={16} color={night.primary} />
                        <ThemedText style={styles.deferredPlanText}>
                          {t('onboardPlanActivatesLater')}
                        </ThemedText>
                      </View>
                      <View style={styles.questionActions}>
                        <Button
                          label={t('onboardBudgetContinue')}
                          onPress={finishPreferences}
                          labelColor={night.onPrimary}
                          style={styles.primaryButton}
                        />
                      </View>
                    </>
                  )}

                  {activeStep === 'capture' && (
                    <>
                      <View style={styles.captureHero}>
                        <View style={styles.captureIcon}>
                          <Icon
                            name={Platform.OS === 'web' ? 'check' : 'mail'}
                            size={27}
                            color={night.primary}
                          />
                        </View>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t(capture.title)}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t(capture.body)}</ThemedText>
                      </View>
                      <View style={styles.startOptions}>
                        <StartOption automatic onPress={() => void beginCapture()} />
                        {Platform.OS !== 'web' && (
                          <StartOption automatic={false} onPress={() => void continueManually()} />
                        )}
                      </View>
                      {Platform.OS !== 'web' && (
                        <View style={styles.capturePrivacy}>
                          <Icon name="lock" size={17} color={night.textSecondary} />
                          <ThemedText style={styles.capturePrivacyText}>
                            {t(Platform.OS === 'ios'
                              ? 'onboardCapturePrivacyIos'
                              : 'onboardCapturePrivacyAndroid')}
                          </ThemedText>
                        </View>
                      )}
                      {Platform.OS === 'web' && (
                        <View style={styles.captureActions}>
                          <Button
                            label={t('continueWord')}
                            onPress={() => void beginCapture()}
                            labelColor={night.onPrimary}
                            style={styles.primaryButton}
                          />
                        </View>
                      )}
                    </>
                  )}

                  {activeStep === 'scanning' && (
                    <View
                      style={styles.scanning}
                      accessibilityLiveRegion="polite"
                      accessibilityLabel={tf('onboardScanProgress', {
                        read: progress.scanned,
                        matched: progress.found,
                      })}>
                      <View style={styles.captureIcon}>
                        <Icon name="mail" size={27} color={night.primary} />
                      </View>
                      <ThemedText style={styles.questionTitle} accessibilityRole="header">
                        {t('readingInbox')}
                      </ThemedText>
                      <ThemedText style={styles.questionBodyCopy}>
                        {tf('onboardScanProgress', {
                          read: progress.scanned,
                          matched: progress.found,
                        })}
                      </ThemedText>
                      <View style={styles.scanStats}>
                        <View style={styles.scanStat}>
                          <ThemedText style={styles.scanNumber}>{progress.scanned}</ThemedText>
                          <ThemedText style={styles.scanLabel}>{t('onboardAlertsChecked')}</ThemedText>
                        </View>
                        <View style={styles.scanDivider} />
                        <View style={styles.scanStat}>
                          <ThemedText style={[styles.scanNumber, { color: night.primary }]}>
                            {progress.found}
                          </ThemedText>
                          <ThemedText style={styles.scanLabel}>{t('onboardMoneyFound')}</ThemedText>
                        </View>
                      </View>
                    </View>
                  )}

                  {activeStep === 'complete' && (
                    <>
                      <View style={styles.completeHero}>
                        <View
                          style={[
                            styles.completeMark,
                            failedCompletion && { backgroundColor: night.warning },
                          ]}>
                          <Icon
                            name={failedCompletion ? 'alert' : 'check'}
                            size={30}
                            color={night.onPrimary}
                            strokeWidth={2.1}
                          />
                        </View>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t(
                            automaticCompletion
                                ? 'onboardCompleteTitle'
                                : completionOutcome === 'failed'
                                  ? 'onboardCompleteNeedsAttentionTitle'
                                  : 'onboardCompleteManualTitle'
                          )}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>
                          {t(
                            automaticCompletion
                                ? 'onboardCompleteBodyAutomatic'
                                : completionOutcome === 'failed'
                                  ? 'onboardCompleteNeedsAttentionBody'
                                  : 'onboardCompleteManualBody'
                          )}
                        </ThemedText>
                        {smsDenied && (
                          <View style={styles.permissionRecovery}>
                            <ThemedText
                              accessibilityLiveRegion="polite"
                              style={[styles.inlineNote, { color: night.warning }]}>
                              {t('onboardSmsDenied')}
                            </ThemedText>
                            <Button
                              variant="outline"
                              label={t('retryHistoryRead')}
                              onPress={() => void startScan()}
                              labelColor={night.text}
                              style={styles.ghost}
                            />
                            <Button
                              variant="outline"
                              label={t('openPhoneSettings')}
                              onPress={() => void Linking.openSettings().catch(() => {})}
                              labelColor={night.text}
                              style={styles.ghost}
                            />
                          </View>
                        )}
                        {result && result.tx > 0 && (
                          <View style={styles.resultCard}>
                            <View style={styles.resultCell}>
                              <ThemedText style={styles.resultNumber}>{result.tx}</ThemedText>
                              <ThemedText style={styles.resultLabel}>
                                {t(result.tx === 1 ? 'onboardEntryFound' : 'onboardEntriesFound')}
                              </ThemedText>
                            </View>
                            <View style={styles.resultDivider} />
                            <View style={styles.resultCell}>
                              <ThemedText style={styles.resultNumber}>{result.accounts}</ThemedText>
                              <ThemedText style={styles.resultLabel}>
                                {t(result.accounts === 1 ? 'onboardAccountFound' : 'onboardAccountsFound')}
                              </ThemedText>
                            </View>
                          </View>
                        )}
                        {state.onboardingPlan && (
                          <View style={styles.deferredPlanNote}>
                            <Icon name="target" size={16} color={night.primary} />
                            <ThemedText style={styles.deferredPlanText}>
                              {t('onboardPlanPending')}
                            </ThemedText>
                          </View>
                        )}
                      </View>

                      <View style={styles.captureActions}>
                        {notifAvailable && !NotificationReader?.isEnabled?.() && (
                          <>
                            <ThemedText style={styles.notifNote}>{t('notifNoteOnboard')}</ThemedText>
                            <Button
                              label={t('alsoReadNotifs')}
                              onPress={() => NotificationReader?.openSettings()}
                              labelColor={night.text}
                              style={styles.ghost}
                            />
                          </>
                        )}
                        <Button
                          label={t('openWafra')}
                          onPress={openWafra}
                          labelColor={night.onPrimary}
                          style={styles.primaryButton}
                        />
                      </View>
                    </>
                  )}
                </Animated.View>
              </ScrollView>
            </>
          )}
        </SafeAreaView>
      </View>
      <ConfirmSheet
        visible={shortcutCleanup !== null}
        onClose={() => setShortcutCleanup(null)}
        question={t('shortcutStillInstalledTitle')}
        body={t(shortcutCleanup === 'uncertain'
          ? 'shortcutCleanupUncertain'
          : 'shortcutCleanupLeft')}
        confirmLabel={t('iosOpenShortcutsApp')}
        cancelLabel={t('iosDone')}
        onConfirm={openShortcutsApp}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hidden: { ...StyleSheet.absoluteFillObject, opacity: 0 },
  root: { flex: 1, alignItems: 'center', backgroundColor: night.background },
  loadingRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    backgroundColor: night.background,
  },
  loadingLabel: {
    color: night.textSecondary,
    fontFamily: Fonts.sansMedium,
    fontSize: 14,
  },
  safe: { flex: 1, width: '100%', maxWidth: 520 },
  welcomeBody: {
    flexGrow: 1,
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.four,
    alignItems: 'stretch',
    gap: Spacing.four,
  },
  welcomeTop: { paddingTop: Spacing.three, gap: Spacing.two },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  markHalo: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: night.primarySoft,
  },
  brandName: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 17, letterSpacing: -0.3 },
  eyebrow: {
    paddingTop: Spacing.three,
    color: night.primary,
    fontFamily: Fonts.sansSemi,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.1,
  },
  headline: {
    fontFamily: Fonts.sansSemi,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1.25,
    color: night.text,
    maxWidth: 430,
  },
  sub: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 23, color: night.textSecondary },
  moneyPreview: {
    overflow: 'hidden',
    borderRadius: Radius.bottomSheet,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: night.cardBorder,
    backgroundColor: night.backgroundElement,
  },
  previewHeader: {
    alignItems: 'flex-start',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  previewOverline: { color: night.textTertiary, fontFamily: Fonts.sansSemi, fontSize: 11, lineHeight: 15, letterSpacing: 0.7 },
  livePill: {
    alignSelf: 'stretch',
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderRadius: Radius.full,
    backgroundColor: night.primarySoft,
  },
  liveLabel: { flexShrink: 1, color: night.primary, fontFamily: Fonts.sansSemi, fontSize: 11, lineHeight: 15, letterSpacing: 0.5 },
  previewRows: { paddingHorizontal: Spacing.three },
  previewRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  previewRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: night.cardBorder },
  previewIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  previewCopy: { flex: 1, gap: 2 },
  previewLabel: { color: night.text, fontFamily: Fonts.sansMedium, fontSize: 14, lineHeight: 19 },
  previewDetail: { color: night.textTertiary, fontFamily: Fonts.sans, fontSize: 11.5, lineHeight: 16 },
  previewFooter: {
    minHeight: 43,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: night.primaryBorder,
    backgroundColor: night.primarySoft,
  },
  previewFooterText: { flex: 1, color: night.primary, fontFamily: Fonts.sansMedium, fontSize: 11.5 },
  welcomeActions: { marginTop: 'auto', gap: Spacing.two },
  setupTime: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  setupTimeText: { flexShrink: 1, color: night.textTertiary, fontFamily: Fonts.sans, fontSize: 11.5, textAlign: 'center' },
  ghost: { borderWidth: 1, borderColor: night.cardBorderStrong },
  progressHeader: { paddingHorizontal: ScreenPadding, paddingTop: Spacing.two },
  progressTopline: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { minHeight: 44, flexDirection: 'row', gap: 4, alignItems: 'center' },
  backLabel: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12 },
  stepLabel: { color: night.textTertiary, fontFamily: Fonts.monoMedium, fontSize: 11 },
  progressTrack: { flexDirection: 'row', gap: 5 },
  progressSegment: { flex: 1, height: 3, borderRadius: 2 },
  scrollContent: { flexGrow: 1, paddingHorizontal: ScreenPadding, paddingBottom: Spacing.four },
  questionBody: { flex: 1, paddingTop: Spacing.five },
  questionTop: { gap: Spacing.two, marginBottom: Spacing.four },
  questionTitle: {
    fontFamily: Fonts.sansSemi,
    fontSize: 29,
    lineHeight: 36,
    letterSpacing: -0.8,
    color: night.text,
  },
  questionBodyCopy: { color: night.textSecondary, fontSize: 14, lineHeight: 22 },
  choiceList: { gap: Spacing.two + 2 },
  choice: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 2,
  },
  choiceIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceCopy: { flex: 1, minWidth: 0, gap: 2 },
  choiceTitle: { color: night.text, fontFamily: Fonts.sansMedium, fontSize: 14, lineHeight: 20 },
  choiceDetail: { color: night.textTertiary, fontSize: 11.5, lineHeight: 17 },
  selectionMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  questionActions: { marginTop: 'auto', paddingTop: Spacing.five },
  deferredPlanNote: {
    marginTop: Spacing.three,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderRadius: Radius.md,
    padding: Spacing.three,
    backgroundColor: night.primarySoft,
  },
  deferredPlanText: { flex: 1, color: night.textSecondary, fontSize: 12, lineHeight: 18 },
  inlineNote: { marginTop: Spacing.three, fontSize: 12, lineHeight: 18 },
  permissionRecovery: { gap: Spacing.two, width: '100%' },
  primaryButton: { marginTop: Spacing.four, backgroundColor: night.primary },
  captureHero: { gap: Spacing.three, alignItems: 'flex-start' },
  captureIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: night.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureActions: { marginTop: 'auto', paddingTop: Spacing.five, gap: Spacing.two },
  startOptions: { paddingTop: Spacing.four, gap: Spacing.two },
  startOption: {
    minHeight: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.sheet,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: night.cardBorder,
    backgroundColor: night.backgroundElement,
  },
  startOptionFeatured: { borderColor: night.primary, backgroundColor: night.primarySoft },
  startOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: night.backgroundSelected,
  },
  startOptionIconFeatured: { backgroundColor: night.backgroundElement },
  startOptionCopy: { flex: 1, gap: Spacing.one },
  startOptionTitleLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  startOptionTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 15, lineHeight: 20 },
  startOptionBody: { color: night.textSecondary, fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18 },
  recommendedPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: Radius.full, backgroundColor: night.primary },
  recommendedText: { color: night.onPrimary, fontFamily: Fonts.sansSemi, fontSize: 11, lineHeight: 15, letterSpacing: 0.3 },
  scanning: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  scanStats: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: Spacing.three,
    paddingVertical: Spacing.three,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: night.cardBorder,
  },
  scanStat: { flex: 1, alignItems: 'center', gap: Spacing.one },
  scanNumber: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 24, fontVariant: ['tabular-nums'] },
  scanLabel: { color: night.textTertiary, fontFamily: Fonts.sans, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  scanDivider: { width: StyleSheet.hairlineWidth, backgroundColor: night.cardBorder },
  completeHero: { gap: Spacing.three, alignItems: 'flex-start' },
  completeMark: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: night.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifNote: { color: night.textSecondary, fontSize: 12, lineHeight: 18 },
  resultCard: {
    width: '100%',
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: Spacing.two,
    paddingVertical: Spacing.three,
    borderRadius: Radius.sheet,
    borderCurve: 'continuous',
    backgroundColor: night.primarySoft,
  },
  resultCell: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  resultNumber: { color: night.primary, fontFamily: Fonts.monoSemi, fontSize: 28, fontVariant: ['tabular-nums'] },
  resultLabel: { color: night.textSecondary, fontFamily: Fonts.sans, fontSize: 11, textAlign: 'center' },
  resultDivider: { width: StyleSheet.hairlineWidth, backgroundColor: night.primaryBorder },
  capturePrivacy: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: night.cardBorder,
    borderRadius: Radius.md,
    padding: Spacing.three,
  },
  capturePrivacyText: {
    flex: 1,
    color: night.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
});

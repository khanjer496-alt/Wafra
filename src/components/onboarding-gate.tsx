import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
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
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { WafraMark } from '@/components/wafra-logo';
import { Colors, Fonts, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import {
  buildImportPlan,
  isSmsScanningAvailable,
  requestSmsPermission,
  scanInbox,
} from '@/lib/auto-import';
import { formatAmount } from '@/lib/format';
import { committed, tapped } from '@/lib/haptics';
import { getLanguage, t, tf, type StringKey } from '@/lib/i18n';
import {
  allOnboardingGoalTitles,
  BUDGET_PRESETS,
  buildOnboardingPlan,
  DEFAULT_ONBOARDING_ANSWERS,
  GOAL_PRESETS,
  type OnboardingAnswers,
  type OnboardingBudgetId,
  type OnboardingGoalId,
  type OnboardingMarketId,
} from '@/lib/onboarding';
import { useStore } from '@/lib/store';
import NotificationReader from '../../modules/notification-reader';

type Step =
  | 'welcome'
  | 'market'
  | 'goals'
  | 'budget'
  | 'month'
  | 'capture'
  | 'scanning'
  | 'complete';

// 'month' is deliberately absent. Asking a salary day up front is a question
// the app can answer for itself later, and it sat between the user and the
// thing they came for. The setting still exists in state with its default.
const QUESTION_STEPS: readonly Step[] = ['market', 'goals', 'budget', 'capture'];

/** Onboarding is night mode regardless of the OS theme: the first screen sets
 * the tone, and the mark is at its strongest on charcoal. */
const night = Colors.dark;

/**
 * THE PRIVACY CLAIM IS DIFFERENT ON IPHONE, AND IT HAS TO STILL BE TRUE.
 *
 * Do not collapse these two lists back into one. On Android the capture path is
 * modules/sms-reader: the inbox is parsed on-device and no bank-message text
 * ever leaves the phone, so the on-device claim is literally true and is stated
 * at full strength. On iPhone it is false. Apple lets no app read Messages, so
 * the only route is a Shortcuts automation the user builds, which POSTs each
 * alert to Wafra's relay. Telling an iPhone user the text never leaves the
 * phone would be a lie told on the exact screen where trust is established —
 * and it is the kind of claim App Review reads on a finance app.
 *
 * What replaces it on iOS is not a softer claim, it is a more specific one, and
 * it is the argument server/README.md actually makes: the relay parses, DROPS
 * the message text (no table for it, no log line), and seals the parsed row to
 * a key only this iPhone holds. Anything added here must survive that split —
 * a new bullet needs an iOS wording and an Android wording, not one that is
 * only checked on the platform the author happened to be testing on.
 *
 * The branch is Platform.OS, not a relay-capability probe, so the copy is
 * decided before any relay state is loaded and cannot flip mid-screen.
 */
function points(): [IconName, string, string][] {
  if (Platform.OS === 'ios') {
    return [
      ['mail', t('iosOnboardAutomatic'), t('iosOnboardAutomaticBody')],
      ['calendar', t('warnsBeforeMoneyLeaves'), t('onboardWarnsDetail')],
      ['lock', t('iosOnboardPrivate'), t('iosOnboardPrivateBody')],
    ];
  }
  return [
    ['mail', t('onboardReadsSms'), t('onboardPrivacyBody')],
    ['calendar', t('warnsBeforeMoneyLeaves'), t('onboardWarnsDetail')],
    ['lock', t('noServerTitle'), t('onboardNoServerDetail')],
  ];
}

function marketCopy(id: OnboardingMarketId) {
  return id === 'AE'
    ? {
        title: t('onboardMarketUae'),
        detail: t('onboardMarketUaeDetail'),
        flag: '🇦🇪',
      }
    : {
        title: t('onboardMarketSaudi'),
        detail: t('onboardMarketSaudiDetail'),
        flag: '🇸🇦',
      };
}

function captureCopy(): { title: StringKey; body: StringKey } {
  if (Platform.OS === 'ios') {
    return { title: 'onboardCaptureTitleIos', body: 'onboardCaptureBodyIos' };
  }
  if (Platform.OS === 'android') {
    return { title: 'onboardCaptureTitleAndroid', body: 'onboardCaptureBodyAndroid' };
  }
  return { title: 'onboardCaptureTitleWeb', body: 'onboardCaptureBodyWeb' };
}

function SelectionRow({
  title,
  detail,
  icon,
  leading,
  selected,
  onPress,
  role = 'radio',
  hint,
}: {
  title: string;
  detail: string;
  icon?: IconName;
  leading?: string;
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
        {icon ? (
          <Icon name={icon} size={19} color={selected ? night.onPrimary : night.textSecondary} />
        ) : (
          <ThemedText style={styles.flag}>{leading}</ThemedText>
        )}
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

function ProgressHeader({ step, onBack }: { step: Step; onBack: () => void }) {
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
    hydrationFailed,
    importBatch,
    setOnboarded,
    loadDemoData,
    setMarket,
    setMonthStartDay,
    upsertBudget,
    addGoal,
    deleteGoal,
  } = useStore();
  const [step, setStep] = useState<Step>('welcome');
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => ({
    ...DEFAULT_ONBOARDING_ANSWERS,
    marketId: state.marketId === 'SA' ? 'SA' : 'AE',
  }));
  const [progress, setProgress] = useState({ scanned: 0, found: 0 });
  const [result, setResult] = useState<{ tx: number; accounts: number } | null>(null);
  const [smsDenied, setSmsDenied] = useState(false);
  const [goalLimitAnnounced, setGoalLimitAnnounced] = useState(false);

  const activeStep: Step = params.onboarding === 'complete' ? 'complete' : step;
  const plan = useMemo(() => buildOnboardingPlan(answers, getLanguage()), [answers]);
  const budgetPreset = BUDGET_PRESETS.find((preset) => preset.id === answers.budgetId)!;
  const budgetValues = Object.values(budgetPreset.limitsByMarket[answers.marketId]).filter(
    (value): value is number => typeof value === 'number',
  );
  const budgetTotal = budgetValues.reduce((sum, value) => sum + value, 0);
  const currency = answers.marketId === 'SA' ? 'SAR' : 'AED';
  const capture = captureCopy();

  /**
   * A failed read is not a first run, and this gate is where that distinction
   * has to be made.
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
  const notifAvailable = Platform.OS === 'android' && NotificationReader != null;

  const updateAnswer = <K extends keyof OnboardingAnswers>(
    key: K,
    value: OnboardingAnswers[K],
  ) => setAnswers((current) => ({ ...current, [key]: value }));

  const chooseGoal = (id: OnboardingGoalId) => {
    setGoalLimitAnnounced(false);
    setAnswers((current) => {
      if (current.goalIds.includes(id)) {
        const remaining = current.goalIds.filter((goalId) => goalId !== id);
        return { ...current, goalIds: remaining };
      }
      if (current.goalIds.length >= 2) {
        setGoalLimitAnnounced(true);
        return current;
      }
      return { ...current, goalIds: [...current.goalIds, id] };
    });
  };

  /** Reconcile preset-owned rows so going back and changing an answer never
   * duplicates goals. Budgets are naturally idempotent because category is
   * their key in the store. */
  const savePlan = () => {
    const presetTitles = new Set(allOnboardingGoalTitles());
    state.goals.filter((goal) => presetTitles.has(goal.title)).forEach((goal) => deleteGoal(goal.id));
    setMarket(plan.answers.marketId);
    setMonthStartDay(plan.answers.monthStartDay);
    plan.budgets.forEach(upsertBudget);
    plan.goals.forEach(addGoal);
  };

  const finishQuestionnaire = () => {
    savePlan();
    setStep('capture');
  };

  const startScan = async () => {
    const granted = await requestSmsPermission();
    if (!granted) {
      setSmsDenied(true);
      setStep('complete');
      return;
    }
    setStep('scanning');
    try {
      const { parsed, newestTs } = await scanInbox(0, {}, (scanned, found) =>
        setProgress({ scanned, found }),
      );
      const importPlan = buildImportPlan(parsed, state, newestTs);
      importBatch(importPlan.batch);
      setResult({ tx: importPlan.txCount, accounts: importPlan.newAccountCount });
      setStep('complete');
      committed();
    } catch {
      setResult({ tx: 0, accounts: 0 });
      setStep('complete');
    }
  };

  const beginCapture = () => {
    if (Platform.OS === 'ios') {
      // The return query survives a cold route remount and tells the gate to
      // show the summary instead of restarting the questionnaire.
      router.push('/ios-setup?fromOnboarding=1');
      return;
    }
    if (Platform.OS === 'android' && isSmsScanningAvailable()) {
      void startScan();
      return;
    }
    setStep('complete');
  };

  const goBack = () => {
    const index = QUESTION_STEPS.indexOf(activeStep);
    if (activeStep === 'complete') {
      setStep('capture');
      if (params.onboarding) router.setParams({ onboarding: undefined });
    } else if (activeStep === 'scanning') {
      setStep('capture');
    } else if (index <= 0) {
      setStep('welcome');
    } else {
      setStep(QUESTION_STEPS[index - 1]);
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
  if (showRecovery) return <StorageRecovery failure={storageFailure} />;

  if (!showOverlay) return <>{children}</>;

  const entering = reducedMotion ? undefined : FadeInDown.duration(320);

  return (
    <View style={styles.container}>
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
                <View style={styles.markHalo}>
                  <WafraMark size={44} color={night.primary} />
                </View>
                <ThemedText style={styles.headline} accessibilityRole="header">
                  {t(Platform.OS === 'ios' ? 'iosOnboardHeadline' : 'onboardHeadline')}
                </ThemedText>
                <ThemedText style={styles.sub}>
                  {t(Platform.OS === 'ios' ? 'iosOnboardSub' : 'onboardSub')}
                </ThemedText>
              </View>

              <View style={styles.points}>
                {points().map(([icon, title, detail], index) => (
                  <View
                    key={title}
                    style={[
                      styles.point,
                      index > 0 && {
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: night.cardBorder,
                      },
                    ]}>
                    <View style={styles.pointIcon}>
                      <Icon name={icon} size={19} color={night.textSecondary} />
                    </View>
                    <View style={styles.pointText}>
                      <ThemedText style={styles.pointTitle}>{title}</ThemedText>
                      <ThemedText style={styles.pointDetail}>{detail}</ThemedText>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.actions}>
                <Button
                  label={t('onboardPersonalizeCta')}
                  onPress={() => setStep('market')}
                  labelColor={night.onPrimary}
                  style={{ backgroundColor: night.primary }}
                />
                <Button
                  variant="ghost"
                  label={t('startWithSample')}
                  onPress={loadDemoData}
                  labelColor={night.text}
                  style={styles.ghost}
                />
              </View>
            </Animated.ScrollView>
          ) : (
            <>
              {activeStep !== 'scanning' && <ProgressHeader step={activeStep} onBack={goBack} />}
              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}>
                <Animated.View key={activeStep} entering={entering} style={styles.questionBody}>
                  {activeStep === 'market' && (
                    <>
                      <View style={styles.questionTop}>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t('onboardMarketTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t('onboardMarketBody')}</ThemedText>
                      </View>
                      <View style={styles.choiceList}>
                        {(['AE', 'SA'] as const).map((id) => {
                          const copy = marketCopy(id);
                          return (
                            <SelectionRow
                              key={id}
                              title={copy.title}
                              detail={copy.detail}
                              leading={copy.flag}
                              selected={answers.marketId === id}
                              onPress={() => updateAnswer('marketId', id)}
                            />
                          );
                        })}
                      </View>
                      <Button
                        label={t('continueWord')}
                        onPress={() => setStep('goals')}
                        labelColor={night.onPrimary}
                        style={styles.primaryButton}
                      />
                    </>
                  )}

                  {activeStep === 'goals' && (
                    <>
                      <View style={styles.questionTop}>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t('onboardGoalsTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t('onboardGoalsBody')}</ThemedText>
                      </View>
                      <View style={styles.choiceList}>
                        {GOAL_PRESETS.map((preset) => (
                          <SelectionRow
                            key={preset.id}
                            title={t(preset.titleKey)}
                            detail={t(preset.detailKey)}
                            icon={preset.icon}
                            role="checkbox"
                            selected={answers.goalIds.includes(preset.id)}
                            hint={
                              !answers.goalIds.includes(preset.id) && answers.goalIds.length >= 2
                                ? t('onboardGoalMax')
                                : undefined
                            }
                            onPress={() => chooseGoal(preset.id)}
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
                      <Button
                        label={t('continueWord')}
                        disabled={answers.goalIds.length === 0}
                        onPress={() => setStep('budget')}
                        labelColor={night.onPrimary}
                        style={styles.primaryButton}
                      />
                    </>
                  )}

                  {activeStep === 'budget' && (
                    <>
                      <View style={styles.questionTop}>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t('onboardBudgetTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t('onboardBudgetBody')}</ThemedText>
                      </View>
                      <View style={styles.choiceList}>
                        {BUDGET_PRESETS.map((preset) => {
                          const values = Object.values(preset.limitsByMarket[answers.marketId]).filter(
                            (value): value is number => typeof value === 'number',
                          );
                          const total = values.reduce((sum, value) => sum + value, 0);
                          return (
                            <SelectionRow
                              key={preset.id}
                              title={t(preset.titleKey)}
                              detail={`${t(preset.detailKey)} · ${tf('onboardBudgetPreview', {
                                count: values.length,
                                amount: `${currency} ${formatAmount(total, { decimals: false })}`,
                              })}`}
                              icon="wallet"
                              selected={answers.budgetId === preset.id}
                              onPress={() =>
                                updateAnswer('budgetId', preset.id as OnboardingBudgetId)
                              }
                            />
                          );
                        })}
                      </View>
                      <Button
                        label={t('continueWord')}
                        onPress={finishQuestionnaire}
                        labelColor={night.onPrimary}
                        style={styles.primaryButton}
                      />
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
                      <View style={styles.planStrip}>
                        <View style={styles.planMetric}>
                          <ThemedText style={styles.planValue} tabular>{plan.goals.length}</ThemedText>
                          <ThemedText style={styles.planLabel}>{t('onboardSummaryGoals')}</ThemedText>
                        </View>
                        <View style={styles.planDivider} />
                        <View style={styles.planMetric}>
                          <ThemedText style={styles.planValue} tabular>{plan.budgets.length}</ThemedText>
                          <ThemedText style={styles.planLabel}>{t('onboardSummaryBudgets')}</ThemedText>
                        </View>
                        <View style={styles.planDivider} />
                        <View style={styles.planMetric}>
                          <ThemedText style={styles.planValue} tabular>
                            {currency} {formatAmount(budgetTotal, { decimals: false })}
                          </ThemedText>
                          <ThemedText style={styles.planLabel}>{t(budgetPreset.titleKey)}</ThemedText>
                        </View>
                      </View>
                      <View style={styles.captureActions}>
                        <Button
                          label={
                            Platform.OS === 'ios'
                              ? t('onboardCaptureIosCta')
                              : Platform.OS === 'android'
                                ? t('onboardCaptureAndroidCta')
                                : t('continueWord')
                          }
                          onPress={beginCapture}
                          labelColor={night.onPrimary}
                          style={styles.primaryButton}
                        />
                        {Platform.OS !== 'web' && (
                          <Button
                            variant="ghost"
                            label={t('onboardCaptureSkip')}
                            onPress={() => setStep('complete')}
                            labelColor={night.text}
                            style={styles.ghost}
                          />
                        )}
                      </View>
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
                    </View>
                  )}

                  {activeStep === 'complete' && (
                    <>
                      <View style={styles.completeHero}>
                        <View style={styles.completeMark}>
                          <Icon name="check" size={30} color={night.onPrimary} strokeWidth={2.1} />
                        </View>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t('onboardCompleteTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>
                          {tf('onboardCompleteBody', {
                            goals: plan.goals.length,
                            s: plan.goals.length === 1 ? '' : 's',
                            budgets: plan.budgets.length,
                            day: plan.answers.monthStartDay,
                          })}
                        </ThemedText>
                        {smsDenied && (
                          <ThemedText
                            accessibilityLiveRegion="polite"
                            style={[styles.inlineNote, { color: night.warning }]}>
                            {t('onboardSmsDenied')}
                          </ThemedText>
                        )}
                        {result && result.tx > 0 && (
                          <ThemedText style={[styles.inlineNote, { color: night.primary }]}>
                            {tf('onboardImportResult', {
                              entries: result.tx,
                              ending: result.tx === 1 ? 'y' : 'ies',
                              cards:
                                result.accounts > 0
                                  ? tf('onboardCardsFound', {
                                      count: result.accounts,
                                      s: result.accounts === 1 ? '' : 's',
                                    })
                                  : '',
                            })}
                          </ThemedText>
                        )}
                      </View>

                      <View style={styles.summaryList}>
                        <View style={styles.summaryRow}>
                          <Icon name="target" size={19} color={night.primary} />
                          <ThemedText style={styles.summaryTitle}>{t('onboardSummaryGoals')}</ThemedText>
                          <ThemedText style={styles.summaryValue} tabular>
                            {tf('onboardSummaryActive', { count: plan.goals.length })}
                          </ThemedText>
                        </View>
                        <View style={styles.summaryRow}>
                          <Icon name="wallet" size={19} color={night.primary} />
                          <ThemedText style={styles.summaryTitle}>{t('onboardSummaryBudgets')}</ThemedText>
                          <ThemedText style={styles.summaryValue} tabular>
                            {tf('onboardSummaryActive', { count: plan.budgets.length })}
                          </ThemedText>
                        </View>
                        <View style={styles.summaryRow}>
                          <Icon name="calendar" size={19} color={night.primary} />
                          <ThemedText style={styles.summaryTitle}>{t('onboardSummaryMonth')}</ThemedText>
                          <ThemedText style={styles.summaryValue} tabular>
                            {tf('onboardDayNumber', { day: plan.answers.monthStartDay })}
                          </ThemedText>
                        </View>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hidden: { ...StyleSheet.absoluteFillObject, opacity: 0 },
  root: { flex: 1, alignItems: 'center', backgroundColor: night.background },
  safe: { flex: 1, width: '100%', maxWidth: 520 },
  welcomeBody: {
    flex: 1,
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.four,
    alignItems: 'stretch',
    justifyContent: 'space-between',
  },
  welcomeTop: { paddingTop: Spacing.five, gap: Spacing.three },
  markHalo: {
    width: 58,
    height: 58,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: night.primarySoft,
  },
  headline: {
    fontFamily: Fonts.sansSemi,
    fontSize: 32,
    lineHeight: 39,
    letterSpacing: -1.05,
    color: night.text,
    maxWidth: 360,
  },
  sub: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 22, color: night.textSecondary },
  points: { paddingVertical: Spacing.three },
  point: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three - 2,
    paddingVertical: Spacing.three,
  },
  pointIcon: { width: 30, alignItems: 'center' },
  pointText: { flex: 1, gap: 2 },
  pointTitle: { fontFamily: Fonts.sansMedium, fontSize: 14.5, lineHeight: 20, color: night.text },
  pointDetail: { fontFamily: Fonts.sans, fontSize: 12, lineHeight: 18, color: night.textTertiary },
  actions: { gap: Spacing.two + 2 },
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
  flag: { fontSize: 20, lineHeight: 25 },
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
  inlineNote: { marginTop: Spacing.three, fontSize: 12, lineHeight: 18 },
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
  planStrip: {
    marginTop: Spacing.five,
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: night.cardBorder,
    paddingVertical: Spacing.three,
  },
  planMetric: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 3 },
  planValue: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 13, textAlign: 'center' },
  planLabel: { color: night.textTertiary, fontSize: 10, lineHeight: 14, textAlign: 'center' },
  planDivider: { width: StyleSheet.hairlineWidth, backgroundColor: night.cardBorder },
  captureActions: { marginTop: 'auto', paddingTop: Spacing.five, gap: Spacing.two },
  scanning: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  completeHero: { gap: Spacing.three, alignItems: 'flex-start' },
  completeMark: {
    width: 62,
    height: 62,
    borderRadius: 22,
    backgroundColor: night.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryList: {
    marginTop: Spacing.five,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: night.cardBorder,
  },
  summaryRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: night.cardBorder,
  },
  summaryTitle: { flex: 1, color: night.text, fontFamily: Fonts.sansMedium, fontSize: 13 },
  summaryValue: { color: night.textSecondary, fontFamily: Fonts.monoMedium, fontSize: 11 },
  notifNote: { color: night.textSecondary, fontSize: 12, lineHeight: 18 },
});

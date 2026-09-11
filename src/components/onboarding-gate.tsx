import { useLanguage } from '@/hooks/use-language';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
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
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Button } from '@/components/ui/controls';
import { Icon, type IconName } from '@/components/ui/icon';
import { MoneyPreview } from '@/components/onboarding/money-preview';
import { WafraMark } from '@/components/wafra-logo';
import { Colors, Fonts, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import {
  isSmsScanningAvailable,
  requestSmsPermission,
} from '@/lib/auto-import';
import { committed, tapped } from '@/lib/haptics';
import {
  GROWTH_PLACEMENTS,
  trackGrowthEvent,
} from '@/lib/growth-funnel';
import { t, tf, type StringKey } from '@/lib/i18n';
import { dispatchIosMessageSetup, loadIosMessageSetupProgress } from '@/lib/ios-message-onboarding';
import { disableRelayBackgroundSync } from '@/lib/background-relay';
import {
  BUDGET_PRESETS,
  DEFAULT_ONBOARDING_PLAN,
  FOCUS_PRESETS,
  GOAL_PRESETS,
  TRACKING_PRESETS,
  onboardingInsightKeys,
  onboardingLandingPath,
  onboardingResumeDestination,
  type OnboardingBudgetId,
  type OnboardingGoalId,
} from '@/lib/onboarding';
import { getRelayConfigStrict, unpairDevice } from '@/lib/relay';
import { openShortcutsApp } from '@/lib/shortcut-cleanup';
import { useStore } from '@/lib/store';
import type { OnboardingFocus, OnboardingTracking } from '@/lib/types';

type Step =
  | 'welcome'
  | 'focus'
  | 'tracking'
  | 'preview'
  | 'privacy'
  | 'goals'
  | 'budget'
  | 'capture'
  | 'scanning'
  | 'complete';
const JOURNEY_STEPS: readonly Step[] = ['focus', 'tracking', 'preview', 'privacy'];
const PLAN_STEPS: readonly Step[] = ['goals', 'budget'];
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

function StartOption({
  automatic,
  disabled,
  onPress,
}: {
  automatic: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const title = t(automatic
    ? Platform.OS === 'ios' ? 'onboardAutomaticChoiceIos' : 'onboardAutomaticChoice'
    : Platform.OS === 'ios' ? 'onboardManualChoiceIos' : 'onboardManualChoice');
  const body = t(automatic
    ? Platform.OS === 'ios' ? 'onboardAutomaticChoiceIosBody' : 'onboardAutomaticChoiceAndroidBody'
    : Platform.OS === 'web' ? 'onboardManualChoiceWebBody'
      : Platform.OS === 'ios' ? 'onboardManualChoiceIosBody' : 'onboardManualChoiceBody');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${body}`}
      accessibilityState={{ disabled, busy: disabled }}
      disabled={disabled}
      onPress={() => {
        tapped();
        onPress();
      }}
      style={({ pressed }) => [
        styles.startOption,
        { opacity: disabled ? 0.5 : pressed ? 0.72 : 1 },
      ]}>
      <View style={[styles.startOptionIcon, automatic && styles.startOptionIconFeatured]}>
        <Icon name={automatic ? Platform.OS === 'ios' ? 'bolt' : 'mail' : 'plus'} size={20} color={automatic ? night.primary : night.textSecondary} />
      </View>
      <View style={styles.startOptionCopy}>
        <View style={styles.startOptionTitleLine}>
          <ThemedText style={styles.startOptionTitle}>{title}</ThemedText>
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
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
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

function BackHeader({ step, onBack, progressSteps, disabled }: {
  step: Step; onBack: () => void; progressSteps: readonly Step[] | null; disabled: boolean;
}) {
  const steps = progressSteps ?? [];
  const index = steps.indexOf(step);
  const showProgress = index >= 0 && steps.length > 0;
  const visibleIndex = showProgress ? index : 0;
  return (
    <View style={styles.progressHeader}>
      <View style={styles.progressTopline}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('onboardBack')}
          accessibilityState={{ disabled }}
          disabled={disabled}
          hitSlop={10}
          onPress={() => {
            tapped();
            onBack();
          }}
          style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}>
          <Icon name="chevron-left" size={18} color={night.textSecondary} />
          <ThemedText style={styles.backLabel}>{t('onboardBack')}</ThemedText>
        </Pressable>
        {showProgress && <ThemedText style={styles.stepLabel}>
          {tf('onboardStepOf', { step: visibleIndex + 1, total: steps.length })}
        </ThemedText>}
      </View>
      {showProgress && <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 1, max: steps.length, now: visibleIndex + 1 }}>
        {steps.map((item, itemIndex) => (
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
      </View>}
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
  useLanguage();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ onboarding?: string }>();
  const router = useRouter();
  const motion = useMotionPreference();
  const reducedMotion = !motion.ready || motion.reducedMotion;
  const {
    state,
    storageFailure,
    storageRecoveryState,
    hydrationFailed,
    beginHistoryImport,
    ensureDurable,
    setOnboarded,
    setOnboardingPlan,
    setOnboardingProfile,
    setCaptureOptOut,
  } = useStore();
  const [step, setStep] = useState<Step>('welcome');
  const [focus, setFocus] = useState<OnboardingFocus | null>(null);
  const [tracking, setTracking] = useState<OnboardingTracking | null>(null);
  const [personalizing, setPersonalizing] = useState(false);
  const [resumeReady, setResumeReady] = useState(false);
  const [resumeFailed, setResumeFailed] = useState(false);
  const [resumeAttempt, setResumeAttempt] = useState(0);
  const resumeHandled = useRef(false);
  const previouslyOnboarded = useRef(false);
  const [plan, setPlan] = useState(() => ({
    ...DEFAULT_ONBOARDING_PLAN,
    goalIds: [...DEFAULT_ONBOARDING_PLAN.goalIds],
  }));
  const [goalLimitAnnounced, setGoalLimitAnnounced] = useState(false);
  const [progress] = useState({ scanned: 0, found: 0 });
  const [result, setResult] = useState<{ tx: number; accounts: number; bills: number } | null>(null);
  const [smsDenied, setSmsDenied] = useState(false);
  const [completionOutcome, setCompletionOutcome] = useState<CompletionOutcome>('manual');
  const [shortcutCleanup, setShortcutCleanup] = useState<ShortcutCleanupState>(null);
  const [learnMoreVisible, setLearnMoreVisible] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const setupBusyRef = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const [finishSaveFailed, setFinishSaveFailed] = useState(false);
  const requestedFirstEntry = useRef(false);
  const startedEventSent = useRef(false);

  const saveJourney = (
    stage: 'welcome' | 'focus' | 'tracking' | 'preview' | 'privacy' | 'capture' | 'complete',
    nextFocus: OnboardingFocus | null = focus,
    nextTracking: OnboardingTracking | null = tracking,
  ) => {
    setOnboardingProfile({
      v: 1,
      stage,
      focus: nextFocus,
      tracking: nextTracking,
      startedAt: state.onboardingProfile?.startedAt ?? Date.now(),
    });
  };

  useEffect(() => {
    if (!state.hydrated || state.onboarded || hydrationFailed || startedEventSent.current) return;
    startedEventSent.current = true;
    trackGrowthEvent('onboarding_started', {
      focus: state.onboardingProfile?.focus ?? null,
      tracking: state.onboardingProfile?.tracking ?? null,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
  }, [hydrationFailed, state.hydrated, state.onboarded, state.onboardingProfile]);

  useEffect(() => {
    if (!state.hydrated || hydrationFailed) return;
    if (previouslyOnboarded.current && !state.onboarded) {
      resumeHandled.current = false;
      setStep('welcome');
      setFocus(null);
      setTracking(null);
      setPlan({ ...DEFAULT_ONBOARDING_PLAN, goalIds: [...DEFAULT_ONBOARDING_PLAN.goalIds] });
      setPersonalizing(false);
      setResumeFailed(false);
    }
    previouslyOnboarded.current = state.onboarded;
    // These routes own their own handoff. Returning normally to the root must
    // re-read that progress, even when this gate stayed mounted underneath.
    if (!state.onboarded && Platform.OS === 'ios' &&
      (pathname === '/ios-setup' || pathname === '/import-sms')) {
      resumeHandled.current = false;
      setResumeReady(true);
      return;
    }
    if (resumeHandled.current) return;
    if (state.onboardingProfile) {
      setFocus(state.onboardingProfile.focus);
      setTracking(state.onboardingProfile.tracking);
    }
    if (state.onboardingPlan) {
      setPlan({ ...state.onboardingPlan, goalIds: [...state.onboardingPlan.goalIds] });
      setPersonalizing(true);
    }
    if (state.onboarded) {
      resumeHandled.current = true;
      setResumeReady(true);
      return;
    }
    setResumeReady(false);
    let cancelled = false;
    const restore = async () => {
      try {
        const saved = Platform.OS === 'ios' ? await loadIosMessageSetupProgress() : null;
        if (cancelled) return;
        const destination = onboardingResumeDestination({
          platform: Platform.OS,
          pendingIosSetup: saved?.returnToOnboarding === true,
          hasSavedPlan: state.onboardingPlan !== null,
          completedCallback: params.onboarding === 'complete',
          savedStage: state.onboardingProfile?.stage ?? null,
        });
        resumeHandled.current = true;
        if (destination === 'ios-setup') router.replace('/ios-setup?fromOnboarding=1');
        else setStep(destination);
        setResumeReady(true);
        setResumeFailed(false);
      } catch {
        if (!cancelled) setResumeFailed(true);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [state.hydrated, state.onboarded, state.onboardingPlan, state.onboardingProfile, hydrationFailed, pathname,
    params.onboarding, router, resumeAttempt]);

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

  // The guided iOS setup is itself onboarding. Keep these exemptions scoped
  // to iPhone so an Android deep link cannot bypass the first-run gate.
  const isIosSetupRoute = Platform.OS === 'ios' && (
    pathname === '/ios-setup' ||
    pathname === '/import-sms'
  );
  const showOverlay =
    !showRecovery &&
    state.hydrated &&
    (!state.onboarded || finishing) &&
    !isIosSetupRoute;
  // Serialize permission, cleanup and durable completion actions. A second tap
  // must never start the other capture choice while the first is unresolved.
  const runSetupAction = async (action: () => Promise<void>) => {
    if (setupBusyRef.current) return;
    setupBusyRef.current = true;
    setSetupBusy(true);
    try {
      await action();
    } finally {
      setupBusyRef.current = false;
      setSetupBusy(false);
    }
  };

  const chooseFocus = (id: OnboardingFocus) => {
    setFocus(id);
    saveJourney('focus', id, tracking);
    trackGrowthEvent('onboarding_focus_selected', {
      focus: id,
      tracking,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
  };

  const chooseTracking = (id: OnboardingTracking) => {
    setTracking(id);
    saveJourney('tracking', focus, id);
    trackGrowthEvent('onboarding_tracking_selected', {
      focus,
      tracking: id,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
  };

  const showValuePreview = () => {
    if (!focus || !tracking) return;
    saveJourney('preview');
    setStep('preview');
    trackGrowthEvent('onboarding_value_previewed', {
      focus,
      tracking,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
  };

  const showPrivacy = () => {
    saveJourney('privacy');
    setStep('privacy');
    trackGrowthEvent('onboarding_privacy_seen', {
      focus,
      tracking,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
  };

  const showCapture = () => {
    saveJourney('capture');
    setStep('capture');
  };

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
    setPersonalizing(false);
    saveJourney('capture');
    setStep('capture');
  };

  const startScan = async () => {
    setSmsDenied(false);
    trackGrowthEvent('capture_setup_started', { focus, tracking });
    let granted = false;
    try {
      granted = await requestSmsPermission();
    } catch {
      trackGrowthEvent('capture_setup_failed', { focus, tracking, outcome: 'failed' });
      setCompletionOutcome('failed');
      saveJourney('complete');
      setStep('complete');
      return;
    }
    if (!granted) {
      trackGrowthEvent('capture_permission_denied', { focus, tracking, outcome: 'denied' });
      setSmsDenied(true);
      setCompletionOutcome('denied');
      saveJourney('complete');
      setStep('complete');
      return;
    }
    trackGrowthEvent('capture_permission_granted', { focus, tracking, outcome: 'automatic' });
    try {
      // A user may return from the manual completion screen and choose
      // automatic capture instead. Clear the durable opt-out before the first
      // read so setup cannot report success over a permanently blocked pipe.
      await setCaptureOptOut(false);
      await beginHistoryImport();
      setCompletionOutcome('automatic');
      await openWafra(false, undefined, 'automatic');
    } catch {
      setResult({ tx: 0, accounts: 0, bills: 0 });
      trackGrowthEvent('capture_setup_failed', { focus, tracking, outcome: 'failed' });
      setCompletionOutcome('failed');
      saveJourney('complete');
      setStep('complete');
    }
  };

  const beginCapture = async () => {
    if (Platform.OS === 'ios') {
      trackGrowthEvent('capture_setup_started', { focus, tracking });
      try {
        await setCaptureOptOut(false);
      } catch {
        trackGrowthEvent('capture_setup_failed', { focus, tracking, outcome: 'failed' });
        setCompletionOutcome('failed');
        saveJourney('complete');
        setStep('complete');
        return;
      }
      // The return query survives a cold route remount and tells the gate to
      // show the summary instead of restarting the questionnaire.
      router.push('/ios-setup?fromOnboarding=1');
      return;
    }
    if (Platform.OS === 'android' && isSmsScanningAvailable()) {
      await startScan();
      return;
    }
    trackGrowthEvent('capture_setup_failed', { focus, tracking, outcome: 'failed' });
    setCompletionOutcome('failed');
    saveJourney('complete');
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
        await dispatchIosMessageSetup({ type: 'onboarding-return-cleared' });
      }
      trackGrowthEvent('manual_tracking_selected', { focus, tracking, outcome: 'manual' });
      setCompletionOutcome('manual');
      saveJourney('complete');
      setStep('complete');
    } catch {
      trackGrowthEvent('capture_setup_failed', { focus, tracking, outcome: 'failed' });
      setCompletionOutcome('failed');
      saveJourney('complete');
      setStep('complete');
    }
  };

  const goBack = () => {
    if (activeStep === 'complete') {
      setStep('capture');
      saveJourney('capture');
      if (params.onboarding) router.setParams({ onboarding: undefined });
    } else if (activeStep === 'capture') {
      setStep('privacy');
      saveJourney('privacy');
    } else if (activeStep === 'goals' || activeStep === 'scanning') {
      setStep('capture');
    } else if (activeStep === 'budget') {
      setStep('goals');
    } else if (activeStep === 'privacy') {
      setStep('preview');
      saveJourney('preview');
    } else if (activeStep === 'preview') {
      setStep('tracking');
      saveJourney('tracking');
    } else if (activeStep === 'tracking') {
      setStep('focus');
      saveJourney('focus');
    } else if (activeStep === 'focus') {
      setStep('welcome');
      saveJourney('welcome');
    } else {
      setStep('welcome');
      saveJourney('welcome');
    }
  };

  const openWafra = async (
    addFirstEntry = false,
    destination?: '/pro',
    outcomeOverride?: CompletionOutcome,
  ) => {
    setFinishing(true);
    requestedFirstEntry.current = addFirstEntry;
    try {
      saveJourney('complete');
      setOnboarded();
      await ensureDurable();
      trackGrowthEvent('onboarding_completed', {
        focus,
        tracking,
        outcome: outcomeOverride ?? completionOutcome,
        placement: GROWTH_PLACEMENTS.onboarding,
      });
      committed();
      if (addFirstEntry) router.push('/add-transaction');
      else router.replace(destination ?? onboardingLandingPath(focus));
      setFinishSaveFailed(false);
      setFinishing(false);
    } catch {
      setFinishSaveFailed(true);
      setCompletionOutcome('failed');
      setStep('complete');
    }
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
  if (!state.hydrated || (!resumeReady && !state.onboarded)) {
    return (
      <View style={styles.loadingRoot} accessibilityLiveRegion="polite">
        <StatusBar style="light" />
        <View style={styles.markHalo}>
          <WafraMark size={44} color={night.primary} />
        </View>
        <ThemedText style={styles.loadingLabel}>
          {t(resumeFailed ? 'onboardResumeError' : 'loadingLedger')}
        </ThemedText>
        {resumeFailed && (
          <Button wrapLabel label={t('storageRecoveryRetry')} onPress={() => {
            setResumeFailed(false);
            setResumeAttempt((value) => value + 1);
          }} />
        )}
      </View>
    );
  }

  if (!showOverlay) return <>{children}</>;

  const entering = reducedMotion ? undefined : FadeInDown.duration(320);
  const automaticCompletion =
    params.onboarding === 'complete' || completionOutcome === 'automatic';
  const failedCompletion =
    activeStep === 'complete' && !automaticCompletion && completionOutcome === 'failed';
  const insight = onboardingInsightKeys(focus);
  const outcomeKey: StringKey = focus === 'spending'
    ? 'onboardOutcomeSpending'
    : focus === 'bills'
      ? 'onboardOutcomeBills'
      : focus === 'cashflow'
        ? 'onboardOutcomeCashflow'
        : 'onboardOutcomeOverview';
  const trackingOutcomeKey: StringKey = tracking === 'none'
    ? 'onboardOutcomeTrackingNone'
    : tracking === 'bank-apps'
      ? 'onboardOutcomeTrackingBankApps'
      : tracking === 'spreadsheet'
        ? 'onboardOutcomeTrackingSpreadsheet'
        : tracking === 'finance-app'
          ? 'onboardOutcomeTrackingFinanceApp'
          : 'onboardOutcomeBody';
  const landingLabel = focus === 'spending'
    ? t('onboardOpenSpending')
    : focus === 'bills'
      ? t('onboardOpenBills')
      : t('onboardOpenHome');
  const discoveredResult = result ?? (
    state.transactions.length > 0 || state.accounts.length > 0 || state.bills.length > 0 || state.cardDues.length > 0
      ? {
          tx: state.transactions.length,
          accounts: state.accounts.filter((account) => !account.archived).length,
          bills: state.bills.length + state.cardDues.length,
        }
      : null
  );

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
              entering={reducedMotion || Platform.OS === 'android' ? undefined : FadeIn.duration(180)}
              showsVerticalScrollIndicator={false}
              testID="onboarding-welcome"
              contentContainerStyle={styles.welcomeBody}>
              <View style={styles.welcomeTop}>
                <View style={styles.brandLine}>
                  <View style={styles.markHalo}>
                    <WafraMark size={32} color={night.primary} />
                  </View>
                  <ThemedText style={styles.brandName}>{t('appName')}</ThemedText>
                </View>
                <ThemedText
                  style={styles.headline}
                  accessibilityRole="header">
                  {t('onboardHeadline')}
                </ThemedText>
                <ThemedText style={styles.sub}>
                  {t('onboardWelcomeBody')}
                </ThemedText>
              </View>
              <MoneyPreview reducedMotion={reducedMotion} />
              <View style={styles.welcomeActions}>
                <Button wrapLabel
                  label={t('onboardChooseStart')}
                  onPress={() => {
                    setPersonalizing(false);
                    saveJourney('focus');
                    setStep('focus');
                  }}
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
              {activeStep !== 'scanning' && <BackHeader step={activeStep} onBack={goBack}
                disabled={setupBusy || finishing}
                progressSteps={personalizing
                  ? (PLAN_STEPS.includes(activeStep) ? PLAN_STEPS : null)
                  : (JOURNEY_STEPS.includes(activeStep) ? JOURNEY_STEPS : null)} />}
              <ScrollView key={activeStep}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}>
                <Animated.View key={activeStep} entering={entering} style={styles.questionBody}>
                  {activeStep === 'focus' && (
                    <>
                      <View style={styles.questionTop}>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t('onboardFocusTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t('onboardFocusBody')}</ThemedText>
                      </View>
                      <View style={styles.choiceList} testID="onboarding-focus-options">
                        {FOCUS_PRESETS.map((preset) => (
                          <SelectionRow
                            key={preset.id}
                            title={t(preset.titleKey)}
                            detail={t(preset.detailKey)}
                            icon={preset.icon}
                            selected={focus === preset.id}
                            onPress={() => chooseFocus(preset.id)}
                          />
                        ))}
                      </View>
                      <View style={styles.questionActions}>
                        <Button wrapLabel
                          label={t('continueWord')}
                          disabled={!focus}
                          onPress={() => {
                            if (!focus) return;
                            saveJourney('tracking');
                            setStep('tracking');
                          }}
                          labelColor={night.onPrimary}
                          style={styles.primaryButton}
                        />
                      </View>
                    </>
                  )}

                  {activeStep === 'tracking' && (
                    <>
                      <View style={styles.questionTop}>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t('onboardTrackingTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t('onboardTrackingBody')}</ThemedText>
                      </View>
                      <View style={styles.choiceList} testID="onboarding-tracking-options">
                        {TRACKING_PRESETS.map((preset) => (
                          <SelectionRow
                            key={preset.id}
                            title={t(preset.titleKey)}
                            detail={t(preset.detailKey)}
                            icon={preset.icon}
                            selected={tracking === preset.id}
                            onPress={() => chooseTracking(preset.id)}
                          />
                        ))}
                      </View>
                      <View style={styles.questionActions}>
                        <Button wrapLabel
                          label={t('continueWord')}
                          disabled={!tracking}
                          onPress={showValuePreview}
                          labelColor={night.onPrimary}
                          style={styles.primaryButton}
                        />
                      </View>
                    </>
                  )}

                  {activeStep === 'preview' && (
                    <>
                      <View style={styles.questionTop}>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t('onboardOutcomeTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t(trackingOutcomeKey)}</ThemedText>
                      </View>
                      <View style={styles.valuePreview} testID="onboarding-value-preview">
                        <View style={styles.valueStep}>
                          <View style={styles.valueStepIcon}><Icon name="mail" size={20} color={night.primary} /></View>
                          <View style={styles.valueStepCopy}>
                            <ThemedText style={styles.valueStepTitle}>{t('onboardSampleBefore')}</ThemedText>
                            <ThemedText style={styles.choiceDetail}>{t('onboardSampleMessage')}</ThemedText>
                          </View>
                        </View>
                        <View style={styles.valueConnector} />
                        <View style={styles.valueStep}>
                          <View style={styles.valueStepIcon}><Icon name="check" size={20} color={night.primary} /></View>
                          <View style={styles.valueStepCopy}>
                            <ThemedText style={styles.valueStepTitle}>{t('onboardSampleAfter')}</ThemedText>
                            <ThemedText style={styles.choiceDetail}>{t('onboardPreviewFooter')}</ThemedText>
                          </View>
                        </View>
                        <View style={styles.valueConnector} />
                        <View style={[styles.valueStep, styles.valueStepFinal]}>
                          <View style={[styles.valueStepIcon, styles.valueStepIconFinal]}>
                            <Icon name={focus === 'bills' ? 'receipt' : focus === 'cashflow' ? 'trend' : focus === 'overview' ? 'wallet' : 'chart'} size={20} color={night.onPrimary} />
                          </View>
                          <View style={styles.valueStepCopy}>
                            <ThemedText style={styles.valueStepTitle}>{t(insight.title)}</ThemedText>
                            <ThemedText style={styles.choiceDetail}>{t(outcomeKey)}</ThemedText>
                          </View>
                        </View>
                      </View>
                      <View style={styles.questionActions}>
                        <Button wrapLabel
                          label={t('continueWord')}
                          onPress={showPrivacy}
                          labelColor={night.onPrimary}
                          style={styles.primaryButton}
                        />
                      </View>
                    </>
                  )}

                  {activeStep === 'privacy' && (
                    <>
                      <View style={styles.questionTop}>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t('onboardPrivacyTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t('onboardDataControlBody')}</ThemedText>
                      </View>
                      <View style={styles.privacyList} testID="onboarding-privacy-points">
                        {([
                          ['lock', 'onboardPrivacyLocalTitle', 'onboardPrivacyLocalBody'],
                          ['bank', 'onboardPrivacyNoLoginTitle', 'onboardPrivacyNoLoginBody'],
                          ['repeat', 'onboardPrivacyChoiceTitle', 'onboardPrivacyChoiceBody'],
                        ] as const).map(([icon, titleKey, bodyKey]) => (
                          <View key={titleKey} style={styles.privacyPoint}>
                            <View style={styles.privacyPointIcon}>
                              <Icon name={icon} size={19} color={night.primary} />
                            </View>
                            <View style={styles.valueStepCopy}>
                              <ThemedText style={styles.valueStepTitle}>{t(titleKey)}</ThemedText>
                              <ThemedText style={styles.choiceDetail}>{t(bodyKey)}</ThemedText>
                            </View>
                          </View>
                        ))}
                      </View>
                      <View style={styles.questionActions}>
                        <Button wrapLabel
                          label={t('onboardPrivacyContinue')}
                          onPress={showCapture}
                          labelColor={night.onPrimary}
                          style={styles.primaryButton}
                        />
                      </View>
                    </>
                  )}

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
                        <Button wrapLabel
                          label={t('continueWord')}
                          disabled={plan.goalIds.length === 0}
                          onPress={() => setStep('budget')}
                          labelColor={night.onPrimary}
                          style={styles.primaryButton}
                        />
                        <Button wrapLabel variant="outline" label={t('onboardSkipPersonalization')}
                          onPress={() => { setPersonalizing(false); saveJourney('capture'); setStep('capture'); }}
                          labelColor={night.text} style={styles.ghost} />
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
                        <Button wrapLabel
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
                      {Platform.OS === 'ios' ? (
                        <View style={styles.captureActions} testID="onboarding-start-options">
                          <Button
                            wrapLabel
                            label={t('onboardAutomaticChoiceIos')}
                            onPress={() => void runSetupAction(beginCapture)}
                            disabled={setupBusy}
                            labelColor={night.onPrimary}
                            style={styles.primaryButton}
                          />
                          <Pressable
                            accessibilityRole="button"
                            disabled={setupBusy}
                            accessibilityState={{ disabled: setupBusy }}
                            onPress={() => void runSetupAction(continueManually)}
                            style={({ pressed }) => [styles.skipCaptureButton, { opacity: pressed ? 0.6 : 1 }]}>
                            <ThemedText style={styles.skipCaptureText}>{t('onboardManualChoiceIos')}</ThemedText>
                          </Pressable>
                        </View>
                      ) : (
                        <View style={styles.startOptions} testID="onboarding-start-options">
                          {Platform.OS !== 'web' && (
                            <StartOption automatic disabled={setupBusy} onPress={() => void runSetupAction(beginCapture)} />
                          )}
                          <StartOption automatic={false} disabled={setupBusy} onPress={() => void runSetupAction(continueManually)} />
                        </View>
                      )}
                      {setupBusy && <ThemedText style={styles.inlineNote} accessibilityLiveRegion="polite">
                        {t('onboardSetupWorking')}
                      </ThemedText>}
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
                      {Platform.OS !== 'ios' && (
                      <Pressable accessibilityRole="button" disabled={setupBusy}
                        accessibilityState={{ disabled: setupBusy }}
                        accessibilityLabel={t(state.onboardingPlan ? 'onboardEditPlan' : 'onboardPersonalizeOptional')}
                        accessibilityHint={t(state.onboardingPlan ? 'onboardSavedPlanNote' : 'onboardOptionalPlanNote')}
                        onPress={() => { tapped(); setPersonalizing(true); setStep('goals'); }}
                        style={({ pressed }) => [styles.personalizeRow, { opacity: pressed ? 0.65 : 1 }]}>
                        <View style={styles.choiceCopy}>
                          <ThemedText style={styles.choiceTitle}>
                            {t(state.onboardingPlan ? 'onboardEditPlan' : 'onboardPersonalizeOptional')}
                          </ThemedText>
                          <ThemedText style={styles.choiceDetail}>
                            {t(state.onboardingPlan ? 'onboardSavedPlanNote' : 'onboardOptionalPlanNote')}
                          </ThemedText>
                        </View>
                        <Icon name="chevron-right" size={18} color={night.textSecondary} />
                      </Pressable>
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
                            (failedCompletion || smsDenied) && { backgroundColor: night.warning },
                          ]}>
                          <Icon
                            name={failedCompletion || smsDenied ? 'alert' : 'check'}
                            size={30}
                            color={night.onPrimary}
                            strokeWidth={2.1}
                          />
                        </View>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t(
                            finishSaveFailed ? 'onboardFinishSaveFailedTitle'
                              : automaticCompletion
                                ? 'onboardCompleteTitle'
                                : smsDenied ? 'onboardPermissionChoiceTitle'
                                : completionOutcome === 'failed'
                                  ? 'onboardCompleteNeedsAttentionTitle'
                                  : 'onboardCompleteManualTitle'
                          )}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>
                          {t(
                            finishSaveFailed ? 'onboardFinishSaveFailedBody'
                              : automaticCompletion
                                ? 'onboardCompleteBodyAutomatic'
                                : smsDenied ? 'onboardPermissionChoiceBody'
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
                            <Button wrapLabel
                              variant="outline"
                              label={t('retryHistoryRead')}
                              onPress={() => void runSetupAction(startScan)} disabled={setupBusy}
                              labelColor={night.text}
                              style={styles.ghost}
                            />
                            <Button wrapLabel
                              variant="outline"
                              label={t('openPhoneSettings')}
                              onPress={() => void Linking.openSettings().catch(() => {})}
                              labelColor={night.text}
                              style={styles.ghost}
                            />
                          </View>
                        )}
                        {discoveredResult && discoveredResult.tx > 0 && (
                          <View style={styles.resultCard}>
                            <View style={styles.resultCell}>
                              <ThemedText style={styles.resultNumber}>{discoveredResult.tx}</ThemedText>
                              <ThemedText style={styles.resultLabel}>
                                {t(discoveredResult.tx === 1 ? 'onboardEntryFound' : 'onboardEntriesFound')}
                              </ThemedText>
                            </View>
                            <View style={styles.resultDivider} />
                            <View style={styles.resultCell}>
                              <ThemedText style={styles.resultNumber}>{discoveredResult.accounts}</ThemedText>
                              <ThemedText style={styles.resultLabel}>
                                {t(discoveredResult.accounts === 1 ? 'onboardAccountFound' : 'onboardAccountsFound')}
                              </ThemedText>
                            </View>
                            <View style={styles.resultDivider} />
                            <View style={styles.resultCell}>
                              <ThemedText style={styles.resultNumber}>{discoveredResult.bills}</ThemedText>
                              <ThemedText style={styles.resultLabel}>{t('onboardBillsFound')}</ThemedText>
                            </View>
                          </View>
                        )}
                        {!failedCompletion && !smsDenied && (
                          <View style={styles.firstInsight} testID="onboarding-first-insight">
                            <View style={styles.firstInsightIcon}>
                              <Icon
                                name={focus === 'bills' ? 'receipt' : focus === 'cashflow' ? 'trend' : focus === 'overview' ? 'wallet' : 'chart'}
                                size={20}
                                color={night.primary}
                              />
                            </View>
                            <View style={styles.valueStepCopy}>
                              <ThemedText style={styles.valueStepTitle}>{t(insight.title)}</ThemedText>
                              <ThemedText style={styles.choiceDetail}>{t(insight.body)}</ThemedText>
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
                        {discoveredResult && discoveredResult.tx > 0 && !failedCompletion && !smsDenied && (
                          <View style={styles.proPreview}>
                            <View style={styles.proPreviewCopy}>
                              <ThemedText style={styles.valueStepTitle}>{t('onboardProPreviewTitle')}</ThemedText>
                              <ThemedText style={styles.choiceDetail}>{t('onboardProPreviewBody')}</ThemedText>
                            </View>
                            <Button
                              wrapLabel
                              variant="outline"
                              label={t('onboardProPreviewAction')}
                              labelColor={night.text}
                              style={styles.ghost}
                              onPress={() => void runSetupAction(async () => {
                                trackGrowthEvent('post_import_pro_opened', {
                                  focus,
                                  tracking,
                                  placement: GROWTH_PLACEMENTS.postImportPro,
                                });
                                await openWafra(false, '/pro');
                              })}
                            />
                          </View>
                        )}
                      </View>

                      <View style={styles.captureActions}>
                        {finishSaveFailed ? <Button wrapLabel label={t('storageRecoveryRetry')}
                          onPress={() => void runSetupAction(() => openWafra(requestedFirstEntry.current))}
                          disabled={setupBusy} labelColor={night.onPrimary} style={styles.primaryButton} />
                        : completionOutcome === 'manual' && !automaticCompletion ? <>
                          <Button wrapLabel label={t('onboardAddFirstEntry')}
                            onPress={() => void runSetupAction(() => openWafra(true))}
                            disabled={setupBusy} labelColor={night.onPrimary} style={styles.primaryButton} />
                          <Button wrapLabel variant="ghost" label={landingLabel}
                            onPress={() => void runSetupAction(() => openWafra())}
                            disabled={setupBusy} labelColor={night.text} />
                        </> : failedCompletion || smsDenied ? <>
                          <Button wrapLabel label={t('onboardRetrySetup')}
                            onPress={goBack} disabled={setupBusy}
                            labelColor={night.onPrimary} style={styles.primaryButton} />
                          <Button wrapLabel variant="outline" label={t('onboardManualChoice')}
                            onPress={() => void runSetupAction(continueManually)} disabled={setupBusy}
                            labelColor={night.text} style={styles.ghost} />
                        </> : <Button wrapLabel label={landingLabel}
                          onPress={() => void runSetupAction(() => openWafra())} disabled={setupBusy}
                          labelColor={night.onPrimary} style={styles.primaryButton} />}

                      </View>
                    </>
                  )}
                </Animated.View>
              </ScrollView>
            </>
          )}
          <BottomSheet
            visible={learnMoreVisible}
            onClose={() => setLearnMoreVisible(false)}
            title={t('onboardCaptureLearnMoreTitle')}>
            <View style={styles.learnMoreContent}>
              <ThemedText style={styles.learnMoreText}>{t('onboardCaptureLearnMorePrivacy')}</ThemedText>
              <ThemedText style={styles.learnMoreText}>{t('onboardCaptureLearnMoreRetention')}</ThemedText>
              <ThemedText style={styles.learnMoreText}>{t('onboardCaptureLearnMoreLegacy')}</ThemedText>
              <ThemedText style={styles.learnMoreText}>{t('onboardCaptureLearnMoreLimits')}</ThemedText>
            </View>
          </BottomSheet>
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
  welcomeTop: { paddingTop: Spacing.three, gap: Spacing.three },
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
    lineHeight: 42,
    letterSpacing: -0.6,
    color: night.text,
    maxWidth: 430,
  },
  sub: { fontFamily: Fonts.sans, fontSize: 16, lineHeight: 24, color: night.textSecondary },
  welcomeActions: { marginTop: 'auto', gap: Spacing.two },
  setupTime: { minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  setupTimeText: { flexShrink: 1, color: night.textTertiary, fontFamily: Fonts.sans, fontSize: 13, textAlign: 'center' },
  ghost: { borderWidth: 1, borderColor: night.cardBorderStrong },
  progressHeader: { paddingHorizontal: ScreenPadding, paddingTop: Spacing.two },
  progressTopline: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  back: { minHeight: 48, flexDirection: 'row', gap: 4, alignItems: 'center' },
  backLabel: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12 },
  stepLabel: { color: night.textTertiary, fontFamily: Fonts.monoMedium, fontSize: 11 },
  progressTrack: { flexDirection: 'row', gap: 5 },
  progressSegment: { flex: 1, height: 3, borderRadius: 2 },
  scrollContent: { flexGrow: 1, paddingHorizontal: ScreenPadding, paddingBottom: Spacing.four },
  questionBody: { flex: 1, paddingTop: Spacing.four },
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
  choiceDetail: { color: night.textTertiary, fontSize: 13, lineHeight: 20 },
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
  captureHero: { gap: Spacing.two, alignItems: 'flex-start' },
  captureIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: night.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personalizeRow: { marginTop: Spacing.four, paddingVertical: Spacing.three,
    minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, borderColor: night.cardBorderStrong,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  captureActions: { marginTop: 'auto', paddingTop: Spacing.five, gap: Spacing.two },
  skipCaptureButton: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  skipCaptureText: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 14 },
  startOptions: { paddingTop: Spacing.three, gap: Spacing.two },
  startOption: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.sheet,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: night.controlBorder,
    backgroundColor: night.backgroundElement,
  },
  startOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: night.backgroundSelected,
  },
  startOptionIconFeatured: { backgroundColor: night.backgroundElement },
  startOptionCopy: { flex: 1, minWidth: 0, gap: Spacing.one },
  startOptionTitleLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two },
  startOptionTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 15, lineHeight: 20 },
  startOptionBody: { color: night.textSecondary, fontFamily: Fonts.sans, fontSize: 14, lineHeight: 21 },
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
  valuePreview: {
    borderRadius: Radius.sheet,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: night.cardBorder,
    backgroundColor: night.backgroundElement,
    padding: Spacing.three,
  },
  valueStep: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  valueStepFinal: {
    borderRadius: Radius.md,
    backgroundColor: night.primarySoft,
    paddingHorizontal: Spacing.two,
  },
  valueStepIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: night.backgroundSelected,
  },
  valueStepIconFinal: { backgroundColor: night.primary },
  valueStepCopy: { flex: 1, minWidth: 0, gap: 3 },
  valueStepTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 14, lineHeight: 20 },
  valueConnector: {
    width: 1,
    height: 12,
    marginLeft: 19,
    backgroundColor: night.cardBorderStrong,
  },
  privacyList: { gap: Spacing.two },
  privacyPoint: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: night.cardBorder,
    backgroundColor: night.backgroundElement,
  },
  privacyPointIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: night.primarySoft,
  },
  firstInsight: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: night.primaryBorder,
    backgroundColor: night.backgroundElement,
  },
  firstInsightIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: night.primarySoft,
  },
  proPreview: {
    width: '100%',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  proPreviewCopy: { gap: 3 },
  capturePrivacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  capturePrivacyText: {
    flex: 1,
    color: night.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  learnMoreButton: { marginTop: Spacing.two },
  learnMoreContent: { gap: Spacing.three },
  learnMoreText: { color: night.textSecondary, fontSize: 14, lineHeight: 21 },
});

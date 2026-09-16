import { useLanguage } from '@/hooks/use-language';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import {
  AppState as RNAppState,
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
import { Icon } from '@/components/ui/icon';
import {
  CaptureMarketScene,
  FocusChooser,
  IntentionChooser,
  OnboardingAtmosphere,
  PersonalizedProductPreview,
  TrackingChooser,
  WafraTile,
  WelcomeMoneyScene,
} from '@/components/onboarding/alive-scenes';
import { WafraMark } from '@/components/wafra-logo';
import { Colors, Fonts, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import {
  hasBankNotificationSystemAccess,
  hasSmsPermission,
  isSmsScanningAvailable,
  openBankNotificationAccessSettings,
  requestSmsPermission,
} from '@/lib/auto-import';
import { committed, tapped } from '@/lib/haptics';
import {
  cancelDailySummary,
  requestVisibleNotificationPermission,
  syncDailySummary,
} from '@/lib/notifications';
import {
  GROWTH_PLACEMENTS,
  trackGrowthEvent,
} from '@/lib/growth-funnel';
import { t, tf, type StringKey } from '@/lib/i18n';
import { dispatchIosMessageSetup, loadIosMessageSetupProgress } from '@/lib/ios-message-onboarding';
import { disableRelayBackgroundSync } from '@/lib/background-relay';
import {
  onboardingInsightKeys,
  onboardingLandingPath,
  onboardingResumeDestination,
} from '@/lib/onboarding';
import { bankNotificationAdmissionExpiresAt } from '@/lib/trusted-bank-notification-packages';
import { getRelayConfigStrict, unpairDevice } from '@/lib/relay';
import { openShortcutsApp } from '@/lib/shortcut-cleanup';
import { useStore } from '@/lib/store';
import type { OnboardingFocus, OnboardingIntention, OnboardingTracking } from '@/lib/types';
import NotificationReader from '../../modules/notification-reader';

type Step =
  | 'welcome'
  | 'focus'
  | 'tracking'
  | 'intention'
  | 'preview'
  | 'capture'
  | 'complete';
const JOURNEY_STEPS: readonly Step[] = ['focus', 'tracking', 'intention', 'preview'];
const STEP_TRANSITION_MS = 350;
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
    setOnboardingProfile,
    setCaptureOptOut,
    setAndroidCaptureSources,
    setDailySummary,
  } = useStore();
  const [step, setStep] = useState<Step>('welcome');
  const [focus, setFocus] = useState<OnboardingFocus | null>(null);
  const [tracking, setTracking] = useState<OnboardingTracking | null>(null);
  const [intention, setIntention] = useState<OnboardingIntention | null>(null);
  const [resumeReady, setResumeReady] = useState(false);
  const [resumeFailed, setResumeFailed] = useState(false);
  const [resumeAttempt, setResumeAttempt] = useState(0);
  const resumeHandled = useRef(false);
  const previouslyOnboarded = useRef(false);
  const [result, setResult] = useState<{ tx: number; accounts: number; bills: number } | null>(null);
  const [smsDenied, setSmsDenied] = useState(false);
  const [androidSmsReady, setAndroidSmsReady] = useState(false);
  const [androidNotificationReady, setAndroidNotificationReady] = useState(false);
  const [awaitingNotificationAccess, setAwaitingNotificationAccess] = useState(false);
  const [completionOutcome, setCompletionOutcome] = useState<CompletionOutcome>('manual');
  const [shortcutCleanup, setShortcutCleanup] = useState<ShortcutCleanupState>(null);
  const [learnMoreVisible, setLearnMoreVisible] = useState(false);
  const [setupBusy, setSetupBusy] = useState(false);
  const setupBusyRef = useRef(false);
  const [transitioning, setTransitioning] = useState(false);
  const stepTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishSaveFailed, setFinishSaveFailed] = useState(false);
  const requestedFirstEntry = useRef(false);
  const requestedDestination = useRef<'/pro' | undefined>(undefined);
  const notificationDecisionMade = useRef(false);
  const [pendingOpen, setPendingOpen] = useState<{
    addFirstEntry: boolean;
    destination?: '/pro';
    outcomeOverride?: CompletionOutcome;
  } | null>(null);
  const startedEventSent = useRef(false);

  useEffect(() => () => {
    if (stepTransitionTimer.current !== null) clearTimeout(stepTransitionTimer.current);
    stepTransitionTimer.current = null;
  }, []);

  const beginStepTransition = (): boolean => {
    if (stepTransitionTimer.current !== null || setupBusyRef.current || finishing) return false;
    setTransitioning(true);
    // Adjacent steps share button positions. Ignore the second physical tap
    // while the new step settles, including when reduced motion is enabled.
    stepTransitionTimer.current = setTimeout(() => {
      stepTransitionTimer.current = null;
      setTransitioning(false);
    }, STEP_TRANSITION_MS);
    return true;
  };

  const saveJourney = (
    stage: 'welcome' | 'focus' | 'tracking' | 'intention' | 'preview' | 'capture' | 'complete',
    nextFocus: OnboardingFocus | null = focus,
    nextTracking: OnboardingTracking | null = tracking,
    nextIntention: OnboardingIntention | null = intention,
  ) => {
    setOnboardingProfile({
      v: 1,
      stage,
      focus: nextFocus,
      tracking: nextTracking,
      intention: nextIntention,
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
      setIntention(null);
      setResumeFailed(false);
      setAndroidSmsReady(false);
      setAndroidNotificationReady(false);
      setAwaitingNotificationAccess(false);
      notificationDecisionMade.current = false;
      setPendingOpen(null);
    }
    previouslyOnboarded.current = state.onboarded;
    // These routes own their own handoff. Returning normally to the root must
    // re-read that progress, even when this gate stayed mounted underneath.
    if (!state.onboarded && Platform.OS === 'ios' &&
      (pathname === '/ios-setup' || pathname === '/ios-paging-beta' || pathname === '/import-sms')) {
      resumeHandled.current = false;
      setResumeReady(true);
      return;
    }
    if (resumeHandled.current) return;
    if (state.onboardingProfile) {
      setFocus(state.onboardingProfile.focus);
      setTracking(state.onboardingProfile.tracking);
      setIntention(state.onboardingProfile.intention ?? null);
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
        const pendingAutomaticReveal = Platform.OS === 'android' &&
          state.onboardingProfile?.stage === 'complete' &&
          state.historyImport !== null &&
          state.captureOptOut === false;
        if (pendingAutomaticReveal) {
          resumeHandled.current = true;
          setCompletionOutcome('automatic');
          setStep('complete');
          setResumeReady(true);
          setResumeFailed(false);
          return;
        }
        const destination = onboardingResumeDestination({
          platform: Platform.OS,
          pendingIosSetup: saved?.returnToOnboarding === true,
          hasSavedPlan: state.onboardingPlan !== null,
          completedCallback: params.onboarding === 'complete',
          savedStage: state.onboardingProfile?.stage ?? null,
        });
        resumeHandled.current = true;
        if (destination === 'ios-setup') router.replace('/ios-setup?fromOnboarding=1');
        else setStep(destination === 'privacy' ? 'preview' : destination);
        setResumeReady(true);
        setResumeFailed(false);
      } catch {
        if (!cancelled) setResumeFailed(true);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [state.captureOptOut, state.historyImport, state.hydrated, state.onboarded, state.onboardingPlan,
    state.onboardingProfile, hydrationFailed, pathname, params.onboarding, router, resumeAttempt]);

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
    pathname === '/ios-paging-beta' ||
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
    if (setupBusyRef.current || stepTransitionTimer.current !== null) return;
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

  const chooseIntention = (id: OnboardingIntention) => {
    setIntention(id);
    saveJourney('intention', focus, tracking, id);
  };

  const showValuePreview = () => {
    if (!focus || !tracking || !intention || !beginStepTransition()) return;
    saveJourney('preview');
    setStep('preview');
    trackGrowthEvent('onboarding_value_previewed', {
      focus,
      tracking,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
  };

  const showCapture = () => {
    if (!beginStepTransition()) return;
    trackGrowthEvent('onboarding_privacy_seen', {
      focus,
      tracking,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
    saveJourney('capture');
    setStep('capture');
  };

  const startScan = async () => {
    setSmsDenied(false);
    trackGrowthEvent('capture_setup_started', { focus, tracking, source: 'sms' });
    let granted = false;
    try {
      granted = await requestSmsPermission();
    } catch {
      trackGrowthEvent('capture_setup_failed', { focus, tracking, source: 'sms', outcome: 'failed' });
      setSmsDenied(true);
      return;
    }
    if (!granted) {
      trackGrowthEvent('capture_permission_denied', { focus, tracking, source: 'sms', outcome: 'denied' });
      setSmsDenied(true);
      return;
    }
    trackGrowthEvent('capture_permission_granted', { focus, tracking, source: 'sms', outcome: 'automatic' });
    try {
      await setAndroidCaptureSources({
        sms: true,
        notifications: androidNotificationReady || state.androidCaptureSources?.notifications === true,
      });
      await setCaptureOptOut(false);
      await beginHistoryImport();
      await ensureDurable();
      setAndroidSmsReady(true);
    } catch {
      trackGrowthEvent('capture_setup_failed', { focus, tracking, source: 'sms', outcome: 'failed' });
      setSmsDenied(true);
    }
  };

  const enableAndroidNotificationAdmission = React.useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !NotificationReader?.setCaptureEnabled) return false;
    const expiresAt = bankNotificationAdmissionExpiresAt(state);
    if (expiresAt <= Date.now()) return false;
    try {
      return NotificationReader.setSourceConfiguration
        ? await NotificationReader.setSourceConfiguration(true, expiresAt)
        : await NotificationReader.setCaptureEnabled(true, expiresAt);
    } catch {
      return false;
    }
  }, [state.pro, state.founderPro, state.trialStartTs]);

  const connectAndroidNotifications = async () => {
    if (Platform.OS !== 'android') return;
    trackGrowthEvent('capture_setup_started', { focus, tracking, source: 'bank-notifications' });
    await setAndroidCaptureSources({
      sms: androidSmsReady || state.androidCaptureSources?.sms === true,
      notifications: true,
    });
    await setCaptureOptOut(false);
    const admitted = await enableAndroidNotificationAdmission();
    if (!admitted) {
      trackGrowthEvent('capture_setup_failed', { focus, tracking, source: 'bank-notifications' });
      return;
    }
    if (hasBankNotificationSystemAccess()) {
      setAndroidNotificationReady(true);
      setAwaitingNotificationAccess(false);
      return;
    }
    setAwaitingNotificationAccess(true);
    const opened = await openBankNotificationAccessSettings();
    if (!opened) setAwaitingNotificationAccess(false);
  };

  const finishAndroidCapture = async () => {
    if (Platform.OS !== 'android' || (!androidSmsReady && !androidNotificationReady)) return;
    try {
      await setAndroidCaptureSources({
        sms: androidSmsReady,
        notifications: androidNotificationReady,
      });
      await setCaptureOptOut(false);
      if (androidNotificationReady) await enableAndroidNotificationAdmission();
      saveJourney('complete');
      await ensureDurable();
      setSmsDenied(false);
      setCompletionOutcome('automatic');
      setStep('complete');
    } catch {
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

  useEffect(() => {
    if (Platform.OS !== 'android' || activeStep !== 'capture') return;
    let cancelled = false;
    const refresh = async () => {
      const sms = await hasSmsPermission().catch(() => false);
      if (!cancelled && state.androidCaptureSources?.sms === true) {
        setAndroidSmsReady(sms);
      }
      if (state.androidCaptureSources?.notifications !== true) return;
      if (!hasBankNotificationSystemAccess()) return;
      if (!awaitingNotificationAccess && androidNotificationReady) return;
      const admitted = await enableAndroidNotificationAdmission();
      if (!cancelled && admitted) {
        setAndroidNotificationReady(true);
        setAwaitingNotificationAccess(false);
      }
    };
    void refresh();
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [activeStep, awaitingNotificationAccess, androidNotificationReady, enableAndroidNotificationAdmission,
    state.androidCaptureSources?.notifications, state.androidCaptureSources?.sms]);

  const continueManually = async () => {
    setSmsDenied(false);
    setResult(null);
    try {
      // This choice says "no SMS access" even when Android retained a grant
      // from an older install or test run. Persist the capture opt-out before
      // showing success so a mounted foreground importer cannot race it.
      if (Platform.OS === 'android') {
        await setAndroidCaptureSources({ sms: false, notifications: false });
      }
      await setCaptureOptOut(true);
      if (Platform.OS === 'android') {
        try {
          if (NotificationReader?.setSourceConfiguration) {
            await NotificationReader.setSourceConfiguration(false, 0);
          } else {
            await NotificationReader?.setCaptureEnabled?.(false, 0);
          }
        } catch { /* durable opt-out is authoritative */ }
        setAndroidSmsReady(false);
        setAndroidNotificationReady(false);
        setAwaitingNotificationAccess(false);
      }
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
    if (!beginStepTransition()) return;
    if (activeStep === 'complete') {
      setStep('capture');
      saveJourney('capture');
      if (params.onboarding) router.setParams({ onboarding: undefined });
    } else if (activeStep === 'capture') {
      setStep('preview');
      saveJourney('preview');
    } else if (activeStep === 'preview') {
      setStep('intention');
      saveJourney('intention');
    } else if (activeStep === 'intention') {
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
    // Ask only after the user has seen Wafra's value/capture result and has
    // chosen to enter the app. This keeps Apple's native permission sheet out
    // of cold launch and out of the Shortcut setup itself, while still making
    // the notification choice part of a fresh iPhone setup.
    if (Platform.OS === 'ios' && !notificationDecisionMade.current) {
      requestedFirstEntry.current = addFirstEntry;
      requestedDestination.current = destination;
      setPendingOpen({ addFirstEntry, destination, outcomeOverride });
      return;
    }
    setFinishing(true);
    requestedFirstEntry.current = addFirstEntry;
    requestedDestination.current = destination;
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

  const finishNotificationChoice = async (enable: boolean) => {
    const pending = pendingOpen;
    if (!pending) return;
    let granted = false;
    if (enable) {
      granted = await requestVisibleNotificationPermission().catch(() => false);
    }
    setDailySummary(granted);
    if (granted) {
      // Schedule tonight immediately; later ledger refreshes keep it current.
      await syncDailySummary({ ...state, dailySummary: true }).catch(() => {});
    } else {
      await cancelDailySummary().catch(() => {});
    }
    notificationDecisionMade.current = true;
    setPendingOpen(null);
    await openWafra(pending.addFirstEntry, pending.destination, pending.outcomeOverride);
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
        <WafraTile size={56} />
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

  // The same wrapper whether the overlay is up or not. Returning bare
  // `children` here and `<View><View hidden>{children}</View>…</View>` below
  // changes the element type at the child position, which is how React
  // decides identity: the navigator was unmounted and remounted the moment
  // onboarding finished, throwing away the route it had just been sent to and
  // rebuilding every tab while the finish animation ran. See the comment
  // above `showRecovery` — this is the swap that comment says must not happen.
  const gatedChildren = (
    <View
      style={showOverlay ? styles.hidden : styles.container}
      pointerEvents={showOverlay ? 'none' : 'auto'}
      accessibilityElementsHidden={showOverlay}
      importantForAccessibility={showOverlay ? 'no-hide-descendants' : 'auto'}>
      {children}
    </View>
  );
  if (!showOverlay) return <View style={styles.container}>{gatedChildren}</View>;

  const entering = reducedMotion ? undefined : FadeInDown.duration(320);
  const automaticCompletion =
    params.onboarding === 'complete' || completionOutcome === 'automatic';
  const failedCompletion =
    activeStep === 'complete' && !automaticCompletion && completionOutcome === 'failed';
  const insight = onboardingInsightKeys(focus);
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
      {gatedChildren}
      <StatusBar style="light" />
      <View style={[StyleSheet.absoluteFillObject, styles.root]}>
        <OnboardingAtmosphere />
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {activeStep === 'welcome' ? (
            <Animated.ScrollView
              entering={reducedMotion || Platform.OS === 'android' ? undefined : FadeIn.duration(180)}
              showsVerticalScrollIndicator={false}
              testID="onboarding-welcome"
              contentContainerStyle={styles.welcomeBody}>
              <View style={styles.welcomeTop}>
                <View style={styles.brandLine}>
                  <WafraTile size={42} />
                  <ThemedText style={styles.brandName}>{t('appName')}</ThemedText>
                </View>
                <View
                  accessible
                  accessibilityRole="header"
                  accessibilityLabel={t('onboardHeadline')}
                  style={styles.headlineBlock}>
                  {t('onboardHeadline').split('\n').map((line, index) => (
                    <ThemedText
                      key={`${index}-${line}`}
                      accessible={false}
                      style={[styles.headline, index === 1 && styles.headlineAccent]}>
                      {line}
                    </ThemedText>
                  ))}
                </View>
                <ThemedText style={styles.sub}>
                  {t('onboardWelcomeBody')}
                </ThemedText>
              </View>
              <WelcomeMoneyScene marketId={state.marketId} reducedMotion={reducedMotion} />
              <View style={styles.welcomeActions}>
                <Button wrapLabel
                  label={t('onboardChooseStart')}
                  onPress={() => {
                    if (!beginStepTransition()) return;
                    saveJourney('focus');
                    setStep('focus');
                  }}
                  disabled={transitioning}
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
              <BackHeader step={activeStep} onBack={goBack}
                disabled={setupBusy || finishing || transitioning}
                progressSteps={JOURNEY_STEPS.includes(activeStep) ? JOURNEY_STEPS : null} />
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
                      <FocusChooser value={focus} onChange={chooseFocus} reducedMotion={reducedMotion} />
                      <View style={styles.questionActions}>
                        <Button wrapLabel
                          label={t('continueWord')}
                          disabled={!focus || transitioning}
                          onPress={() => {
                            if (!focus || !beginStepTransition()) return;
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
                      <TrackingChooser value={tracking} onChange={chooseTracking} marketId={state.marketId} reducedMotion={reducedMotion} />
                      <View style={styles.questionActions}>
                        <Button wrapLabel
                          label={t('continueWord')}
                          disabled={!tracking || transitioning}
                          onPress={() => {
                            if (!tracking || !beginStepTransition()) return;
                            saveJourney('intention');
                            setStep('intention');
                          }}
                          labelColor={night.onPrimary}
                          style={styles.primaryButton}
                        />
                      </View>
                    </>
                  )}

                  {activeStep === 'intention' && (
                    <>
                      <View style={styles.questionTop}>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t('onboardIntentionTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t('onboardIntentionBody')}</ThemedText>
                      </View>
                      <IntentionChooser value={intention} onChange={chooseIntention} reducedMotion={reducedMotion} />
                      <View style={styles.questionActions}>
                        <Button wrapLabel
                          label={t('continueWord')}
                          disabled={!intention || transitioning}
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
                          {t('onboardPersonalizedTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t('onboardPersonalizedBody')}</ThemedText>
                      </View>
                      <PersonalizedProductPreview focus={focus} tracking={tracking} intention={intention} marketId={state.marketId} reducedMotion={reducedMotion} />
                      <View style={styles.questionActions}>
                        <Button wrapLabel
                          label={t(Platform.OS === 'web' ? 'onboardChooseStart' : 'onboardConnectMyMoney')}
                          onPress={showCapture}
                          disabled={transitioning}
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
                      {Platform.OS !== 'web' && <CaptureMarketScene marketId={state.marketId} />}
                      {Platform.OS !== 'web' && <View style={styles.contextTrustCard} testID="onboarding-context-trust">
                        {([
                          ['lock', 'onboardPrivacyLocalTitle', Platform.OS === 'ios' ? 'onboardCapturePrivacyIos' : 'onboardCapturePrivacyAndroid'],
                          ['bank', 'onboardPrivacyNoLoginTitle', 'onboardPrivacyNoLoginBody'],
                          ['repeat', 'onboardPrivacyChoiceTitle', 'onboardPrivacyChoiceBody'],
                        ] as const).map(([icon, titleKey, bodyKey]) => (
                          <View key={titleKey} style={styles.contextTrustRow}>
                            <View style={styles.contextTrustIcon}>
                              <Icon name={icon} size={16} color={night.primary} />
                            </View>
                            <View style={styles.valueStepCopy}>
                              <ThemedText style={styles.contextTrustTitle}>{t(titleKey)}</ThemedText>
                              <ThemedText style={styles.contextTrustBody}>{t(bodyKey)}</ThemedText>
                            </View>
                          </View>
                        ))}
                      </View>}
                      {Platform.OS === 'android' ? (
                        <View style={styles.androidSources} testID="onboarding-start-options">
                          <Pressable accessibilityRole="button"
                            accessibilityState={{ selected: androidSmsReady, disabled: setupBusy || transitioning }}
                            disabled={setupBusy || transitioning}
                            onPress={() => void runSetupAction(startScan)}
                            style={({ pressed }) => [styles.captureSource, androidSmsReady && styles.captureSourceReady, { opacity: pressed ? 0.76 : 1 }]}>
                            <View style={[styles.captureSourceIcon, androidSmsReady && styles.captureSourceIconReady]}>
                              <Icon name="mail" size={21} color={androidSmsReady ? night.onPrimary : night.primary} />
                            </View>
                            <View style={styles.grow}>
                              <ThemedText style={styles.captureSourceTitle}>{t('onboardAndroidSmsSourceTitle')}</ThemedText>
                              <ThemedText style={styles.captureSourceBody}>{t('onboardAndroidSmsSourceBody')}</ThemedText>
                            </View>
                            {androidSmsReady
                              ? <Icon name="check" size={18} color={night.primary} />
                              : <Icon name="chevron-right" size={18} color={night.textTertiary} />}
                          </Pressable>
                          {smsDenied && !androidSmsReady && <ThemedText accessibilityLiveRegion="polite"
                            style={[styles.inlineNote, { color: night.warning }]}>{t('onboardSmsDeniedInline')}</ThemedText>}

                          <Pressable accessibilityRole="button"
                            accessibilityState={{ selected: androidNotificationReady, disabled: setupBusy || transitioning }}
                            disabled={setupBusy || transitioning}
                            onPress={() => void runSetupAction(connectAndroidNotifications)}
                            style={({ pressed }) => [styles.captureSource, androidNotificationReady && styles.captureSourceReady, { opacity: pressed ? 0.76 : 1 }]}>
                            <View style={[styles.captureSourceIcon, androidNotificationReady && styles.captureSourceIconReady]}>
                              <Icon name="phone" size={21} color={androidNotificationReady ? night.onPrimary : night.primary} />
                            </View>
                            <View style={styles.grow}>
                              <ThemedText style={styles.captureSourceTitle}>{t('onboardAndroidPushSourceTitle')}</ThemedText>
                              <ThemedText style={styles.captureSourceBody}>{t(awaitingNotificationAccess ? 'onboardAndroidPushAwaiting' : 'onboardAndroidPushSourceBody')}</ThemedText>
                            </View>
                            {androidNotificationReady
                              ? <Icon name="check" size={18} color={night.primary} />
                              : <Icon name="chevron-right" size={18} color={night.textTertiary} />}
                          </Pressable>

                          {(androidSmsReady || androidNotificationReady) && <Button wrapLabel
                            label={t(androidSmsReady && androidNotificationReady ? 'onboardCaptureContinueBoth' : 'onboardCaptureContinueOne')}
                            onPress={() => void runSetupAction(finishAndroidCapture)}
                            disabled={setupBusy || transitioning}
                            labelColor={night.onPrimary}
                            style={styles.primaryButton} />}
                          <Pressable accessibilityRole="button"
                            disabled={setupBusy || transitioning}
                            accessibilityState={{ disabled: setupBusy || transitioning }}
                            onPress={() => void runSetupAction(continueManually)}
                            style={({ pressed }) => [styles.skipCaptureButton, { opacity: pressed ? 0.6 : 1 }]}>
                            <ThemedText style={styles.skipCaptureText}>{t('onboardManualChoice')}</ThemedText>
                          </Pressable>
                        </View>
                      ) : Platform.OS === 'ios' ? (
                        <View style={styles.captureActions} testID="onboarding-start-options">
                          <Button
                            wrapLabel
                            label={t('onboardAutomaticChoiceIos')}
                            onPress={() => void runSetupAction(beginCapture)}
                            disabled={setupBusy || transitioning}
                            labelColor={night.onPrimary}
                            style={styles.primaryButton}
                          />
                          <Pressable
                            accessibilityRole="button"
                            disabled={setupBusy || transitioning}
                            accessibilityState={{ disabled: setupBusy || transitioning }}
                            onPress={() => void runSetupAction(continueManually)}
                            style={({ pressed }) => [styles.skipCaptureButton, { opacity: pressed ? 0.6 : 1 }]}>
                            <ThemedText style={styles.skipCaptureText}>{t('onboardManualChoiceIos')}</ThemedText>
                          </Pressable>
                        </View>
                      ) : (
                        <View style={styles.startOptions} testID="onboarding-start-options">
                          <StartOption automatic={false} disabled={setupBusy || transitioning} onPress={() => void runSetupAction(continueManually)} />
                        </View>
                      )}
                      {setupBusy && <ThemedText style={styles.inlineNote} accessibilityLiveRegion="polite">
                        {t('onboardSetupWorking')}
                      </ThemedText>}
                      {Platform.OS === 'ios' && (
                        <Button
                          wrapLabel
                          variant="outline"
                          label={t('onboardCaptureLearnMoreAction')}
                          onPress={() => setLearnMoreVisible(true)}
                          disabled={setupBusy}
                          labelColor={night.text}
                          style={[styles.learnMoreButton, styles.ghost]}
                        />
                      )}
                    </>
                  )}

                  {activeStep === 'complete' && (
                    <>
                      <View style={styles.completeHero}>
                        <View
                          style={[
                            styles.completeMark,
                            (failedCompletion || smsDenied) && styles.completeMarkWarning,
                          ]}>
                          {failedCompletion || smsDenied
                            ? <Icon name="alert" size={28} color={night.onPrimary} strokeWidth={2.1} />
                            : <WafraMark size={42} color={night.primary} />}
                        </View>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {t(
                            finishSaveFailed ? 'onboardFinishSaveFailedTitle'
                              : automaticCompletion
                                ? 'onboardCompleteAutomaticTitle'
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
                                ? (Platform.OS === 'android'
                                  ? 'onboardCompleteBodyAutomatic'
                                  : 'onboardCompleteBodyAutomaticIos')
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
                        {pendingOpen ? <View style={styles.notificationOffer}>
                          <View style={styles.notificationOfferHead}>
                            <View style={styles.firstInsightIcon}>
                              <Icon name="phone" size={20} color={night.primary} />
                            </View>
                            <View style={styles.valueStepCopy}>
                              <ThemedText style={styles.valueStepTitle}>{t('onboardNotificationsTitle')}</ThemedText>
                              <ThemedText style={styles.choiceDetail}>{t('onboardNotificationsBody')}</ThemedText>
                            </View>
                          </View>
                          <Button wrapLabel label={t('onboardNotificationsEnable')}
                            onPress={() => void runSetupAction(() => finishNotificationChoice(true))}
                            disabled={setupBusy} labelColor={night.onPrimary} style={styles.primaryButton} />
                          <Button wrapLabel variant="ghost" label={t('onboardNotificationsNotNow')}
                            onPress={() => void runSetupAction(() => finishNotificationChoice(false))}
                            disabled={setupBusy} labelColor={night.text} />
                        </View> : finishSaveFailed ? <Button wrapLabel label={t('storageRecoveryRetry')}
                          onPress={() => void runSetupAction(() => openWafra(requestedFirstEntry.current, requestedDestination.current))}
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
                            onPress={goBack} disabled={setupBusy || transitioning}
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
  grow: { flex: 1, minWidth: 0 },
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
    paddingBottom: 18,
    alignItems: 'stretch',
    gap: 18,
  },
  welcomeTop: { paddingTop: 12, gap: 12 },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  brandName: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 17, letterSpacing: -0.3 },
  eyebrow: {
    paddingTop: 12,
    color: night.primary,
    fontFamily: Fonts.sansSemi,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.1,
  },
  headline: {
    fontFamily: Fonts.sansSemi,
    fontSize: 38,
    lineHeight: 42,
    letterSpacing: -1.3,
    color: night.text,
    maxWidth: 430,
  },
  headlineBlock: { gap: 0 },
  headlineAccent: { color: night.primary },
  sub: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 22, color: night.textSecondary },
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
  questionBody: { flex: 1, paddingTop: 18 },
  questionTop: { gap: 6, marginBottom: 18 },
  questionTitle: {
    fontFamily: Fonts.sansSemi,
    fontSize: 27,
    lineHeight: 34,
    letterSpacing: -0.8,
    color: night.text,
  },
  questionBodyCopy: { color: night.textSecondary, fontSize: 14, lineHeight: 22 },
  choiceList: { gap: Spacing.two },
  choice: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: Radius.control,
    paddingHorizontal: 14,
    paddingVertical: 11,
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
  questionActions: { marginTop: 'auto', paddingTop: Spacing.four },
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
  primaryButton: { marginTop: Spacing.three, backgroundColor: night.primary },
  captureHero: { gap: Spacing.two, alignItems: 'flex-start' },
  captureIcon: {
    width: 58,
    height: 58,
    borderRadius: 20,
    backgroundColor: night.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureActions: { marginTop: 'auto', paddingTop: Spacing.four, gap: Spacing.two },
  skipCaptureButton: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  skipCaptureText: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 14 },
  androidSources: { paddingTop: Spacing.three, gap: Spacing.two },
  captureSource: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: night.cardBorderStrong,
    backgroundColor: 'rgba(17,17,14,0.54)',
  },
  captureSourceReady: { borderColor: night.primary, backgroundColor: night.primarySoft },
  captureSourceIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: night.backgroundSelected },
  captureSourceIconReady: { backgroundColor: night.primary },
  captureSourceTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 14, lineHeight: 19 },
  captureSourceBody: { color: night.textTertiary, fontSize: 12, lineHeight: 17 },
  startOptions: { paddingTop: Spacing.three, gap: Spacing.two },
  startOption: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
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
  completeHero: { gap: Spacing.three, alignItems: 'flex-start' },
  completeMark: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 1,
    borderColor: night.primaryBorder,
    backgroundColor: night.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeMarkWarning: { backgroundColor: night.warning, borderColor: night.warning },
  resultCard: {
    width: '100%',
    minHeight: 96,
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: Spacing.two,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: night.cardBorderStrong,
  },
  resultCell: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  resultNumber: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 30, fontVariant: ['tabular-nums'] },
  resultLabel: { color: night.textSecondary, fontFamily: Fonts.sans, fontSize: 11, textAlign: 'center' },
  resultDivider: { width: StyleSheet.hairlineWidth, backgroundColor: night.primaryBorder },
  valuePreview: {
    borderRadius: Radius.sheet,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: night.cardBorder,
    backgroundColor: night.backgroundElement,
    padding: 14,
  },
  personalizedBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: Spacing.two,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: night.primarySoft,
  },
  personalizedBadgeText: {
    color: night.primary,
    fontFamily: Fonts.sansSemi,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.2,
  },
  valueStep: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
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
  contextTrustCard: {
    marginTop: Spacing.three,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: night.cardBorderStrong,
  },
  contextTrustRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: night.cardBorder,
  },
  contextTrustIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextTrustTitle: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 13, lineHeight: 18 },
  contextTrustBody: { color: night.textTertiary, fontSize: 12, lineHeight: 17 },
  firstInsight: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: night.cardBorderStrong,
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
  notificationOffer: {
    width: '100%',
    gap: Spacing.two,
    padding: 14,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: night.primaryBorder,
    backgroundColor: night.backgroundElement,
  },
  notificationOfferHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  learnMoreButton: { marginTop: Spacing.two },
  learnMoreContent: { gap: Spacing.three },
  learnMoreText: { color: night.textSecondary, fontSize: 14, lineHeight: 21 },
});

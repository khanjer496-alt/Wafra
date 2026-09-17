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
  TextInput,
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
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
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
  MAX_PREFERRED_NAME_LENGTH,
  normalizePreferredName,
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

function BackHeader({ step, onBack, onClose, progressSteps, disabled }: {
  step: Step;
  onBack: () => void;
  onClose?: () => void;
  progressSteps: readonly Step[] | null;
  disabled: boolean;
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
        <View style={styles.progressActions}>
          {showProgress && <ThemedText style={styles.stepLabel}>
            {tf('onboardStepOf', { step: visibleIndex + 1, total: steps.length })}
          </ThemedText>}
          {onClose && <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('close')}
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [styles.previewClose, { opacity: pressed ? 0.6 : 1 }]}>
            <ThemedText style={styles.previewCloseText}>{t('close')}</ThemedText>
          </Pressable>}
        </View>
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
  const language = useLanguage();
  const largeText = useLargeTextLayout();
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
    setUserName,
    setCaptureOptOut,
    setAndroidCaptureSources,
    setDailySummary,
  } = useStore();
  const [step, setStep] = useState<Step>('welcome');
  const [collectingName, setCollectingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaveFailed, setNameSaveFailed] = useState(false);
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
  const previewMode = state.onboarded && params.onboarding === 'preview';
  const previewStarted = useRef(false);

  useEffect(() => {
    if (!previewMode) {
      previewStarted.current = false;
      return;
    }
    if (previewStarted.current) return;
    previewStarted.current = true;
    if (stepTransitionTimer.current !== null) clearTimeout(stepTransitionTimer.current);
    stepTransitionTimer.current = null;
    setupBusyRef.current = false;
    setSetupBusy(false);
    setTransitioning(false);
    setFinishing(false);
    setFinishSaveFailed(false);
    setLearnMoreVisible(false);
    setPendingOpen(null);
    setResult(null);
    setSmsDenied(false);
    setAndroidSmsReady(false);
    setAndroidNotificationReady(false);
    setAwaitingNotificationAccess(false);
    setCompletionOutcome('manual');
    setCollectingName(false);
    setNameDraft('');
    setNameSaving(false);
    setNameSaveFailed(false);
    setFocus(null);
    setTracking(null);
    setIntention(null);
    setStep('welcome');
  }, [previewMode]);

  const closePreview = () => {
    if (!previewMode) return;
    setLearnMoreVisible(false);
    setPendingOpen(null);
    setResult(null);
    setSmsDenied(false);
    setAndroidSmsReady(false);
    setAndroidNotificationReady(false);
    setAwaitingNotificationAccess(false);
    setCompletionOutcome('manual');
    setCollectingName(false);
    setNameDraft('');
    setNameSaving(false);
    setNameSaveFailed(false);
    setFocus(null);
    setTracking(null);
    setIntention(null);
    setStep('welcome');
    router.setParams({ onboarding: undefined });
  };

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
    if (previewMode) return;
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
      setCollectingName(false);
      setNameDraft('');
      setNameSaving(false);
      setNameSaveFailed(false);
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
        else if (destination === 'remote-handoff') {
          // Superwall owns the value/personalization journey, but the optional
          // first name remains device-only. Resume directly in the existing
          // native name surface, then continue to capture without replaying the
          // questions Superwall already collected.
          setNameDraft(
            state.userName === 'there' ? '' : normalizePreferredName(state.userName) ?? '',
          );
          setNameSaveFailed(false);
          setCollectingName(true);
          setStep('welcome');
        } else setStep(destination === 'privacy' ? 'preview' : destination);
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

  const activeStep: Step = !previewMode && params.onboarding === 'complete' ? 'complete' : step;
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
    (!state.onboarded || finishing || previewMode) &&
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

  const trackOnboardingEvent = (...args: Parameters<typeof trackGrowthEvent>) => {
    if (!previewMode) trackGrowthEvent(...args);
  };

  const chooseFocus = (id: OnboardingFocus) => {
    setFocus(id);
    saveJourney('focus', id, tracking);
    trackOnboardingEvent('onboarding_focus_selected', {
      focus: id,
      tracking,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
  };

  const chooseTracking = (id: OnboardingTracking) => {
    setTracking(id);
    saveJourney('tracking', focus, id);
    trackOnboardingEvent('onboarding_tracking_selected', {
      focus,
      tracking: id,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
  };

  const chooseIntention = (id: OnboardingIntention) => {
    setIntention(id);
    saveJourney('intention', focus, tracking, id);
  };

  const draftPreferredName = normalizePreferredName(nameDraft);
  const savedPreferredName = state.userName === 'there'
    ? null
    : normalizePreferredName(state.userName);
  const preferredName = previewMode ? draftPreferredName : savedPreferredName;
  const selectedFocus = focus ?? state.onboardingProfile?.focus ?? null;
  const selectedTracking = tracking ?? state.onboardingProfile?.tracking ?? null;
  const selectedIntention = intention ?? state.onboardingProfile?.intention ?? null;

  const openNamePersonalization = () => {
    if (!beginStepTransition()) return;
    setNameDraft(previewMode ? '' : preferredName ?? '');
    setNameSaveFailed(false);
    setCollectingName(true);
  };

  const continueFromName = async (saveName: boolean) => {
    if (nameSaving || transitioning) return;
    const nextName = normalizePreferredName(nameDraft);
    if (saveName && !nextName) return;
    const resumedFocus = selectedFocus;
    const resumedTracking = selectedTracking;
    const resumedIntention = selectedIntention;
    if (previewMode) {
      setFocus(resumedFocus);
      setTracking(resumedTracking);
      setIntention(resumedIntention);
      saveJourney('focus', resumedFocus, resumedTracking, resumedIntention);
      if (!beginStepTransition()) return;
      setStep('focus');
      return;
    }
    setNameSaving(true);
    setNameSaveFailed(false);
    try {
      if (saveName && nextName) setUserName(nextName);
      // Going Back from a later screen to edit/skip the name must not erase
      // choices that are already durable in the profile.
      setFocus(resumedFocus);
      setTracking(resumedTracking);
      setIntention(resumedIntention);
      if (
        state.onboardingProfile?.stage === 'remote-handoff' &&
        resumedFocus &&
        resumedTracking &&
        resumedIntention
      ) {
        // The remote Flow already asked Focus → Tracking → Intention and showed
        // the personalized value preview. Name is the only local personalization
        // step between that Flow and OS-specific capture setup.
        saveJourney('capture', resumedFocus, resumedTracking, resumedIntention);
        await ensureDurable();
        if (!beginStepTransition()) return;
        setCollectingName(false);
        setStep('capture');
        return;
      }
      saveJourney('focus', resumedFocus, resumedTracking, resumedIntention);
      // Persist the lightweight profile/name together. If the process dies on
      // the next screen, onboarding resumes at Focus with the same greeting.
      await ensureDurable();
      if (!beginStepTransition()) return;
      setStep('focus');
    } catch {
      setNameSaveFailed(true);
    } finally {
      setNameSaving(false);
    }
  };

  const showValuePreview = () => {
    if (!selectedFocus || !selectedTracking || !selectedIntention || !beginStepTransition()) return;
    setFocus(selectedFocus);
    setTracking(selectedTracking);
    setIntention(selectedIntention);
    saveJourney('preview', selectedFocus, selectedTracking, selectedIntention);
    setStep('preview');
    trackOnboardingEvent('onboarding_value_previewed', {
      focus,
      tracking,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
  };

  const showCapture = () => {
    if (!beginStepTransition()) return;
    trackOnboardingEvent('onboarding_privacy_seen', {
      focus,
      tracking,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
    saveJourney('capture');
    setStep('capture');
  };

  const startScan = async () => {
    setSmsDenied(false);
    if (previewMode) {
      setAndroidSmsReady(true);
      return;
    }
    trackOnboardingEvent('capture_setup_started', { focus, tracking, source: 'sms' });
    let granted = false;
    try {
      granted = await requestSmsPermission();
    } catch {
      trackOnboardingEvent('capture_setup_failed', { focus, tracking, source: 'sms', outcome: 'failed' });
      setSmsDenied(true);
      return;
    }
    if (!granted) {
      trackOnboardingEvent('capture_permission_denied', { focus, tracking, source: 'sms', outcome: 'denied' });
      setSmsDenied(true);
      return;
    }
    trackOnboardingEvent('capture_permission_granted', { focus, tracking, source: 'sms', outcome: 'automatic' });
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
      trackOnboardingEvent('capture_setup_failed', { focus, tracking, source: 'sms', outcome: 'failed' });
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
    if (previewMode) {
      setAndroidNotificationReady(true);
      setAwaitingNotificationAccess(false);
      return;
    }
    trackOnboardingEvent('capture_setup_started', { focus, tracking, source: 'bank-notifications' });
    await setAndroidCaptureSources({
      sms: androidSmsReady || state.androidCaptureSources?.sms === true,
      notifications: true,
    });
    await setCaptureOptOut(false);
    const admitted = await enableAndroidNotificationAdmission();
    if (!admitted) {
      trackOnboardingEvent('capture_setup_failed', { focus, tracking, source: 'bank-notifications' });
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
    if (previewMode) {
      setSmsDenied(false);
      setCompletionOutcome('automatic');
      setStep('complete');
      return;
    }
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
      trackOnboardingEvent('capture_setup_failed', { focus, tracking, outcome: 'failed' });
      setCompletionOutcome('failed');
      saveJourney('complete');
      setStep('complete');
    }
  };

  const beginCapture = async () => {
    if (previewMode) {
      setCompletionOutcome('automatic');
      setStep('complete');
      return;
    }
    if (Platform.OS === 'ios') {
      trackOnboardingEvent('capture_setup_started', { focus, tracking });
      try {
        await setCaptureOptOut(false);
      } catch {
        trackOnboardingEvent('capture_setup_failed', { focus, tracking, outcome: 'failed' });
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
    trackOnboardingEvent('capture_setup_failed', { focus, tracking, outcome: 'failed' });
    setCompletionOutcome('failed');
    saveJourney('complete');
    setStep('complete');
  };

  useEffect(() => {
    if (previewMode || Platform.OS !== 'android' || activeStep !== 'capture') return;
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
  }, [previewMode, activeStep, awaitingNotificationAccess, androidNotificationReady, enableAndroidNotificationAdmission,
    state.androidCaptureSources?.notifications, state.androidCaptureSources?.sms]);

  const continueManually = async () => {
    setSmsDenied(false);
    setResult(null);
    if (previewMode) {
      setCompletionOutcome('manual');
      setStep('complete');
      return;
    }
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
      trackOnboardingEvent('manual_tracking_selected', { focus, tracking, outcome: 'manual' });
      setCompletionOutcome('manual');
      saveJourney('complete');
      setStep('complete');
    } catch {
      trackOnboardingEvent('capture_setup_failed', { focus, tracking, outcome: 'failed' });
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
      if (params.onboarding && !previewMode) router.setParams({ onboarding: undefined });
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
      setNameDraft(preferredName ?? '');
      setNameSaveFailed(false);
      setCollectingName(true);
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
    if (previewMode) {
      closePreview();
      return;
    }
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
      trackOnboardingEvent('onboarding_completed', {
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
    (!previewMode && params.onboarding === 'complete') || completionOutcome === 'automatic';
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
              scrollEnabled={largeText}
              bounces={largeText}
              showsVerticalScrollIndicator={false}
              testID="onboarding-welcome"
              contentContainerStyle={styles.welcomeBody}>
              {!collectingName ? <>
                <View style={styles.welcomeTop}>
                  <View style={styles.brandLine}>
                    <WafraTile size={42} />
                    <ThemedText style={styles.brandName}>{t('appName')}</ThemedText>
                    {previewMode && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('close')}
                        onPress={closePreview}
                        style={({ pressed }) => [styles.previewClose, { opacity: pressed ? 0.6 : 1 }]}>
                        <ThemedText style={styles.previewCloseText}>{t('close')}</ThemedText>
                      </Pressable>
                    )}
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
                    onPress={openNamePersonalization}
                    disabled={transitioning}
                    labelColor={night.onPrimary}
                    style={{ backgroundColor: night.primary }}
                  />
                  <View style={styles.setupTime}>
                    <Icon name="lock" size={14} color={night.textTertiary} />
                    <ThemedText style={styles.setupTimeText}>{t('onboardSetupTime')}</ThemedText>
                  </View>
                </View>
              </> : <>
                <View style={styles.nameTop}>
                  <View style={styles.nameNav}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('onboardBack')}
                      disabled={nameSaving || transitioning}
                      onPress={() => {
                        tapped();
                        setNameSaveFailed(false);
                        setCollectingName(false);
                      }}
                      style={({ pressed }) => [styles.nameBack, { opacity: pressed ? 0.6 : 1 }]}>
                      <Icon name="chevron-left" size={18} color={night.textSecondary} />
                      <ThemedText style={styles.backLabel}>{t('onboardBack')}</ThemedText>
                    </Pressable>
                    {previewMode && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('close')}
                        onPress={closePreview}
                        style={({ pressed }) => [styles.previewClose, { opacity: pressed ? 0.6 : 1 }]}>
                        <ThemedText style={styles.previewCloseText}>{t('close')}</ThemedText>
                      </Pressable>
                    )}
                  </View>
                  <ThemedText style={styles.nameTitle} accessibilityRole="header">
                    {t('onboardNameTitle')}
                  </ThemedText>
                  <ThemedText style={styles.sub}>{t('onboardNameBody')}</ThemedText>
                </View>

                <View style={styles.nameInputBlock}>
                  <TextInput
                    testID="onboarding-name-input"
                    accessibilityLabel={t('onboardNamePlaceholder')}
                    value={nameDraft}
                    onChangeText={(value) => {
                      setNameDraft(value);
                      setNameSaveFailed(false);
                    }}
                    placeholder={t('onboardNamePlaceholder')}
                    placeholderTextColor={night.textTertiary}
                    selectionColor={night.primary}
                    maxLength={MAX_PREFERRED_NAME_LENGTH}
                    autoCapitalize="words"
                    autoCorrect={false}
                    enterKeyHint="done"
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      if (draftPreferredName) void continueFromName(true);
                    }}
                    style={[styles.nameInput, { textAlign: language === 'ar' ? 'right' : 'left' }]}
                  />
                  <View style={styles.namePreviewSlot} testID="onboarding-name-preview" accessibilityLiveRegion="polite">
                    {draftPreferredName ? (
                      <ThemedText style={styles.namePreviewText}>
                        {tf('onboardNamePreview', { name: draftPreferredName })}
                      </ThemedText>
                    ) : null}
                  </View>
                  <View style={styles.namePrivacyLine}>
                    <Icon name="lock" size={13} color={night.primary} />
                    <ThemedText style={styles.namePrivacyText}>{t('onboardNamePrivacy')}</ThemedText>
                  </View>
                  {nameSaveFailed && <ThemedText accessibilityLiveRegion="polite"
                    style={[styles.inlineNote, { color: night.warning }]}>
                    {t('onboardFinishSaveFailedBody')}
                  </ThemedText>}
                </View>

                <View style={styles.welcomeActions}>
                  <Button wrapLabel
                    label={t('onboardNameContinue')}
                    onPress={() => void continueFromName(true)}
                    disabled={!draftPreferredName || nameSaving || transitioning}
                    labelColor={night.onPrimary}
                    style={{ backgroundColor: night.primary }}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('onboardNameSkip')}
                    disabled={nameSaving || transitioning}
                    onPress={() => void continueFromName(false)}
                    style={({ pressed }) => [styles.nameSkip, { opacity: pressed ? 0.6 : 1 }]}>
                    <ThemedText style={styles.nameSkipText}>{t('onboardNameSkip')}</ThemedText>
                  </Pressable>
                </View>
              </>}
            </Animated.ScrollView>
          ) : (
            <>
              <BackHeader step={activeStep} onBack={goBack}
                onClose={previewMode ? closePreview : undefined}
                disabled={setupBusy || finishing || transitioning}
                progressSteps={JOURNEY_STEPS.includes(activeStep) ? JOURNEY_STEPS : null} />
              <ScrollView key={activeStep}
                keyboardShouldPersistTaps="handled"
                scrollEnabled={largeText}
                bounces={largeText}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.scrollContent}>
                <Animated.View key={activeStep} entering={entering} style={styles.questionBody}>
                  {activeStep === 'focus' && (
                    <>
                      <View style={styles.questionTop}>
                        <ThemedText style={styles.questionTitle} accessibilityRole="header">
                          {preferredName
                            ? tf('onboardFocusTitleNamed', { name: preferredName })
                            : t('onboardFocusTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t('onboardFocusBody')}</ThemedText>
                      </View>
                      <FocusChooser value={selectedFocus} onChange={chooseFocus} reducedMotion={reducedMotion} />
                      <View style={styles.questionActions}>
                        <Button wrapLabel
                          label={t('continueWord')}
                          disabled={!selectedFocus || transitioning}
                          onPress={() => {
                            if (!selectedFocus || !beginStepTransition()) return;
                            setFocus(selectedFocus);
                            saveJourney('tracking', selectedFocus, selectedTracking, selectedIntention);
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
                      <TrackingChooser value={selectedTracking} onChange={chooseTracking} marketId={state.marketId} reducedMotion={reducedMotion} />
                      <View style={styles.questionActions}>
                        <Button wrapLabel
                          label={t('continueWord')}
                          disabled={!selectedTracking || transitioning}
                          onPress={() => {
                            if (!selectedTracking || !beginStepTransition()) return;
                            setTracking(selectedTracking);
                            saveJourney('intention', selectedFocus, selectedTracking, selectedIntention);
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
                      <IntentionChooser value={selectedIntention} onChange={chooseIntention} reducedMotion={reducedMotion} />
                      <View style={styles.questionActions}>
                        <Button wrapLabel
                          label={t('continueWord')}
                          disabled={!selectedIntention || transitioning}
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
                          {preferredName
                            ? tf('onboardPersonalizedTitleNamed', { name: preferredName })
                            : t('onboardPersonalizedTitle')}
                        </ThemedText>
                        <ThemedText style={styles.questionBodyCopy}>{t('onboardPersonalizedBody')}</ThemedText>
                      </View>
                      <PersonalizedProductPreview focus={selectedFocus} tracking={selectedTracking} intention={selectedIntention} marketId={state.marketId} reducedMotion={reducedMotion} />
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
                          <View key={titleKey} style={styles.contextTrustItem} accessible
                            accessibilityLabel={`${t(titleKey)}. ${t(bodyKey)}`}>
                            <View style={styles.contextTrustIcon}>
                              <Icon name={icon} size={16} color={night.primary} />
                            </View>
                            <ThemedText style={styles.contextTrustTitle}>{t(titleKey)}</ThemedText>
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
                                trackOnboardingEvent('post_import_pro_opened', {
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
    paddingBottom: 14,
    alignItems: 'stretch',
    gap: 12,
  },
  welcomeTop: { paddingTop: 8, gap: 8 },
  nameTop: { paddingTop: 4, gap: 10 },
  nameNav: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nameBack: { alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  brandName: { color: night.text, fontFamily: Fonts.sansSemi, fontSize: 17, letterSpacing: -0.3 },
  previewClose: { marginLeft: 'auto', minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },
  previewCloseText: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 13 },
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
  nameTitle: {
    marginTop: 4,
    maxWidth: 430,
    color: night.text,
    fontFamily: Fonts.sansSemi,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.8,
  },
  nameInputBlock: { marginTop: Spacing.four, gap: 8 },
  nameInput: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: night.cardBorderStrong,
    borderRadius: Radius.control,
    backgroundColor: night.backgroundElement,
    color: night.text,
    fontFamily: Fonts.sansMedium,
    fontSize: 18,
    lineHeight: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  namePreviewSlot: { minHeight: 20, justifyContent: 'center' },
  namePreviewText: { color: night.primary, fontFamily: Fonts.sansMedium, fontSize: 13, lineHeight: 18 },
  namePrivacyLine: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 6 },
  namePrivacyText: { flexShrink: 1, color: night.textTertiary, fontSize: 12, lineHeight: 18 },
  nameSkip: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  nameSkipText: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 14 },
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
  progressActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  back: { minHeight: 48, flexDirection: 'row', gap: 4, alignItems: 'center' },
  backLabel: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 12 },
  stepLabel: { color: night.textTertiary, fontFamily: Fonts.monoMedium, fontSize: 11 },
  progressTrack: { flexDirection: 'row', gap: 5 },
  progressSegment: { flex: 1, height: 3, borderRadius: 2 },
  scrollContent: { flexGrow: 1, paddingHorizontal: ScreenPadding, paddingBottom: 12 },
  questionBody: { flex: 1, paddingTop: 10 },
  questionTop: { gap: 5, marginBottom: 10 },
  questionTitle: {
    fontFamily: Fonts.sansSemi,
    fontSize: 25,
    lineHeight: 31,
    letterSpacing: -0.7,
    color: night.text,
  },
  questionBodyCopy: { color: night.textSecondary, fontSize: 13, lineHeight: 19 },
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
  questionActions: { marginTop: 'auto', paddingTop: 10 },
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
  primaryButton: { backgroundColor: night.primary },
  captureHero: { gap: 6, alignItems: 'flex-start' },
  captureIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: night.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureActions: { marginTop: 'auto', paddingTop: 10, gap: 8 },
  skipCaptureButton: { alignSelf: 'center', paddingVertical: Spacing.two, paddingHorizontal: Spacing.three },
  skipCaptureText: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 14 },
  androidSources: { paddingTop: 8, gap: 8 },
  captureSource: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: night.cardBorderStrong,
    backgroundColor: 'rgba(17,17,14,0.54)',
  },
  captureSourceReady: { borderColor: night.primary, backgroundColor: night.primarySoft },
  captureSourceIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: night.backgroundSelected },
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
  completeHero: { gap: 10, alignItems: 'flex-start' },
  completeMark: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: night.primaryBorder,
    backgroundColor: night.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeMarkWarning: { backgroundColor: night.warning, borderColor: night.warning },
  resultCard: {
    width: '100%',
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 4,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: night.cardBorderStrong,
  },
  resultCell: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.one },
  resultNumber: { color: night.text, fontFamily: Fonts.monoSemi, fontSize: 26, fontVariant: ['tabular-nums'] },
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
    marginTop: 8,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: night.cardBorderStrong,
  },
  contextTrustItem: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  contextTrustIcon: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextTrustTitle: { color: night.textSecondary, fontFamily: Fonts.sansMedium, fontSize: 11, lineHeight: 15, textAlign: 'center' },
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

import { useLanguage } from '@/hooks/use-language';
import { clearIosStatementHandoff, matchesIosStatementHandoff } from '@/lib/ios-statement-handoff';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { getLocales } from 'expo-localization';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState as RNAppState,
  Linking,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';

import { StorageRecovery } from '@/components/storage-recovery';
import { ThemedText } from '@/components/themed-text';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { EButton } from '@/components/ui/band/e-button';
import { CaptureChecklist } from '@/components/onboarding/capture-checklist';
import { EBody, EHeadline, EStepFrame, ETextAction, bandButtonColor } from '@/components/onboarding/e-frame';
import { ArrivedCard, ResultStrip, SourceRow, TrustLine } from '@/components/onboarding/e-first-payment';
import { GoalsStep } from '@/components/onboarding/e-goals';
import { HandoffLayer } from '@/components/onboarding/e-handoff';
import { LogoDraw, StepWipe, stepEntering, useEMotion } from '@/components/onboarding/e-motion';
import { NameStep } from '@/components/onboarding/e-name';
import { PatternStep } from '@/components/onboarding/e-pattern';
import { PaywallStep } from '@/components/onboarding/e-paywall';
import { RemindersStep } from '@/components/onboarding/e-reminders';
import { WatchStep } from '@/components/onboarding/e-watch';
import { WelcomeStep } from '@/components/onboarding/e-welcome';
import { ReadySummary } from '@/components/onboarding/ready-summary';
import { SmsPermissionExplainer } from '@/components/onboarding/sms-explainer';
import { suggestedLedgerCurrency } from '@/components/ledger-currency-sheet';
import { useBand } from '@/hooks/use-band';
import {
  hasBankNotificationSystemAccess,
  hasSmsPermission,
  isSmsScanningAvailable,
  openBankNotificationAccessSettings,
  requestSmsDeliveryPermission,
  requestSmsPermission,
} from '@/lib/auto-import';
import { categoryLabel } from '@/lib/categories';
import { committed } from '@/lib/haptics';
import {
  cancelDailySummary,
  requestVisibleNotificationPermission,
  syncDailySummary,
} from '@/lib/notifications';
import {
  GROWTH_PLACEMENTS,
  trackGrowthEvent,
} from '@/lib/growth-funnel';
import { loadHomeWidgetPreferences, saveHomeWidgetPreferences } from '@/lib/home-widgets';
import { t } from '@/lib/i18n';
import { dispatchIosMessageSetup, loadIosMessageSetupProgress } from '@/lib/ios-message-onboarding';
import { getIosCaptureNativeModule } from '@/lib/capture';
import { iosCaptureChecklist, type IosChecklistEvidence } from '@/lib/ios-capture-checklist';
import { resolveIosSetupReadiness } from '@/lib/ios-capture-setup';
import { iosShortcutSetupCopy } from '@/lib/ios-shortcut-setup-copy';
import { internalTransferIdsForState, isSpending, liveAccountIds } from '@/lib/ledger';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import { onboardingCopy } from '@/lib/onboarding-copy';
import {
  alertsAnswerForCaptureChoice,
  alertsAnswerForIosSetup,
  arrivedPayment,
  homeOrderForGoals,
  ONBOARDING_E_BANDS,
  onboardingEResumeStep,
  setWatchLimit,
  toggleGoal,
  toggleWatch,
  WATCH_CATEGORIES,
  watchBudgetChanges,
  watchDraftFromBudgets,
  watchedProgress,
  type OnboardingCaptureChoice,
  type OnboardingEStep,
  type WatchDraft,
} from '@/lib/onboarding-e';
import { onboardingECopy } from '@/lib/onboarding-e-copy';
import { onboardingReadySummary } from '@/lib/onboarding-ready';
import { buildPattern, patternInputFromState, type PatternInput } from '@/lib/pattern';
import { currentMonthPeriod, inPeriod } from '@/lib/period';
import { trialDaysLeft } from '@/lib/purchases';
import { readBackupPickerCopy } from '@/lib/share-text';
import { detectSubscriptions } from '@/lib/subscriptions';
import { disableRelayBackgroundSync } from '@/lib/background-relay';
import {
  normalizePreferredName,
  onboardingHistoryGap,
  onboardingLandingPath,
  onboardingNoAutomaticCapture,
  onboardingResumeDestination,
} from '@/lib/onboarding';
import { normalizeOnboardingCountry, ONBOARDING_REGION_ELSEWHERE } from '@/lib/onboarding-bank-examples';
import { bankNotificationAdmissionExpiresAt } from '@/lib/trusted-bank-notification-packages';
import { getRelayConfigStrict, isLegacyShortcutCaptureActive, unpairDevice } from '@/lib/relay';
import { openShortcutsApp } from '@/lib/shortcut-cleanup';
import { useStore } from '@/lib/store';
import {
  sanitizeGoalIds,
  type CategoryId,
  type GoalId,
  type OnboardingAlertDelivery,
  type OnboardingJourneyStage,
} from '@/lib/types';
import NotificationReader from '../../modules/notification-reader';

/**
 * The E journey's screens (onboarding-e.ts). Welcome, then five numbered
 * steps — name, goals, watch, reminders, the first payment (`capture` on
 * Android and web, `live` on iPhone, `complete` for its result) — then the
 * pattern reveal and the paywall, then the hand-off into Home.
 */
type Step = OnboardingEStep;
/** Routes the gate may hand to expo-router once onboarding commits. */
type OnboardingExit = '/pro' | '/statement-import';
const STEP_TRANSITION_MS = 350;
type CompletionOutcome = 'automatic' | 'manual' | 'denied' | 'failed';
type ShortcutCleanupState = 'revoked' | 'uncertain' | null;

const isWebPlatform = () => Platform.OS === 'web';
const isPublicWebSurface = () =>
  isWebPlatform() && process.env.EXPO_PUBLIC_WAFRA_E2E_DEMO !== '1';

/** The device Region, as a country guess the Name step can show. */
function deviceCountry(): string | null {
  try {
    return normalizeOnboardingCountry(getLocales()[0]?.regionCode);
  } catch {
    return null;
  }
}

/**
 * First run and platform capture hand-off, in design language E.
 *
 * It remains an overlay above the mounted navigator. Replacing the navigator
 * itself corrupts expo-router route state, and keeping it mounted also lets
 * iOS return from its first-class Shortcut setup to the gate, and lets the
 * last screen hand its pattern to Home's header as Home appears beneath it.
 */
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const language = useLanguage();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ onboarding?: string; statementSession?: string }>();
  const router = useRouter();
  const eMoving = useEMotion();
  const {
    state,
    // The Watch step's budgets and the currency they need; Goals' ids.
    upsertBudget,
    deleteBudget,
    setLedgerMoney,
    setGoals,
    storageFailure,
    storageRecoveryState,
    hydrationFailed,
    beginHistoryImport,
    ensureDurable,
    setOnboarded,
    setOnboardingProfile,
    setCountry: setLedgerCountry,
    setUserName,
    setCaptureOptOut,
    setAndroidCaptureSources,
    setDailySummary,
    restoreBackup,
  } = useStore();
  const [step, setStep] = useState<Step>('welcome');
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameSaveFailed, setNameSaveFailed] = useState(false);
  const [alerts, setAlerts] = useState<OnboardingAlertDelivery | null>(null);
  const [country, setCountry] = useState<string | null>(null);
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
  const requestedDestination = useRef<OnboardingExit | undefined>(undefined);
  /** A picked backup's text, waiting for the replace-everything confirmation. */
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  /** Why the Welcome restore stopped: the file could not be read, or it was not a backup. */
  const [restoreFailed, setRestoreFailed] = useState<'read' | 'invalid' | null>(null);
  /** Android: the explainer shown before the system SMS permission prompt. */
  const [smsExplainerVisible, setSmsExplainerVisible] = useState(false);
  /** iPhone: recorded evidence behind the four-row capture checklist. */
  const [checklistEvidence, setChecklistEvidence] = useState<IosChecklistEvidence | null>(null);
  const startedEventSent = useRef(false);
  const statementImportSession = useRef<string | null>(null);
  // Design language E additions.
  /** Goals picked on step 2, saved with setGoals on Continue. */
  const [goalsDraft, setGoalsDraft] = useState<GoalId[]>([]);
  /** Categories picked on step 3 and their limits, saved as budgets on Continue. */
  const [watchDraft, setWatchDraft] = useState<WatchDraft[]>([]);
  const [watchActive, setWatchActive] = useState<CategoryId | null>(null);
  /** The Reminders step's daily-summary switch; applied only with notifications allowed. */
  const [dailySummaryDraft, setDailySummaryDraft] = useState(true);
  /** Whether the Reminders step ended with notifications allowed; null when not decided this session. */
  const [notificationsAllowed, setNotificationsAllowed] = useState<boolean | null>(null);
  /** The Settings preview never writes a currency; it keeps the choice here. */
  const [currencyDraft, setCurrencyDraft] = useState<string | null>(null);
  /**
   * iPhone: Shortcuts setup (ios-setup) finishes onboarding itself. When the
   * gate launched it, the ledger turning onboarded is the cue to show the
   * first-payment result, the pattern and the paywall over Home once, with no
   * further writes.
   */
  const [revealAfterSetup, setRevealAfterSetup] = useState(false);
  const iosSetupLaunched = useRef(false);
  /** Statements opened from the result step return to the result, not to step 5. */
  const resumeAtResult = useRef(false);
  /** The colour wipe between steps: the colour it wipes from. */
  const shownColor = useRef<string | null>(null);
  const [wipe, setWipe] = useState<{ from: string; key: number } | null>(null);
  /** The pattern handed to Home's header after the last screen. */
  const [handoff, setHandoff] = useState<PatternInput | null>(null);
  /** The latest capture-derived alert answer, readable by the save that follows it. */
  const alertsRef = useRef<OnboardingAlertDelivery | null>(null);
  /** The latest ledger, for callbacks that finish after a render. */
  const stateRef = useRef(state);
  stateRef.current = state;
  const isOnboardingStatementRoute =
    Platform.OS !== 'web' &&
    pathname === '/statement-import' &&
    ((statementImportSession.current !== null &&
      params.statementSession === statementImportSession.current) ||
      (Platform.OS === 'ios' && matchesIosStatementHandoff(params.statementSession)));
  const previewMode = state.onboarded && params.onboarding === 'preview';
  const previewStarted = useRef(false);

  const resetJourneyState = () => {
    setResult(null);
    setSmsDenied(false);
    setAndroidSmsReady(false);
    setAndroidNotificationReady(false);
    setAwaitingNotificationAccess(false);
    setCompletionOutcome('manual');
    setNameDraft('');
    setNameSaving(false);
    setNameSaveFailed(false);
    setAlerts(null);
    alertsRef.current = null;
    setCountry(null);
    setGoalsDraft([]);
    setWatchDraft([]);
    setWatchActive(null);
    setDailySummaryDraft(true);
    setNotificationsAllowed(null);
    setCurrencyDraft(null);
    setStep('welcome');
  };

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
    resetJourneyState();
    // The preview draws the journey from a clean start and never writes.
  }, [previewMode]);

  const closePreview = () => {
    if (!previewMode) return;
    setLearnMoreVisible(false);
    resetJourneyState();
    router.setParams({ onboarding: undefined });
  };

  useEffect(() => () => {
    if (stepTransitionTimer.current !== null) clearTimeout(stepTransitionTimer.current);
    stepTransitionTimer.current = null;
  }, []);

  useEffect(() => {
    if (pathname !== '/statement-import') {
      statementImportSession.current = null;
      clearIosStatementHandoff();
    }
  }, [pathname]);

  const holdNextStep = () => {
    if (stepTransitionTimer.current !== null) clearTimeout(stepTransitionTimer.current);
    setTransitioning(true);
    // Adjacent steps share button positions. Ignore the second physical tap
    // while the new step settles, including when reduced motion is enabled.
    stepTransitionTimer.current = setTimeout(() => {
      stepTransitionTimer.current = null;
      setTransitioning(false);
    }, STEP_TRANSITION_MS);
  };
  const beginStepTransition = (): boolean => {
    if (stepTransitionTimer.current !== null || setupBusyRef.current || finishing) return false;
    holdNextStep();
    return true;
  };

  /**
   * Save where the journey is, keeping every answer the profile already
   * holds (a legacy focus/tracking, the country, the alert answer). The E
   * steps write the stage names older builds know (onboardingEStage).
   */
  const saveJourney = (stage: OnboardingJourneyStage) => {
    if (previewMode) return;
    const current = state.onboardingProfile;
    setOnboardingProfile({
      ...(current ?? {}),
      v: 1,
      stage,
      focus: current?.focus ?? null,
      tracking: current?.tracking ?? null,
      alerts: alertsRef.current ?? alerts ?? current?.alerts ?? null,
      country: country ?? normalizeOnboardingCountry(current?.country) ?? null,
      startedAt: current?.startedAt ?? Date.now(),
    });
  };

  const trackOnboardingEvent = (...args: Parameters<typeof trackGrowthEvent>) => {
    if (!previewMode) trackGrowthEvent(...args);
  };

  /**
   * The alert-delivery answer follows what the person chose on the first
   * payment step (onboarding-e.ts: alertsAnswerForCaptureChoice), so the
   * history-gap offer and Settings' statement row stay true without asking.
   */
  const recordCaptureChoice = (choice: OnboardingCaptureChoice) => {
    const next = alertsAnswerForCaptureChoice(choice);
    alertsRef.current = next;
    setAlerts(next);
    trackOnboardingEvent('onboarding_alerts_selected', {
      alerts: next,
      placement: GROWTH_PLACEMENTS.onboarding,
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
      setResumeFailed(false);
      resetJourneyState();
      setRevealAfterSetup(false);
      iosSetupLaunched.current = false;
    }
    previouslyOnboarded.current = state.onboarded;
    // These routes own their own handoff. Returning normally to the root must
    // re-read that progress, even when this gate stayed mounted underneath.
    if (!state.onboarded && (
      isOnboardingStatementRoute ||
      (Platform.OS === 'ios' &&
        (pathname === '/ios-setup' || pathname === '/ios-paging-beta' || pathname === '/ios-notification-setup' || pathname === '/ios-apple-pay-setup' || pathname === '/import-sms'))
    )) {
      resumeHandled.current = false;
      setResumeReady(true);
      return;
    }
    if (resumeHandled.current) return;
    if (state.onboardingProfile) {
      alertsRef.current = state.onboardingProfile.alerts ?? null;
      setAlerts(state.onboardingProfile.alerts ?? null);
      setCountry(normalizeOnboardingCountry(state.onboardingProfile.country));
    }
    if (state.onboarded) {
      resumeHandled.current = true;
      setResumeReady(true);
      return;
    }
    // The answers already durable in the ledger are the drafts to resume.
    setNameDraft(state.userName === 'there' ? '' : normalizePreferredName(state.userName) ?? '');
    setGoalsDraft(sanitizeGoalIds(state.wafraGoals) ?? []);
    const watched = watchDraftFromBudgets(state.budgets);
    setWatchDraft(watched);
    setWatchActive(watched[0]?.category ?? null);
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
        if (destination === 'ios-setup') {
          iosSetupLaunched.current = true;
          router.replace('/ios-setup?fromOnboarding=1');
        } else {
          const resumed = onboardingEResumeStep(destination, Platform.OS);
          setStep(resumeAtResult.current && (resumed === 'capture' || resumed === 'live') ? 'complete' : resumed);
        }
        resumeAtResult.current = false;
        setResumeReady(true);
        setResumeFailed(false);
      } catch {
        if (!cancelled) setResumeFailed(true);
      }
    };
    void restore();
    return () => { cancelled = true; };
  }, [state.captureOptOut, state.historyImport, state.hydrated, state.onboarded, state.onboardingPlan,
    state.onboardingProfile, state.userName, state.wafraGoals, state.budgets, hydrationFailed, isOnboardingStatementRoute,
    pathname, params.onboarding, router, resumeAttempt]);

  // iPhone: Shortcuts setup finished onboarding on its own (it marks the
  // ledger onboarded and returns to the root). Show the result, the pattern
  // and the paywall once, over Home, before handing over.
  useEffect(() => {
    if (!state.onboarded || !iosSetupLaunched.current || previewMode) return;
    iosSetupLaunched.current = false;
    setCompletionOutcome(state.captureOptOut ? 'manual' : 'automatic');
    setStep('complete');
    setRevealAfterSetup(true);
    // The alert answer follows the source setup actually recorded (or the
    // opt-out), keeping every other answer the profile holds.
    const optedOut = state.captureOptOut;
    void loadIosMessageSetupProgress().catch(() => null).then((progress) => {
      const next = alertsAnswerForIosSetup(optedOut, progress?.futureCaptureSource);
      alertsRef.current = next;
      setAlerts(next);
      const current = stateRef.current.onboardingProfile;
      if (current) setOnboardingProfile({ ...current, alerts: next });
    });
    // Runs once per completion; the profile is read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.onboarded, state.captureOptOut, previewMode]);

  const activeStep: Step = !previewMode && params.onboarding === 'complete' ? 'complete' : step;
  const stepBand = useBand(ONBOARDING_E_BANDS[activeStep]);
  /** Welcome's ink, for the screen shown while the ledger is read. */
  const inkBand = useBand('home');
  const words = onboardingECopy(language);
  // The ready summary is read from the ledger as it stands, once per ledger
  // change (memoised here, above every early return, so hook order is fixed).
  const readySummary = useMemo(() => activeStep === 'complete' && state.transactions.length > 0
    ? (() => {
        const live = liveAccountIds(state.accounts);
        const internal = internalTransferIdsForState(state);
        return onboardingReadySummary({
          transactions: state.transactions,
          isSpending: (tx) => isSpending(tx, live, internal),
          subscriptions: detectSubscriptions(state.transactions, state.notSubscriptions, new Date(), live, internal),
        });
      })()
    : null,
  // The summary reads only these ledger fields.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [activeStep, state.transactions, state.accounts, state.notSubscriptions, state.transferInternalIds,
    state.transferNormalizationVersion, state.historyImport]);
  /** The first payment that reached the ledger by itself, and its watched category this month. */
  const firstPayment = useMemo(() => {
    if (activeStep !== 'complete') return null;
    const live = liveAccountIds(state.accounts);
    const internal = internalTransferIdsForState(state);
    const spending = (tx: (typeof state.transactions)[number]) => isSpending(tx, live, internal);
    const arrived = arrivedPayment(state.transactions, spending);
    if (!arrived) return null;
    const period = currentMonthPeriod();
    return {
      arrived,
      watch: watchedProgress(arrived, state.budgets, state.transactions, spending, (date) => inPeriod(date, period)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, state.transactions, state.accounts, state.budgets, state.transferInternalIds]);
  const firstRunCopy = onboardingCopy(language);
  const shortcutWords = iosShortcutSetupCopy(language);

  const savedPreferredName = state.userName === 'there' ? null : normalizePreferredName(state.userName);
  const preferredName = previewMode ? normalizePreferredName(nameDraft) : savedPreferredName;
  const selectedAlerts = alerts ?? state.onboardingProfile?.alerts ?? null;
  const legacyFocus = state.onboardingProfile?.focus ?? null;
  const legacyTracking = state.onboardingProfile?.tracking ?? null;
  // The ledger's country (device Region by default) counts as an answer; an
  // unknown one ('ZZ' that nobody chose) still shows the device's guess.
  const ledgerCountry = state.country && state.country !== ONBOARDING_REGION_ELSEWHERE
    ? normalizeOnboardingCountry(state.country)
    : null;
  const selectedCountry = country ?? normalizeOnboardingCountry(state.onboardingProfile?.country) ?? ledgerCountry;
  // Reading the device Region is a native call; once per mount is enough.
  const deviceRegion = useMemo(deviceCountry, []);
  const shownCountry = selectedCountry ?? deviceRegion;
  // The ledger's currency once it has one; until then the region's suggestion,
  // which becomes the ledger's only when a limit is saved or it is chosen.
  const suggestedCurrency = useMemo(suggestedLedgerCurrency, []);
  const shownCurrency = (previewMode ? currencyDraft : null) ?? state.ledgerMoney?.currency ?? suggestedCurrency;
  const watchMoney = state.ledgerMoney ?? (shownCurrency ? ledgerMoneySpec(shownCurrency) : null);

  /**
   * The pattern as far as the journey has got: the name from step 1, the
   * goals from step 2, the watched limits from step 3, the reminders from
   * step 4. After that it is exactly what Home's header draws for this ledger
   * (patternInputFromState), so the hand-off keeps the same picture.
   */
  const patternInput = useMemo<PatternInput>(() => {
    const name = previewMode ? normalizePreferredName(nameDraft) : savedPreferredName;
    // On Watch the tiles follow the dial; after it, only what was saved.
    const budgets = activeStep === 'watch' ? [
      ...state.budgets.filter((budget) => !WATCH_CATEGORIES.includes(budget.category)),
      ...watchDraft.filter((item) => item.limitMinor > 0).map((item) => ({ category: item.category, limitFils: item.limitMinor })),
    ] : state.budgets;
    const live = patternInputFromState({
      userName: name ?? 'there',
      wafraGoals: goalsDraft,
      budgets,
      bills: state.bills,
      cardDues: state.cardDues,
      accounts: state.accounts,
      dailySummary: previewMode || activeStep === 'reminders' ? dailySummaryDraft : state.dailySummary,
    });
    if (activeStep === 'welcome' || activeStep === 'name') return { name: live.name };
    if (activeStep === 'goals') return { name: live.name, goals: live.goals };
    if (activeStep === 'watch') return { name: live.name, goals: live.goals, watched: live.watched };
    return live;
  }, [activeStep, dailySummaryDraft, goalsDraft, nameDraft, previewMode, savedPreferredName, state.accounts, state.bills,
    state.budgets, state.cardDues, state.dailySummary, watchDraft]);
  const patternTiles = useMemo(() => buildPattern(patternInput), [patternInput]);


  /**
   * "Restore from a backup" on Welcome: the same path as Settings → Data and
   * help — pick the JSON file, confirm that it replaces what is on this phone,
   * then hand it to the store's restore, which keeps this phone's Pro, trial
   * and capture choices. A backup of an onboarded ledger closes first run.
   */
  const pickBackupToRestore = async () => {
    setRestoreFailed(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/plain', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      setPendingRestore(await readBackupPickerCopy(picked.assets[0].uri));
    } catch {
      setRestoreFailed('read');
    }
  };

  /**
   * Android SMS: explain what the permission means before Android asks.
   * A phone that already granted it, and the preview, go straight on.
   */
  const openSmsSource = async () => {
    if (previewMode || androidSmsReady) {
      await runSetupAction(startScan);
      return;
    }
    const granted = await hasSmsPermission().catch(() => false);
    if (granted) await runSetupAction(startScan);
    else setSmsExplainerVisible(true);
  };

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

  // Guided iOS setup and the statement importer explicitly opened by this
  // mounted gate are part of onboarding. The in-memory session keeps an
  // external/cold deep link from forging that exemption.
  const isIosSetupRoute = Platform.OS === 'ios' && (
    pathname === '/ios-setup' ||
    pathname === '/ios-paging-beta' ||
    pathname === '/ios-notification-setup' || pathname === '/ios-apple-pay-setup' ||
    pathname === '/import-sms'
  );
  const showOverlay =
    !showRecovery &&
    state.hydrated &&
    (!state.onboarded || finishing || previewMode || revealAfterSetup) &&
    !isIosSetupRoute &&
    !isOnboardingStatementRoute;
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

  /**
   * Correcting the country is a preference, not a questionnaire answer, so it
   * does not advance or rewind the journey: it saves against whatever stage is
   * already durable. It is also the ledger's country (the same setting
   * Settings shows), so it is written there too — except in the Settings
   * preview, which never saves.
   */
  const chooseCountry = (id: string) => {
    const next = normalizeOnboardingCountry(id);
    if (!next) return;
    setCountry(next);
    if (!previewMode) {
      const current = state.onboardingProfile;
      setOnboardingProfile({
        ...(current ?? {}),
        v: 1,
        stage: current?.stage ?? 'welcome',
        focus: current?.focus ?? null,
        tracking: current?.tracking ?? null,
        country: next,
        startedAt: current?.startedAt ?? Date.now(),
      });
    }
    if (!previewMode) setLedgerCountry(next);
  };

  /** The ledger currency: an explicit choice, written like Settings writes it. */
  const chooseCurrency = (code: string) => {
    if (previewMode) {
      setCurrencyDraft(code);
      return;
    }
    // Refused only when the ledger already holds money in another currency;
    // the row then keeps showing the ledger's own.
    if (setLedgerMoney(code) && code !== shownCurrency) {
      // Unsaved limits were dialled in the old currency's minor units.
      setWatchDraft((draft) => draft.map((item) => ({ ...item, limitMinor: 0 })));
    }
  };

  const openName = () => {
    if (!beginStepTransition()) return;
    setNameDraft(previewMode ? '' : savedPreferredName ?? '');
    setNameSaveFailed(false);
    setStep('name');
  };

  const continueFromName = async (saveName: boolean) => {
    if (nameSaving || transitioning) return;
    const nextName = normalizePreferredName(nameDraft);
    if (saveName && !nextName) return;
    if (previewMode) {
      if (!saveName) setNameDraft('');
      if (!beginStepTransition()) return;
      setStep('goals');
      return;
    }
    setNameSaving(true);
    setNameSaveFailed(false);
    try {
      if (saveName && nextName) setUserName(nextName);
      saveJourney('focus');
      // Persist the lightweight profile/name together. If the process dies on
      // the next screen, onboarding resumes at Goals with the same greeting.
      await ensureDurable();
      if (!beginStepTransition()) return;
      setStep('goals');
    } catch {
      setNameSaveFailed(true);
    } finally {
      setNameSaving(false);
    }
  };

  /** Goals: stored for the pattern, and Home's sections reordered through Customize Home's preference. */
  const saveGoals = () => {
    if (!beginStepTransition()) return;
    if (!previewMode) {
      setGoals(goalsDraft);
      const chosen = [...goalsDraft];
      void loadHomeWidgetPreferences()
        .then((current) => saveHomeWidgetPreferences(homeOrderForGoals(chosen, current)))
        .catch(() => {});
    }
    trackOnboardingEvent('onboarding_focus_selected', {
      focus: legacyFocus,
      tracking: legacyTracking,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
    saveJourney('tracking');
    setStep('watch');
  };

  const toggleWatchCategory = (category: CategoryId) => {
    const next = toggleWatch(watchDraft, category);
    setWatchDraft(next);
    const picked = next.some((item) => item.category === category);
    if (picked) setWatchActive(category);
    else if (watchActive === category) setWatchActive(next[next.length - 1]?.category ?? null);
  };

  /**
   * Watch: every picked category with a limit becomes a monthly budget, and a
   * limit unpicked on a second pass is removed. A budget needs the ledger's
   * currency, so the currency shown on the Name step is pinned first when the
   * ledger has none yet.
   */
  const saveWatch = (save: boolean) => {
    if (!beginStepTransition()) return;
    if (save && !previewMode) {
      const { upsert, remove } = watchBudgetChanges(watchDraft, state.budgets);
      try {
        if (upsert.length > 0 && !state.ledgerMoney && shownCurrency) setLedgerMoney(shownCurrency);
        for (const category of remove) deleteBudget(category);
        for (const budget of upsert) upsertBudget(budget);
      } catch {
        // A refused budget leaves the ledger as it was; the Limit sheet can set it later.
      }
    }
    saveJourney('alerts');
    setStep('reminders');
  };

  /**
   * Reminders: the explicit tap that may show the system notification prompt,
   * and the daily-summary switch, which only turns on with notifications
   * allowed. Payment reminders need no switch — they are scheduled whenever
   * notifications are allowed.
   */
  const finishNotificationChoice = async (enable: boolean) => {
    let granted = false;
    if (enable && !previewMode) {
      granted = await requestVisibleNotificationPermission().catch(() => false);
    }
    if (!previewMode) {
      const daily = granted && dailySummaryDraft;
      setDailySummary(daily);
      if (daily) {
        // Schedule tonight immediately; later ledger refreshes keep it current.
        await syncDailySummary({ ...state, dailySummary: true }).catch(() => {});
      } else {
        await cancelDailySummary().catch(() => {});
      }
    }
    setNotificationsAllowed(previewMode ? enable : granted);
    saveJourney('capture');
    // Step 5 is where the capture privacy points and How it works are shown.
    trackOnboardingEvent('onboarding_privacy_seen', {
      focus: legacyFocus,
      tracking: legacyTracking,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
    // An async action ends in a new step: its buttons sit where Allow was, so
    // a second tap on Allow must not land on Set up.
    holdNextStep();
    setStep(Platform.OS === 'ios' ? 'live' : 'capture');
  };

  const startScan = async () => {
    setSmsDenied(false);
    if (previewMode) {
      setAndroidSmsReady(true);
      return;
    }
    trackOnboardingEvent('capture_setup_started', { focus: legacyFocus, tracking: legacyTracking, source: 'sms' });
    let granted = false;
    try {
      granted = await requestSmsPermission();
    } catch {
      trackOnboardingEvent('capture_setup_failed', { focus: legacyFocus, tracking: legacyTracking, source: 'sms', outcome: 'failed' });
      setSmsDenied(true);
      return;
    }
    if (!granted) {
      trackOnboardingEvent('capture_permission_denied', { focus: legacyFocus, tracking: legacyTracking, source: 'sms', outcome: 'denied' });
      setSmsDenied(true);
      return;
    }
    // READ_SMS makes history/catch-up work, but it does not deliver
    // SMS_RECEIVED while Wafra is backgrounded. Ask for the live-delivery edge
    // and Wafra's own notification permission here, while the user is
    // explicitly enabling automatic SMS tracking. Either refusal still keeps
    // catch-up import usable; the foreground repair prompt can retry later.
    await requestSmsDeliveryPermission().catch(() => false);
    await requestVisibleNotificationPermission().catch(() => false);
    trackOnboardingEvent('capture_permission_granted', { focus: legacyFocus, tracking: legacyTracking, source: 'sms', outcome: 'automatic' });
    try {
      await setAndroidCaptureSources({
        sms: true,
        notifications: androidNotificationReady || state.androidCaptureSources?.notifications === true,
      });
      await setCaptureOptOut(false);
      await beginHistoryImport();
      recordCaptureChoice('sms');
      saveJourney('capture');
      await ensureDurable();
      setAndroidSmsReady(true);
    } catch {
      trackOnboardingEvent('capture_setup_failed', { focus: legacyFocus, tracking: legacyTracking, source: 'sms', outcome: 'failed' });
      setSmsDenied(true);
    }
  };

  const enableAndroidNotificationAdmission = React.useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || !NotificationReader?.setCaptureEnabled) return false;
    const expiresAt = bankNotificationAdmissionExpiresAt({
      pro: state.pro,
      founderPro: state.founderPro,
      trialStartTs: state.trialStartTs,
    });
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
    trackOnboardingEvent('capture_setup_started', { focus: legacyFocus, tracking: legacyTracking, source: 'bank-notifications' });
    await setAndroidCaptureSources({
      sms: androidSmsReady || state.androidCaptureSources?.sms === true,
      notifications: true,
    });
    await setCaptureOptOut(false);
    const admitted = await enableAndroidNotificationAdmission();
    if (!admitted) {
      trackOnboardingEvent('capture_setup_failed', { focus: legacyFocus, tracking: legacyTracking, source: 'bank-notifications' });
      return;
    }
    if (!androidSmsReady) {
      recordCaptureChoice('notifications');
      saveJourney('capture');
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
      recordCaptureChoice(androidSmsReady ? 'sms' : 'notifications');
      saveJourney('complete');
      await ensureDurable();
      setSmsDenied(false);
      setCompletionOutcome('automatic');
      setStep('complete');
    } catch {
      trackOnboardingEvent('capture_setup_failed', { focus: legacyFocus, tracking: legacyTracking, outcome: 'failed' });
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
      trackOnboardingEvent('capture_setup_started', { focus: legacyFocus, tracking: legacyTracking });
      try {
        await setCaptureOptOut(false);
      } catch {
        trackOnboardingEvent('capture_setup_failed', { focus: legacyFocus, tracking: legacyTracking, outcome: 'failed' });
        setCompletionOutcome('failed');
        saveJourney('complete');
        setStep('complete');
        return;
      }
      saveJourney('capture');
      // Setup finishes onboarding itself (and its source decides the alert
      // answer, recorded when it returns); the gate then shows the result,
      // the pattern and the paywall once over Home (revealAfterSetup).
      iosSetupLaunched.current = true;
      // The return query survives a cold route remount and tells the gate to
      // show the summary instead of restarting the questionnaire.
      router.push('/ios-setup?fromOnboarding=1');
      return;
    }
    if (Platform.OS === 'android' && isSmsScanningAvailable()) {
      await startScan();
      return;
    }
    trackOnboardingEvent('capture_setup_failed', { focus: legacyFocus, tracking: legacyTracking, outcome: 'failed' });
    setCompletionOutcome('failed');
    saveJourney('complete');
    setStep('complete');
  };

  /**
   * "Import statements": the in-onboarding importer, authorised by this
   * gate's session. From the result step it keeps the `complete` stage, so
   * coming back returns to the result; from step 5 it keeps `capture`.
   */
  const openStatementImport = () => {
    // The Settings preview never imports anything.
    if (Platform.OS === 'web' || previewMode || !beginStepTransition()) return;
    const fromResult = activeStep === 'complete';
    resumeAtResult.current = fromResult;
    if (!fromResult) recordCaptureChoice('statements');
    saveJourney(fromResult ? 'complete' : 'capture');
    const session = Crypto.randomUUID();
    statementImportSession.current = session;
    router.push(`/statement-import?fromOnboarding=1&statementSession=${session}`);
  };

  // The iPhone checklist reads only recorded evidence: the owner's own
  // setup confirmations and the native queue's proof and first-capture time.
  // It refreshes whenever Wafra comes back from Shortcuts.
  useEffect(() => {
    if (previewMode || Platform.OS !== 'ios' || activeStep !== 'live') return;
    let cancelled = false;
    // Refreshes can overlap (mount, then an immediate foreground). Only the
    // latest one may publish, so a slow earlier read never overwrites it.
    let latest = 0;
    const refresh = async () => {
      const request = ++latest;
      const progress = await loadIosMessageSetupProgress().catch(() => null);
      const native = getIosCaptureNativeModule();
      const status = native ? await native.getCaptureStatus().catch(() => null) : null;
      if (cancelled || request !== latest) return;
      const recordedMessage = (progress?.futureCaptureSource ?? 'message') === 'message';
      const parked = progress?.parkedSources?.message;
      setChecklistEvidence({
        shortcutConfirmed: recordedMessage ? progress?.futureShortcutConfirmed === true : parked?.shortcutConfirmed === true,
        automationConfirmed: recordedMessage ? progress?.futureAutomationConfirmed === true : parked?.automationConfirmed === true,
        // The setup screen's own rule: enabled, and this build's proof version.
        readiness: status && native
          ? resolveIosSetupReadiness(status, native.getMessageShortcutURL ? 3 : 1)
          : 'not-added',
      });
    };
    void refresh();
    const subscription = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [activeStep, previewMode]);

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
    iosSetupLaunched.current = false;
    if (previewMode) {
      recordCaptureChoice('manual');
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
        //
        // Only a relay that a Shortcut carries can do that. A statement upload
        // pairs a relay for the upload alone; revoking that one would strand
        // rows still queued for this phone and warn about a Shortcut that was
        // never installed.
        try {
          const relay = await getRelayConfigStrict();
          if (relay && isLegacyShortcutCaptureActive(relay)) {
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
      trackOnboardingEvent('manual_tracking_selected', { focus: legacyFocus, tracking: legacyTracking, outcome: 'manual' });
      recordCaptureChoice('manual');
      setCompletionOutcome('manual');
      saveJourney('complete');
      setStep('complete');
    } catch {
      trackOnboardingEvent('capture_setup_failed', { focus: legacyFocus, tracking: legacyTracking, outcome: 'failed' });
      setCompletionOutcome('failed');
      saveJourney('complete');
      setStep('complete');
    }
  };

  const goBack = () => {
    if (!beginStepTransition()) return;
    if (activeStep === 'paywall') {
      setStep('pattern');
    } else if (activeStep === 'pattern') {
      setStep('complete');
    } else if (activeStep === 'complete') {
      setStep(Platform.OS === 'ios' ? 'live' : 'capture');
      saveJourney('capture');
      if (params.onboarding && !previewMode) router.setParams({ onboarding: undefined });
    } else if (activeStep === 'live' || activeStep === 'capture') {
      setStep('reminders');
      saveJourney('alerts');
    } else if (activeStep === 'reminders') {
      setStep('watch');
      saveJourney('tracking');
    } else if (activeStep === 'watch') {
      setStep('goals');
      saveJourney('focus');
    } else if (activeStep === 'goals') {
      setStep('name');
      saveJourney('welcome');
      setNameDraft(preferredName ?? '');
      setNameSaveFailed(false);
    } else {
      setStep('welcome');
      saveJourney('welcome');
    }
  };

  /** From the first-payment result to the pattern reveal. */
  const showPattern = () => {
    if (!beginStepTransition()) return;
    if (params.onboarding === 'complete' && !previewMode) router.setParams({ onboarding: undefined });
    trackOnboardingEvent('onboarding_value_previewed', {
      focus: legacyFocus,
      tracking: legacyTracking,
      placement: GROWTH_PLACEMENTS.onboarding,
    });
    setStep('pattern');
  };

  const openWafra = async (
    addFirstEntry = false,
    destination?: OnboardingExit,
    outcomeOverride?: CompletionOutcome,
  ) => {
    if (previewMode) {
      closePreview();
      return;
    }
    iosSetupLaunched.current = false;
    setFinishing(true);
    requestedFirstEntry.current = addFirstEntry;
    requestedDestination.current = destination;
    try {
      saveJourney('complete');
      setOnboarded();
      await ensureDurable();
      trackOnboardingEvent('onboarding_completed', {
        focus: legacyFocus,
        tracking: legacyTracking,
        outcome: outcomeOverride ?? completionOutcome,
        placement: GROWTH_PLACEMENTS.onboarding,
      });
      committed();
      // An older profile's chosen first view is kept; the E journey has none,
      // so it lands on Home.
      const landing = destination ?? onboardingLandingPath(legacyFocus);
      if (addFirstEntry) router.push('/add-transaction');
      else router.replace(landing);
      // Home rises under the ink as the pattern moves to its header (E11).
      if (!addFirstEntry && landing === '/') setHandoff(patternInputFromState(state));
      setFinishSaveFailed(false);
      setFinishing(false);
    } catch {
      setFinishSaveFailed(true);
      setCompletionOutcome('failed');
      setStep('complete');
    }
  };

  /** The last screen's exit: the durable finish, or — after iPhone setup already finished — the hand-off alone. */
  const finishJourney = () => {
    if (revealAfterSetup) {
      setRevealAfterSetup(false);
      setHandoff(patternInputFromState(state));
      return;
    }
    void runSetupAction(() => openWafra());
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
      <View style={[styles.loadingRoot, { backgroundColor: inkBand.band }]} accessibilityLiveRegion="polite">
        <StatusBar style={inkBand.statusBar} />
        <LogoDraw size={48} color={inkBand.accent} />
        <ThemedText type="small" style={{ color: inkBand.onBandSecondary }}>
          {t(resumeFailed ? 'onboardResumeError' : 'loadingLedger')}
        </ThemedText>
        {resumeFailed && (
          <EButton palette={inkBand} color={bandButtonColor(inkBand)} label={t('storageRecoveryRetry')}
            style={styles.loadingRetry} onPress={() => {
              setResumeFailed(false);
              setResumeAttempt((value) => value + 1);
            }} />
        )}
      </View>
    );
  }

  const handoffLayer = handoff
    ? <HandoffLayer tiles={buildPattern(handoff)} onDone={() => setHandoff(null)} />
    : null;

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
  // The colour wipe (board E10): when the step's colour changes, the next
  // colour grows from the Continue button. Derived during render so the old
  // colour is never replaced by the new one for a frame first; the first
  // colour is only recorded, and nothing is remembered while hidden.
  if (!showOverlay) {
    shownColor.current = null;
    return <View style={styles.container}>{gatedChildren}{handoffLayer}</View>;
  }
  const overlayColor = stepBand.band;
  if (overlayColor !== shownColor.current) {
    const from = shownColor.current;
    shownColor.current = overlayColor;
    if (from !== null && eMoving) setWipe({ from, key: (wipe?.key ?? 0) + 1 });
  }


  const automaticCompletion =
    (!previewMode && params.onboarding === 'complete') || completionOutcome === 'automatic';
  const failedCompletion =
    activeStep === 'complete' && !automaticCompletion && completionOutcome === 'failed';
  /**
   * The statement offer is earned by what the person chose, not by a guess.
   *
   * It is deliberately NOT shown when setup failed or SMS was refused: those
   * states already own the screen with their own recovery, and stacking a
   * second "here is what is missing" card on top reads as the app giving up.
   * Web has no capture to fall short of, so it has no gap to fill either.
   */
  const showHistoryGapOffer = activeStep === 'complete' &&
    Platform.OS === 'android' &&
    !previewMode &&
    !revealAfterSetup &&
    onboardingHistoryGap(selectedAlerts) &&
    !failedCompletion &&
    !finishSaveFailed &&
    !smsDenied;
  // The ready summary is read from the ledger as it stands. A history import
  // that is still running means the figures are not final, and says so.
  const importsStillReading = state.historyImport?.status === 'running' ||
    state.historyImport?.status === 'paused';
  const discoveredResult = result ?? (
    state.transactions.length > 0 || state.accounts.length > 0 || state.bills.length > 0 || state.cardDues.length > 0
      ? {
          // One source for the count the card and the summary both describe.
          tx: readySummary?.transactions ?? state.transactions.length,
          accounts: state.accounts.filter((account) => !account.archived).length,
          bills: state.bills.length + state.cardDues.length,
        }
      : null
  );
  const entitled = state.pro || state.founderPro === true;
  const showPaywall = previewMode || !entitled;
  const watchedLabel = (() => {
    const watched = patternInput.watched?.[0] ?? null;
    return watched ? categoryLabel(watched, language === 'ar' ? 'ar' : 'en') : null;
  })();
  // Only claims about this person: reminders they allowed this session, and
  // capture that is actually on (not opted out, a source set up).
  const remindersOn = notificationsAllowed === true;
  const captureOn = !state.captureOptOut && Platform.OS !== 'web' && automaticCompletion;
  const backDisabled = setupBusy || finishing || transitioning;
  const onClose = previewMode ? closePreview : undefined;
  const lang = language === 'ar' ? 'ar' : 'en';

  const captureStep = (
    <EStepFrame palette={stepBand} step={5} testID={Platform.OS === 'ios' ? 'onboarding-ios-live' : 'onboarding-capture'}
      // Back from the SMS explainer returns to the source list on the same
      // step; it never leaves the explainer flag set behind.
      onBack={smsExplainerVisible ? () => setSmsExplainerVisible(false) : goBack}
      onClose={onClose} backDisabled={backDisabled}
      footer={Platform.OS === 'android' && smsExplainerVisible ? null : <>
        {Platform.OS === 'ios' ? <EButton palette={stepBand} color={bandButtonColor(stepBand)} label={t('onboardLiveAction')}
          onPress={() => void runSetupAction(beginCapture)} disabled={setupBusy || transitioning} busy={setupBusy}
          testID="onboarding-live-action" /> : null}
        {Platform.OS === 'android' && (androidSmsReady || androidNotificationReady) ? <EButton palette={stepBand}
          color={bandButtonColor(stepBand)}
          label={t(androidSmsReady && androidNotificationReady ? 'onboardCaptureContinueBoth' : 'onboardCaptureContinueOne')}
          onPress={() => void runSetupAction(finishAndroidCapture)} disabled={setupBusy || transitioning}
          testID="onboarding-capture-continue" /> : null}
        {Platform.OS !== 'web' ? <ETextAction palette={stepBand} label={t('onboardHowItWorks')}
          onPress={() => setLearnMoreVisible(true)} testID="onboarding-how-it-works" /> : null}
      </>}>
      {Platform.OS === 'android' && smsExplainerVisible ? (
        <SmsPermissionExplainer
          palette={stepBand}
          language={lang}
          disabled={setupBusy || transitioning}
          onContinue={() => {
            setSmsExplainerVisible(false);
            void runSetupAction(startScan);
          }}
          onNotNow={() => setSmsExplainerVisible(false)}
        />
      ) : <>
        <EHeadline palette={stepBand} size={42}>{Platform.OS === 'ios' ? t('onboardLiveTitle') : words.captureTitle}</EHeadline>
        <EBody palette={stepBand}>
          {Platform.OS === 'ios' ? t('onboardLiveBody') : Platform.OS === 'android' ? words.captureBodyAndroid : words.captureBodyWeb}
        </EBody>
        {Platform.OS === 'ios' ? <CaptureChecklist
          palette={stepBand}
          rows={iosCaptureChecklist(previewMode ? null : checklistEvidence)}
          titles={{
            add: shortcutWords.add,
            test: shortcutWords.check,
            automate: shortcutWords.automate,
            'first-alert': firstRunCopy.checklistFirstAlert,
          }}
          details={{
            'first-alert': checklistEvidence && iosCaptureChecklist(checklistEvidence)[3].done
              ? firstRunCopy.checklistFirstAlertDone
              : shortcutWords.waitingAutomation,
          }}
          doneLabel={firstRunCopy.checklistDone}
          toDoLabel={firstRunCopy.checklistToDo}
          openShortcutsLabel={firstRunCopy.openShortcuts}
          onOpenShortcuts={openShortcutsApp}
        /> : null}
        <View style={styles.sources} testID="onboarding-start-options">
          {Platform.OS === 'android' ? <>
            <SourceRow palette={stepBand} icon="mail" title={t('onboardAndroidSmsSourceTitle')} body={t('onboardAndroidSmsSourceBody')}
              ready={androidSmsReady} disabled={setupBusy || transitioning} onPress={() => void openSmsSource()}
              testID="onboarding-source-sms" />
            {smsDenied && !androidSmsReady ? <ThemedText type="meta" accessibilityLiveRegion="polite"
              style={{ color: stepBand.onBand }}>{t('onboardSmsDeniedInline')}</ThemedText> : null}
            <SourceRow palette={stepBand} icon="phone" title={t('onboardAndroidPushSourceTitle')}
              body={t(awaitingNotificationAccess ? 'onboardAndroidPushAwaiting' : 'onboardAndroidPushSourceBody')}
              ready={androidNotificationReady} disabled={setupBusy || transitioning}
              onPress={() => void runSetupAction(connectAndroidNotifications)} testID="onboarding-source-notifications" />
          </> : null}
          {Platform.OS !== 'web' && !previewMode ? <SourceRow palette={stepBand} icon="upload" title={words.importStatements}
            body={words.importStatementsBody} disabled={setupBusy || transitioning} onPress={openStatementImport}
            testID="onboarding-source-statements" /> : null}
          <SourceRow palette={stepBand} icon="plus" title={words.addByHand} body={words.addByHandBody}
            disabled={setupBusy || transitioning} onPress={() => void runSetupAction(continueManually)}
            testID="onboarding-source-manual" />
        </View>
        {Platform.OS !== 'web' ? <TrustLine palette={stepBand} items={[
          { icon: 'lock', title: t('onboardCaptureLocalAutomaticTitle'), body: t('onboardCaptureLocalAutomaticBody') },
          { icon: 'bank', title: t('onboardPrivacyNoLoginTitle'), body: t('onboardPrivacyNoLoginBody') },
          { icon: 'repeat', title: t('onboardPrivacyChoiceTitle'), body: t('onboardPrivacyChoiceBody') },
        ]} /> : null}
        {setupBusy ? <ThemedText type="meta" accessibilityLiveRegion="polite" style={{ color: stepBand.onBandSecondary }}>
          {t('onboardSetupWorking')}
        </ThemedText> : null}
      </>}
    </EStepFrame>
  );

  const completeTitle = finishSaveFailed ? t('onboardFinishSaveFailedTitle')
    : failedCompletion ? t('onboardCompleteNeedsAttentionTitle')
      : smsDenied ? t('onboardPermissionChoiceTitle')
        : !automaticCompletion ? words.manualTitle
          : firstPayment ? words.workingTitle(preferredName)
            : words.waitingTitle;
  const completeBody = finishSaveFailed ? t('onboardFinishSaveFailedBody')
    : failedCompletion ? t('onboardCompleteNeedsAttentionBody')
      : smsDenied ? t('onboardPermissionChoiceBody')
        : !automaticCompletion ? t('onboardCompleteManualBody')
          : firstPayment ? null
            : words.waitingBody;
  const completeStep = (
    <EStepFrame palette={stepBand} step={5} testID="onboarding-complete"
      onBack={revealAfterSetup ? undefined : goBack} onClose={onClose} backDisabled={backDisabled}
      footer={finishSaveFailed ? <EButton palette={stepBand} color={bandButtonColor(stepBand)} label={t('storageRecoveryRetry')}
        onPress={() => void runSetupAction(() => openWafra(requestedFirstEntry.current, requestedDestination.current))}
        disabled={setupBusy} testID="onboarding-finish-retry" />
        : failedCompletion || smsDenied ? <>
          <EButton palette={stepBand} color={bandButtonColor(stepBand)} label={t('onboardRetrySetup')}
            onPress={goBack} disabled={setupBusy || transitioning} testID="onboarding-retry-setup" />
          <ETextAction palette={stepBand} label={words.addByHand}
            onPress={() => void runSetupAction(continueManually)} disabled={setupBusy} testID="onboarding-complete-manual" />
        </> : <EButton palette={stepBand} color={bandButtonColor(stepBand)} label={words.continue}
          onPress={showPattern} disabled={setupBusy || transitioning} testID="onboarding-complete-continue" />}>
      <EHeadline palette={stepBand} size={42}>{completeTitle}</EHeadline>
      {completeBody ? <EBody palette={stepBand}>{completeBody}</EBody> : null}
      {smsDenied ? <View style={styles.recovery}>
        <ThemedText type="meta" accessibilityLiveRegion="polite" style={{ color: stepBand.onBand }}>{t('onboardSmsDenied')}</ThemedText>
        <EButton palette={stepBand} variant="secondary" label={t('retryHistoryRead')}
          onPress={() => void runSetupAction(startScan)} disabled={setupBusy} />
        <EButton palette={stepBand} variant="secondary" label={t('openPhoneSettings')}
          onPress={() => void Linking.openSettings().catch(() => {})} />
      </View> : null}
      {automaticCompletion && firstPayment && !failedCompletion && !smsDenied && !finishSaveFailed
        ? <ArrivedCard palette={stepBand} transaction={firstPayment.arrived} money={state.ledgerMoney ?? null}
          watch={firstPayment.watch} />
        : null}
      {discoveredResult && discoveredResult.tx > 0 && !failedCompletion && !smsDenied ? <ResultStrip palette={stepBand} cells={[
        { value: discoveredResult.tx, label: t(discoveredResult.tx === 1 ? 'onboardEntryFound' : 'onboardEntriesFound') },
        { value: discoveredResult.accounts, label: t(discoveredResult.accounts === 1 ? 'onboardAccountFound' : 'onboardAccountsFound') },
        { value: discoveredResult.bills, label: t('onboardBillsFound') },
      ]} /> : null}
      {readySummary && !failedCompletion && !smsDenied ? <ReadySummary
        palette={stepBand}
        summary={readySummary}
        money={state.ledgerMoney ?? null}
        language={lang}
        pending={importsStillReading}
      /> : null}
      {showHistoryGapOffer ? <View style={styles.gap} testID="onboarding-history-gap">
        {/* "Wafra catches everything from here" is true of a bank that sends
            something. For one that sends nothing it is a promise the app
            cannot keep. */}
        <ThemedText type="smallBold" style={{ color: stepBand.onBand }}>
          {t(onboardingNoAutomaticCapture(selectedAlerts) ? 'onboardHistoryGapManualTitle' : 'onboardHistoryGapTitle')}
        </ThemedText>
        <ThemedText type="meta" style={{ color: stepBand.onBandSecondary }}>
          {t(onboardingNoAutomaticCapture(selectedAlerts) ? 'onboardHistoryGapManualBody' : 'onboardHistoryGapBody')}
        </ThemedText>
        <EButton palette={stepBand} variant="secondary" label={t('onboardHistoryGapAction')}
          disabled={setupBusy || transitioning}
          onPress={() => {
            trackOnboardingEvent('onboarding_history_gap_import_opened', {
              focus: legacyFocus,
              tracking: legacyTracking,
              alerts: selectedAlerts,
              placement: GROWTH_PLACEMENTS.onboarding,
            });
            openStatementImport();
          }} />
      </View> : null}
    </EStepFrame>
  );

  const renderStep = () => {
    switch (activeStep) {
      case 'welcome':
        return <WelcomeStep onStart={openName} onClose={onClose} disabled={transitioning}
          onRestore={!previewMode && Platform.OS !== 'web' ? () => void pickBackupToRestore() : undefined}
          restoreNote={restoreFailed === 'read' ? firstRunCopy.restoreReadFailed : restoreFailed ? t('notAWafraBackup') : null} />;
      case 'name':
        return <NameStep nameDraft={nameDraft}
          onChangeName={(value) => { setNameDraft(value); setNameSaveFailed(false); }}
          onContinue={() => void continueFromName(true)} onSkip={() => void continueFromName(false)}
          onBack={() => {
            if (!beginStepTransition()) return;
            setNameSaveFailed(false);
            setStep('welcome');
          }}
          onClose={onClose} busy={nameSaving || transitioning} saveFailed={nameSaveFailed}
          country={shownCountry} suggestedCountry={deviceRegion} onCountry={chooseCountry}
          currency={shownCurrency} onCurrency={chooseCurrency} />;
      case 'goals':
        return <GoalsStep goals={goalsDraft} onToggle={(goal) => setGoalsDraft(toggleGoal(goalsDraft, goal))}
          onContinue={saveGoals} onBack={goBack} onClose={onClose} tiles={patternTiles} disabled={transitioning} />;
      case 'watch':
        return <WatchStep draft={watchDraft} active={watchActive} onToggle={toggleWatchCategory}
          onActivate={setWatchActive}
          onLimit={(category, limit) => setWatchDraft(setWatchLimit(watchDraft, category, limit))}
          moneySpec={watchMoney} currency={shownCurrency} onCurrency={chooseCurrency}
          onContinue={() => saveWatch(true)} onSkip={() => saveWatch(false)}
          onBack={goBack} onClose={onClose} disabled={transitioning} />;
      case 'reminders':
        return <RemindersStep dailySummary={dailySummaryDraft} onDailySummary={setDailySummaryDraft}
          onAllow={() => void runSetupAction(() => finishNotificationChoice(true))}
          onNotNow={() => void runSetupAction(() => finishNotificationChoice(false))}
          onBack={goBack} onClose={onClose} busy={setupBusy || transitioning} />;
      case 'capture':
      case 'live':
        return captureStep;
      case 'complete':
        return completeStep;
      case 'pattern':
        return <PatternStep tiles={patternTiles} name={preferredName}
          continueLabel={showPaywall ? words.oneLastThing : words.openWafra}
          onContinue={showPaywall ? () => {
            if (!beginStepTransition()) return;
            setStep('paywall');
          } : finishJourney}
          onBack={goBack} onClose={onClose} disabled={setupBusy || finishing || transitioning} />;
      case 'paywall':
        return <PaywallStep tiles={patternTiles} watchedCategory={watchedLabel} remindersOn={remindersOn}
          trialDays={trialDaysLeft(state)} captureOn={captureOn} onFinish={finishJourney} onBack={goBack} onClose={onClose}
          preview={previewMode} finishing={setupBusy || finishing} />;
    }
  };

  return (
    <View style={styles.container}>
      {gatedChildren}
      <View style={[StyleSheet.absoluteFillObject, styles.root, { backgroundColor: stepBand.band }]}>
        <StatusBar style={stepBand.statusBar} />
        {wipe ? <StepWipe key={wipe.key} from={wipe.from} to={stepBand.band} onDone={() => setWipe(null)} /> : null}
        <Animated.View key={activeStep} entering={stepEntering(wipe !== null)} style={styles.stepLayer}>
          {renderStep()}
        </Animated.View>
        <BottomSheet
          visible={learnMoreVisible}
          onClose={() => setLearnMoreVisible(false)}
          title={t('onboardCaptureLearnMoreTitle')}>
          <View style={styles.learnMoreContent}>
            <ThemedText type="small" themeColor="textSecondary">{t('onboardCaptureLearnMorePrivacy')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{t('onboardCaptureLearnMoreRetention')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{t('onboardCaptureLearnMoreLegacy')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">{t('onboardCaptureLearnMoreLimits')}</ThemedText>
          </View>
        </BottomSheet>
      </View>
      {handoffLayer}
      <ConfirmSheet
        visible={pendingRestore !== null}
        onClose={() => setPendingRestore(null)}
        question={t('restoreBackupQ')}
        body={t('restoreReplacesAll')}
        confirmLabel={t('restoreAction')}
        destructive
        onConfirm={() => {
          const content = pendingRestore;
          setPendingRestore(null);
          if (content === null) return;
          // The store's own restore: pro, trial clock and capture choices on
          // this phone always win over what the file says.
          const restored = restoreBackup(content);
          setRestoreFailed(restored ? null : 'invalid');
          if (restored) {
            // Resume again from the restored ledger: its stage, name, goals and limits.
            iosSetupLaunched.current = false;
            resumeHandled.current = false;
            setResumeReady(false);
            setResumeAttempt((value) => value + 1);
          }
        }}
      />
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
  root: { flex: 1, alignItems: 'center' },
  stepLayer: { flex: 1, width: '100%' },
  loadingRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 24,
  },
  loadingRetry: { alignSelf: 'stretch', maxWidth: 420 },
  sources: { gap: 8 },
  recovery: { gap: 8 },
  gap: { gap: 8, paddingTop: 4 },
  learnMoreContent: { gap: 16 },
});

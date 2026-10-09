import { HistoryReadingStatus } from '@/components/history-reading-status';
import { MoneyPictureProgress } from '@/components/money-picture-progress';
import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, AppState, Platform, Pressable, RefreshControl, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from '@/hooks/use-app-router';
import { CoinToken } from '@/components/ui/coins/coin-token';
import {
  COIN_MOVE_CURVE, COIN_RISE_CURVE, COIN_STAGGER, coinStepsEnd, coinTrack, useCoinClock, useCoinRun, type CoinNode, type CoinRun,
  type CoinStep,
} from '@/components/ui/coins/coin-motion';
import { useAppActive } from '@/hooks/use-app-active';
import { useMotionPreference } from '@/hooks/use-reduced-motion';
import { Fonts } from '@/constants/theme';
import { useFocusEffect } from '@react-navigation/native';

import { ThemedText } from '@/components/themed-text';
import { PeriodSheet } from '@/components/period-sheet';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { CardPaymentSheet } from '@/components/card-payment-sheet';
import { BillDetailSheet } from '@/components/bill-detail-sheet';
import { usePrivacyGateCleared } from '@/components/lock-gate';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { ReferenceHomeBand, ReferenceHomeGreeting, ReferenceHomeSummary, ReferenceHomeToday, ReferenceHomeWeek } from '@/components/reference-home-summary';
import { HOME_ADD_BUTTON_CLEARANCE, HomeAddButton } from '@/components/home-add-button';
import { LimitSheet } from '@/components/limit-sheet';
import { TransferReviewNotice } from '@/components/transfer-review-notice';
import { RecapLogoTrigger } from '@/components/recap/recap-logo-trigger';
import { BandScaffold } from '@/components/ui/band-scaffold';
import { YourPattern } from '@/components/ui/your-pattern';
import { WidgetsHint } from '@/components/widgets/widgets-hint';
import { EmptyMonth, SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useAutoImport, type CaptureSurfaceState } from '@/hooks/use-auto-import';
import { runAfterFirstFrames } from '@/lib/after-first-frames';
import { prioritizeForegroundNavigation } from '@/lib/foreground-history-priority';
import { useLaunchSplashHidden } from '@/lib/launch-splash';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { ThemeScope, useTheme } from '@/hooks/use-theme';
import { useBand } from '@/hooks/use-band';
import { projectDashboard, projectDashboardInsight } from '@/lib/dashboard-projection';
import type { Insight } from '@/lib/insights';
import { measureRuntimeOperation } from '@/lib/runtime-performance';
import { openSmsPermissionSettings } from '@/lib/auto-import';
import { buildReferenceFxUpdates } from '@/lib/fx';
import { monthEndISO, monthKey, monthLabel, monthStartISO, shiftMonthKey } from '@/lib/format';
import { daysPhrase, leavingSoon, type Outgoing } from '@/lib/leaving-soon';
import { markLaunchPhase } from '@/lib/launch-performance';
import { ledgerCurrencyCode, marketCurrencyCode } from '@/lib/markets';
import { formatMinorUnits, formatMoneyText, ledgerMoneySpec } from '@/lib/ledger-money';
import { internalTransferIdsForState, isSpending, liveAccountIds, transferReconciliationForStateInSlices } from '@/lib/ledger';
import { hasRecordsBefore, liveCaptureTimes, pendingTransferSummary, summarizeHomeToday, type PendingTransferSummary } from '@/lib/home-today';
import { detectCapturePause } from '@/lib/capture-pause';
import { loadCapturePauseSnooze, saveCapturePauseSnooze } from '@/lib/capture-pause-state';
import { isLiveCapture } from '@/lib/transaction-source';
import { homeSummaryCopy, paymentAgendaCopy } from '@/lib/reference-copy';
import { invalidateWidgetSnapshotSync, requestWidgetSnapshotSync } from '@/lib/widget-sync';
import { allocationsOf } from '@/lib/splits';
import { isFixedCommitment } from '@/lib/categories';
import { moneyPictureProgress } from '@/lib/money-picture-progress';
import { normalizePreferredName } from '@/lib/onboarding';
import { syncPaymentReminders } from '@/lib/notifications';
import { reminderScheduleInputsChanged } from '@/lib/reminders';
import { inPeriod, periodLabel } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { isProActive } from '@/lib/purchases';
import { useStoreActions, useStoreSelector } from '@/lib/store';
import { fieldsEqual } from '@/lib/store-selection';
import { detectSubscriptionsCooperatively, peekSubscriptionDetection, type Subscription } from '@/lib/subscriptions';
import type { AppState as LedgerState, CardDue, Transaction } from '@/lib/types';
import { t, tf } from '@/lib/i18n';
import { homeWidgetVisible, loadHomeWidgetPreferences, peekHomeWidgetPreferences, splitHomeWidgetLayout, subscribeHomeWidgetPreferences, type HomeWidgetId, type HomeWidgetPreferences } from '@/lib/home-widgets';
import { repairGoalOrderedHomeOnce } from '@/lib/home-goal-order-repair';
import { defaultHomeWidgetPreferences, withNeededHomeSections } from '@/lib/home-widget-preferences';
import { hasRecapActivity, recapCandidates, type RecapDescriptor } from '@/lib/recap';
import { loadViewedRecaps } from '@/lib/recap-view-state';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { getTransferActivity, unaskedPendingIds } from '@/lib/transfer-activity';
import { transferWaitingSummary } from '@/lib/transfer-people';
import { isTransferCandidate } from '@/lib/transfer-reconciliation';
import { HomeHero, type HeroMonth } from '@/components/home/home-hero';
import { HomeRecent } from '@/components/home/home-recent';
import { NEEDS_YOU_CLEARANCE, NeedsYouPill } from '@/components/home/needs-you-pill';
import { homeCopy } from '@/lib/home-copy';
import { nextPaceMemory, paceState, projectHeroMonth, type PaceMemory } from '@/lib/home-hero';
import { loadPaceMemory, savePaceMemory } from '@/lib/home-pace-nudge';
import { dismissedNeeds, dismissNeed, earliestOverdueCard, needsYouInline, pickNeed, subscribeDismissedNeeds, type Need } from '@/lib/home-needs-you';
import { summarizeMonth } from '@/lib/insights';
import { spendingCategoryRows } from '@/lib/reference-presentation';
import { captured as nudgeHaptic } from '@/lib/haptics';

/** Home v3 lists this many of the period's latest rows. */
const HOME_RECENT_ROWS = 12;

/** Presentation-only vocabulary; every amount still comes from the shared ledger. */
const copy = {
  en: { journal: 'Your money, in view', month: 'THIS PERIOD', activity: 'Recent transactions',
    add: 'Add an entry', breakdown: 'View spending', upcoming: 'Coming up',
    import: 'Bank messages', paused: 'History import paused', resume: 'Resume',
    more: 'View all payments', accounts: 'Your accounts',
    income: 'Money in', spent: 'Spent', netNote: 'Income minus spending · not your bank balance',
    progress: 'Reading history', attention: 'Needs your attention',
    dueTotal: (count: number, total: string) => `${count} ${count === 1 ? 'payment' : 'payments'}, ${total}` },
  ar: { journal: 'أموالك بوضوح', month: 'هذه الفترة', activity: 'حركتك المالية',
    add: 'إضافة حركة', breakdown: 'عرض الإنفاق', upcoming: 'الدفعات القادمة',
    import: 'رسائل البنك', paused: 'استيراد السجل متوقف مؤقتاً', resume: 'متابعة',
    more: 'عرض كل الدفعات', accounts: 'حساباتك',
    income: 'الدخل', spent: 'الإنفاق', netNote: 'الدخل ناقص الإنفاق · ليس رصيد البنك',
    progress: 'قراءة السجل', attention: 'يحتاج إلى انتباهك',
    dueTotal: (count: number, total: string) => `${count === 1 ? 'دفعة واحدة' : count === 2 ? 'دفعتان' : `${count} دفعات`}، ${total}` },
} as const;

/**
 * The transfer notice's count, with how many transfers wait for an answer
 * (`questions`, transferWaitingSummary: the Transfers card's and the
 * Transactions summary's number).
 */
type HomeTransferQueue = PendingTransferSummary & { questions: number };

const sameHomeWidgets = (a: HomeWidgetPreferences, b: HomeWidgetPreferences): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

/** Every Recent transactions row painted for one period since Home mounted, by id (never the rows themselves). */
export interface ShownActivity {
  scope: string;
  ids: ReadonlySet<string>;
  /** The row that arrived last, kept so its arrival is not cut short by the next render. */
  arrived: string | null;
}

/** A capture's own clock may run a little behind the moment it reaches the phone. */
const ARRIVAL_GRACE_MS = 10 * 60_000;

/**
 * The row that has arrived at the top of Recent transactions: a live capture
 * (bank text, app alert or Apple Pay) whose clock is after Home mounted, that
 * no paint of the same period has shown. Never on first paint, while the
 * ledger loads (empty scope), across a period change, for a row typed or
 * imported, or for an older row a date edit, deletion or undone import brings
 * to the top. The last arrival stays the answer until another replaces it.
 */
export function arrivedActivityRow(shown: ShownActivity | null, scope: string, top: Transaction | undefined,
  mountedAtMs: number | null): string | null {
  if (shown === null || scope === '' || shown.scope !== scope) return null;
  if (top === undefined || mountedAtMs === null || shown.ids.has(top.id)) return shown.arrived;
  const fresh = isLiveCapture(top) && typeof top.ts === 'number' && top.ts >= mountedAtMs - ARRIVAL_GRACE_MS;
  return fresh ? top.id : shown.arrived;
}

/** The ids painted so far for this period, with this paint's rows added. */
export function rememberActivity(shown: ShownActivity | null, scope: string, rows: readonly Transaction[],
  arrived: string | null): ShownActivity | null {
  if (scope === '') return null;
  const ids = new Set(shown?.scope === scope ? shown.ids : []);
  for (const row of rows) ids.add(row.id);
  return { scope, ids, arrived };
}

/** The coin that drops onto an arriving row's logo tile. */
const ARRIVAL_COIN = 14;

/** The row slides in; the coin drops onto its tile, rests, then fades away (from 1 to 2). */
const ARRIVAL_ENTER: readonly CoinStep[] = [{ at: 0, from: 0, to: 1, curve: COIN_MOVE_CURVE }];
const ARRIVAL_COIN_STEPS: readonly CoinStep[] = [
  { at: COIN_STAGGER, from: 0, to: 1, curve: COIN_RISE_CURVE },
  // Where the old sequence's second spring started: after the first came to rest and a pause.
  { at: COIN_STAGGER + COIN_RISE_CURVE.restMs + COIN_STAGGER * 4, from: 1, to: 2, curve: COIN_MOVE_CURVE },
];

/**
 * Home is on screen: the launch splash has gone, App Lock is cleared and the
 * app is in the foreground. Home's coins hold their first reveal until then,
 * so the entrance is never spent behind the splash or the lock, and anything
 * that changes while it is false lands at once.
 */
export function useHomeRevealReady(): boolean {
  const cleared = usePrivacyGateCleared();
  const active = useAppActive();
  const splashHidden = useLaunchSplashHidden();
  return cleared && active && splashHidden;
}

/**
 * The one Recent transactions row that arrived while Home was open: it slides
 * in once and a coin drops onto its logo tile and fades. Every other row is
 * drawn plain. Reduce Motion or a screen reader shows it in place at once, and
 * so does a row that arrived while Home could not be seen (the app in the
 * background, a headless capture, App Lock): it counts as already shown. The
 * slide and the coin run on one native-driven clock. The row's own text and
 * spoken label never change.
 */
export function ArrivingRow({ children, hold = false }: { children: React.ReactNode; hold?: boolean }) {
  const motion = useMotionPreference();
  const active = useAppActive();
  const live = motion.ready && active && !hold;
  const clock = useCoinClock();
  // Once per mount: a later render never replays it.
  const done = useRef(false);
  // 0 above and clear, 1 in place; the coin then goes on to 2, faded out.
  const paths = useMemo((): { enter: CoinNode; coin: CoinNode; run: CoinRun | null; waiting: boolean } => {
    if (motion.reducedMotion || done.current || !active || hold) {
      return { enter: new Animated.Value(1), coin: new Animated.Value(2), run: null, waiting: false };
    }
    // Hold still until the screen-reader state is known (see use-reduced-motion).
    if (!motion.ready) return { enter: new Animated.Value(0), coin: new Animated.Value(0), run: null, waiting: true };
    const run = clock.reserve(Math.max(coinStepsEnd(ARRIVAL_ENTER), coinStepsEnd(ARRIVAL_COIN_STEPS)));
    return {
      enter: coinTrack(clock.value, run.base, 1, ARRIVAL_ENTER),
      coin: coinTrack(clock.value, run.base, 2, ARRIVAL_COIN_STEPS),
      run, waiting: false,
    };
    // `done` is read when the motion state changes, never as a trigger.
  }, [clock, motion.ready, motion.reducedMotion, active, hold]);
  useEffect(() => { if (!paths.waiting) done.current = true; }, [paths]);
  // Interrupted (the row leaves, Reduce Motion turns on, the app leaves the
  // foreground), it lands at its end.
  useCoinRun(clock, paths.run, live);
  const paint = useMemo(() => ({
    row: {
      opacity: paths.enter.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
      transform: [{ translateY: paths.enter.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
    },
    coin: {
      opacity: paths.coin.interpolate({ inputRange: [0, 0.4, 1, 2], outputRange: [0, 1, 1, 0], extrapolate: 'clamp' }),
      transform: [
        { translateY: paths.coin.interpolate({ inputRange: [0, 1, 2], outputRange: [-16, 0, 0], extrapolate: 'clamp' }) },
        { scale: paths.coin.interpolate({ inputRange: [0, 1, 2], outputRange: [0.8, 1, 0.7], extrapolate: 'clamp' }) },
      ],
    },
  }), [paths]);
  return <Animated.View testID="home-activity-arrival" style={paint.row}>
    {children}
    <Animated.View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden
      style={[styles.arrivalCoin, paint.coin]}>
      <CoinToken size={ARRIVAL_COIN} />
    </Animated.View>
  </Animated.View>;
}

/** Home's entrance (coins dropping in, the day columns rising) runs this long; deferred JS work waits it out. */
const HOME_REVEAL_QUIET_MS = 1_500;

// A native reminder call cannot be cancelled when Home unmounts. New Home
// instances join this manual-refresh lane before starting another one.
let manualReminderTail: Promise<void> = Promise.resolve();

/**
 * A new composition, not a palette swap: open net-position spread, paired money
 * facts, date-grouped activity, then obligations and low-noise capture status.
 * No entrance timers/scale reveals delay access to the actual ledger.
 */
/**
 * Every AppState field Home reads, directly or through the helpers it hands
 * `state` to (dashboard projection and insight, leaving-soon, accuracy,
 * uncategorised, cash-flow, cards, transfer scope, recap, purchases). Home
 * re-renders only when one of these changes; scan timestamps, the review
 * tray, capture warnings and settings it never shows no longer re-render it.
 * Import progress is listed: Home draws it. Add a field here whenever Home or
 * one of those helpers starts reading it.
 */
export const HOME_STATE_FIELDS = [
  'hydrated', 'onboarded', 'language', 'userName', 'privateMode', 'captureOptOut',
  'pro', 'founderPro', 'trialStartTs', 'marketId', 'ledgerMoney',
  'transactions', 'accounts', 'budgets', 'bills', 'cardDues', 'notSubscriptions', 'cancelledSubscriptions',
  'merchantOverrides', 'billAliases', 'transferInternalIds', 'transferNormalizationVersion',
  'historyImport', 'customCategories',
] as const satisfies readonly (keyof LedgerState)[];
const homeStateEqual = fieldsEqual<LedgerState>(HOME_STATE_FIELDS);

/** The same recap entry again keeps its object, so returning Home does not re-render it. */
function keepRecapEntry<T extends { descriptor: RecapDescriptor; unread: boolean }>(
  current: T | null, descriptor: RecapDescriptor, unread: boolean,
): T | { descriptor: RecapDescriptor; unread: boolean } {
  return current?.descriptor.id === descriptor.id && current.unread === unread ? current : { descriptor, unread };
}

/**
 * One month for the Spent hero: its summarizeMonth (Spent, In, categories,
 * the same projection the dashboard and Spending use) and its day-by-day line
 * and like-for-like trend (home-hero.ts). Named "October", with the year only
 * when it is not this year's.
 */
function heroMonthFor(transactions: Transaction[], key: string, dayISO: string, live: Set<string>, internal: Set<string>,
  withSeries = true): HeroMonth {
  const today = new Date(`${dayISO}T12:00:00`);
  const year = monthKey(today).slice(0, 4);
  const name = (monthKeyed: string) => monthKeyed.slice(0, 4) === year
    ? monthLabel(monthKeyed).replace(/\s*\d{4}$/, '') : monthLabel(monthKeyed);
  return {
    key, name: name(key), comparedName: name(shiftMonthKey(key, -1)),
    summary: summarizeMonth(transactions, { mode: 'month', key }, live, internal),
    // Off in Customize Home: no line or trend to draw, so no second pass over the ledger.
    series: withSeries ? projectHeroMonth(transactions, key, today, live, internal)
      : { key, monthDays: 0, cumulative: [], trend: null },
  };
}

export default function JournalHomeScreen() {
  const theme = useTheme();
  // Design language E: Home wears the ink band in both schemes.
  const band = useBand('home');
  const language = useLanguage();
  const words = copy[language === 'ar' ? 'ar' : 'en'];
  const transferWords = transferActivityCopy(language);
  const largeText = useLargeTextLayout();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const privacyGateCleared = usePrivacyGateCleared();
  // Splash gone, lock cleared, app in the foreground: Home's coins may move.
  const revealReady = useHomeRevealReady();
  const router = useRouter();
  const toast = useToast();
  const state = useStoreSelector(({ state: s }) => s, homeStateEqual);
  const {
    getStateSnapshot,
    getStateGeneration,
    applyFxUpdates,
    setCaptureOptOut,
    beginHistoryImport,
    unlockFounderPro,
  } = useStoreActions();
  const { period } = usePeriod();
  // Restores can change denomination while all three figures stay identical.
  // Make it a prop so compiled children cannot retain ambient currency text.
  const moneySpec = state.ledgerMoney ?? ledgerMoneySpec(marketCurrencyCode(state.marketId))!;
  /** Money for a screen reader: the ISO code, exact, and signed when asked. */
  const spokenMoney = (fils: number, signed = false) =>
    `${signed && fils !== 0 ? (fils < 0 ? '−' : '+') : ''}${moneySpec.currency} ${formatMinorUnits(Math.abs(Math.round(fils)), moneySpec, { decimals: true })}`;
  // The tab shell still owns capture. This screen only observes or explicitly joins it.
  const { runAutoImport, needsPermission, captureState } = useAutoImport(false, true);
  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [entry, setEntry] = useState<Transaction | null>(null);
  const [cardDue, setCardDue] = useState<CardDue | null>(null);
  const [recurring, setRecurring] = useState<Subscription | null>(null);
  // The saved layout is usually in memory already (the root reads it beside
  // hydration), so a customised Home lays out once, in its own order.
  const [homeWidgets, setHomeWidgets] = useState<HomeWidgetPreferences>(() =>
    peekHomeWidgetPreferences() ?? defaultHomeWidgetPreferences());
  const [homeAnalysisReady, setHomeAnalysisReady] = useState(false);
  const [homeInsight, setHomeInsight] = useState<(Insight & { scope: string }) | null>(null);
  const [recapEntry, setRecapEntry] = useState<{ descriptor: RecapDescriptor; unread: boolean } | null>(null);
  // The transfer review queue, computed after interactions (it needs the
  // full reconciliation graph). Null until known.
  const [pendingTransfers, setPendingTransfers] = useState<HomeTransferQueue | null>(null);
  // "I was away" on the capture-stopped notice (epoch ms), or null.
  const [captureSnoozedAt, setCaptureSnoozedAt] = useState<number | null>(null);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const summaryWords = homeSummaryCopy[language === 'ar' ? 'ar' : 'en'];
  const homeWords = homeCopy(language);
  // Needs-you pills dismissed this session (home-needs-you.ts).
  const [dismissedNeedKeys, setDismissedNeedKeys] = useState(dismissedNeeds);
  useEffect(() => subscribeDismissedNeeds(() => setDismissedNeedKeys(dismissedNeeds())), []);
  const paymentWords = paymentAgendaCopy[language === 'ar' ? 'ar' : 'en'];
  // The clock is refreshed on every foreground resume for greeting/review
  // freshness, but Home's money projections are day-based. Keep the derived
  // day key above every effect that depends on it so recap discovery and the
  // dashboard share the same stable invalidation boundary.
  const projectionDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const lastFxAttempt = useRef('');
  const refreshInFlight = useRef<number | null>(null);
  const reminderSync = useRef<{
    alive: boolean;
    epoch: number;
    running: boolean;
    pending: {
      readState: typeof getStateSnapshot;
      getGeneration: typeof getStateGeneration;
      generation: number;
      epoch: number;
    } | null;
  }>({ alive: false, epoch: 0, running: false, pending: null });

  useEffect(() => {
    const sync = reminderSync.current;
    sync.alive = true;
    sync.epoch += 1;
    setRefreshing(false);
    return () => {
      sync.alive = false;
      sync.epoch += 1;
      sync.pending = null;
      refreshInFlight.current = null;
    };
  }, []);
  // Focus-driven work uses useFocusEffect, not useIsFocused: subscribing to
  // focus re-rendered all of Home on every switch to it (and away from it)
  // only to start or cancel the jobs below. Each focus effect runs on focus,
  // again when its inputs change while focused, and cleans up on blur.
  useFocusEffect(useCallback(() => {
    let alive = true;
    // Every return to this tab reloads the preference. Only publish a new
    // object when something actually changed, so the tab switch itself does
    // not re-render Home a second time.
    const apply = (preferences: HomeWidgetPreferences) => {
      if (alive) startTransition(() => setHomeWidgets(current => sameHomeWidgets(current, preferences) ? current : preferences));
    };
    const unsubscribe = subscribeHomeWidgetPreferences(apply);
    void loadHomeWidgetPreferences().then(apply);
    return () => { alive = false; unsubscribe(); };
  }, []));

  useFocusEffect(useCallback(() => {
    let alive = true;
    void loadCapturePauseSnooze().then((snoozedAt) => {
      if (alive) startTransition(() => setCaptureSnoozedAt((current) => current === snoozedAt ? current : snoozedAt));
    });
    return () => { alive = false; };
  }, []));

  useFocusEffect(useCallback(() => {
    if (!privacyGateCleared || !state.hydrated || !state.onboarded) return;
    // Mark Home usable from the first committed ledger frame. Category/parser
    // cleanup is intentionally NOT scheduled from Home: both dedicated tools
    // remain available in Settings, and a large ledger must not pay multiple
    // full-history scans a moment after the first frame just to render a prompt.
    markLaunchPhase('first-usable-home');
  }, [privacyGateCleared, state.hydrated, state.onboarded]));
  // Home's entrance runs on the UI thread, but the JS thread still has to
  // answer it: hold the foreground lease while the ledger first appears and
  // again as Home becomes visible (the splash or lock gone, a resume), so
  // deferred projections, history pages and maintenance yield until it ends.
  const homeShowsLedger = state.hydrated && state.onboarded;
  useEffect(() => {
    if (homeShowsLedger) prioritizeForegroundNavigation(HOME_REVEAL_QUIET_MS);
  }, [homeShowsLedger, revealReady]);
  // Homes saved by the earlier Goals step opened with the goal sections and
  // lost their band; put the band back once (home-goal-order-repair.ts). A
  // repaired layout reaches this screen through the preference subscription.
  const choseGoals = (state.wafraGoals?.length ?? 0) > 0;
  useEffect(() => {
    if (!state.hydrated || !state.onboarded || !choseGoals) return;
    void repairGoalOrderedHomeOnce();
  }, [state.hydrated, state.onboarded, choseGoals]);
  useFocusEffect(useCallback(() => {
    if (!privacyGateCleared || !state.hydrated || !state.onboarded || homeAnalysisReady) return;
    // The insight is lower priority again. Its Home variant deliberately skips
    // subscription detection; Bills owns that full historical analysis.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const task = runAfterFirstFrames(() => {
      timer = setTimeout(() => setHomeAnalysisReady(true), 1_800);
    });
    return () => {
      task.cancel();
      if (timer !== null) clearTimeout(timer);
    };
  }, [homeAnalysisReady, privacyGateCleared, state.hydrated, state.onboarded]));
  useFocusEffect(useCallback(() => {
    if (!privacyGateCleared || !state.hydrated || !state.onboarded) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Recap is celebratory, never launch-critical. Wait until Home and its
    // existing insight lane are settled, then do only the cheap period presence
    // check. The full ledger projection runs after the user taps the W.
    const task = runAfterFirstFrames(() => {
      timer = setTimeout(() => {
        const candidates = recapCandidates(now).filter((descriptor) =>
          hasRecapActivity(state.transactions, descriptor));
        if (candidates.length === 0) {
          if (alive) setRecapEntry(null);
          return;
        }
        void loadViewedRecaps().then((viewed) => {
          const descriptor = candidates.find((candidate) => !viewed.has(candidate.id)) ?? candidates[0]!;
          if (alive) startTransition(() => setRecapEntry((current) => keepRecapEntry(current, descriptor, !viewed.has(descriptor.id))));
        });
      }, 2_600);
    });
    return () => {
      alive = false;
      task.cancel();
      if (timer !== null) clearTimeout(timer);
    };
    // A new day can cross a salary-month boundary and produce a new recap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privacyGateCleared, state.hydrated, state.onboarded, state.transactions, projectionDay]));
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(new Date());
    });
    return () => listener.remove();
  }, []);

  // Depending on the Date object itself made every reopen synchronously
  // re-walk a large ledger twice before Android could feel responsive, even
  // when no money changed. A review expiring still invalidates the Home
  // projection explicitly below.
  const dashboard = useMemo(() => projectDashboard({
    state,
    period,
    now,
    surface: 'home',
    includeInsights: false,
    // Cleanup counts are useful only when the user chooses the cleanup tool.
    // Keeping them off Home makes the normal navigation path O(current period)
    // rather than O(full ledger) on a 10k+ row history.
    includeCleanupPrompts: false,
    activityLimit: HOME_RECENT_ROWS,
  }),
    // Progress counters do not change totals. Transfer receipts can change
    // financial scope even when finalization preserves the ledger arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.hydrated, state.transactions, state.accounts, state.budgets, state.bills,
      state.cardDues, state.notSubscriptions, state.merchantOverrides, state.language,
      state.ledgerMoney, state.transferInternalIds, state.transferNormalizationVersion,
      state.historyImport?.status, state.marketId, state.customCategories, period, projectionDay]);
  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  // Coming up also lists detected subscriptions, as Bills does. Home reads
  // the shared answer when one is cached, and otherwise starts or joins the
  // one shared cooperative scan after its first frames; the scan's slices
  // wait out Home's entrance lease. Until it lands Home shows bills and card
  // dues alone.
  const [homeRecurring, setHomeRecurring] = useState<{
    value: Subscription[]; transactions: Transaction[]; notSubscriptions: string[]; day: string;
    liveAccounts: Set<string>; internal: Set<string>;
  } | null>(null);
  // The answer belongs to exactly one ledger, scope and day (the shared
  // cache's own key). Archiving a card or a finished history import can
  // change the scope while the transactions array stays the same.
  const homeInternal = useMemo(() => internalTransferIdsForState(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.transactions, state.accounts, state.transferInternalIds, state.transferNormalizationVersion, state.historyImport?.status]);
  const recurringCurrent = homeRecurring !== null && homeRecurring.transactions === state.transactions
    && homeRecurring.notSubscriptions === state.notSubscriptions && homeRecurring.day === projectionDay
    && homeRecurring.liveAccounts === liveAccounts && homeRecurring.internal === homeInternal;
  useEffect(() => {
    // A stale answer is dropped at once: it must not hold an old ledger while
    // Home is hidden, nor show another scope's renewals.
    if (homeRecurring !== null && !recurringCurrent) setHomeRecurring(null);
  }, [homeRecurring, recurringCurrent]);
  useFocusEffect(useCallback(() => {
    if (!state.hydrated || !state.onboarded || state.privateMode || recurringCurrent) return;
    const { transactions, notSubscriptions } = state;
    let cancelled = false;
    const today = new Date(`${projectionDay}T12:00:00`);
    const internal = homeInternal;
    const accept = (value: Subscription[] | null) => {
      if (cancelled || value === null) return;
      startTransition(() => setHomeRecurring({ value, transactions, notSubscriptions, day: projectionDay, liveAccounts, internal }));
    };
    // A finished answer (Bills, a reminder or widget sync, the last visit) is
    // a cache lookup: paint it with Home's first commit, so Due payments and
    // Coming up are in place with the rest of Home instead of arriving later
    // and pushing the sections below them down.
    const cached = peekSubscriptionDetection(transactions, notSubscriptions, today, liveAccounts, internal);
    if (cached) { accept(cached); return () => { cancelled = true; }; }
    // Otherwise start (or join) the shared scan once Home's first two frames
    // are drawn, without the settle or the entrance lease: the scan yields between
    // 6ms slices and each yield waits for the lease itself
    // (detectSubscriptionsCooperatively), so at most one slice runs during
    // the entrance and a large ledger still finishes after it, as before. A
    // small ledger is done in that slice, so its rows arrive with Home rather
    // than ~3s later. The widget and reminder syncs join the same scan.
    const task = runAfterFirstFrames(() => {
      if (cancelled) return;
      void detectSubscriptionsCooperatively(transactions, notSubscriptions, today, liveAccounts, internal, () => cancelled)
        .then(accept);
    }, { idle: false, delayMs: 0 });
    return () => { cancelled = true; task.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.hydrated, state.onboarded, state.privateMode, recurringCurrent, state.transactions,
    state.notSubscriptions, liveAccounts, homeInternal, projectionDay]));
  const payments = useMemo(() => {
    if (!homeRecurring || !recurringCurrent) return dashboard.upcoming.items;
    // A renewal that has not shown up yet is an estimate running late, not a
    // bill past due: Bills files it under Expected earlier, so Home leaves it
    // out of Due soon rather than calling it days late.
    const subscriptions = leavingSoon(state as LedgerState, now, {
      withinDays: dashboard.upcoming.withinDays, kinds: ['subscription'], detectedSubscriptions: homeRecurring.value,
    }).filter((item) => item.daysLeft >= 0);
    if (subscriptions.length === 0) return dashboard.upcoming.items;
    // The same order leavingSoon gives one combined list.
    return [...dashboard.upcoming.items, ...subscriptions]
      .sort((a, b) => a.daysLeft - b.daysLeft || b.amountFils - a.amountFils);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboard.upcoming, homeRecurring, recurringCurrent, state.bills, state.notSubscriptions,
    state.cancelledSubscriptions, state.customCategories]);
  // Today and this week use the same spending definition and transfer scope as
  // the period totals below them. Budget pace applies only to the live month.
  // Only drawn by the Today and Last 7 days sections, both off by default.
  const todayShown = homeWidgetVisible(homeWidgets, 'today') || homeWidgetVisible(homeWidgets, 'week');
  const homeToday = useMemo(() => {
    if (!todayShown) return undefined;
    const live = liveAccounts as Set<string>;
    const internal = dashboard.internalTransactionIds as Set<string>;
    const budgetMonth = period.mode === 'month' && period.key === monthKey(now) ? period.key : null;
    return summarizeHomeToday({
      transactions: state.transactions,
      budgets: state.budgets,
      now,
      isSpending: (transaction) => isSpending(transaction, live, internal),
      inBudgetPeriod: (dateISO) => budgetMonth !== null && inPeriod(dateISO, period),
      budgetPeriodStartISO: budgetMonth ? monthStartISO(budgetMonth) : null,
      budgetPeriodEndISO: budgetMonth ? monthEndISO(budgetMonth) : null,
      allocations: allocationsOf,
      isFixedCommitment,
      averageWindow: period.mode === 'month' ? { startISO: monthStartISO(period.key), endISO: monthEndISO(period.key) }
        : period.mode === 'range' ? { startISO: period.from, endISO: period.to } : null,
    });
    // Day-keyed like the dashboard: a foreground resume must not re-walk the ledger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayShown, state.transactions, state.budgets, liveAccounts, dashboard.internalTransactionIds, period, projectionDay]);
  // Home v3's hero: the period's month (the running month unless another month
  // is chosen), its trend against the same days of the month before, and last
  // month only once the person turns the card to it. Day-keyed like the
  // dashboard, so a resume does not re-walk the ledger.
  const heroKey = period.mode === 'month' ? period.key : monthKey(now);
  const runningMonth = monthKey(now);
  const heroInternal = dashboard.internalTransactionIds as Set<string>;
  // Switched off, the hero keeps only the month summary (limits over); its line,
  // trend and pace are not worked out.
  const heroShown = homeWidgetVisible(homeWidgets, 'hero');
  const heroCurrent = useMemo(() => heroMonthFor(state.transactions, heroKey, projectionDay, liveAccounts as Set<string>, heroInternal, heroShown),
    // monthLabel follows the app language.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.transactions, heroKey, projectionDay, liveAccounts, heroInternal, language, heroShown]);
  const [heroPreviousWanted, setHeroPreviousWanted] = useState<string | null>(null);
  const heroPrevious = useMemo(() => heroPreviousWanted === heroKey
    ? heroMonthFor(state.transactions, shiftMonthKey(heroKey, -1), projectionDay, liveAccounts as Set<string>, heroInternal) : null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [heroPreviousWanted, state.transactions, heroKey, projectionDay, liveAccounts, heroInternal, language]);
  const wantHeroPrevious = useCallback(() => setHeroPreviousWanted(heroKey), [heroKey]);
  // Limits over this running month, as Spending's limited view counts them.
  const limitsOver = useMemo(() => {
    if (!state.budgets.some((budget) => budget.limitFils > 0)) return 0;
    const summary = runningMonth === heroKey ? heroCurrent.summary
      : summarizeMonth(state.transactions, { mode: 'month', key: runningMonth }, liveAccounts as Set<string>, heroInternal);
    return spendingCategoryRows(summary, state.budgets, true)
      .filter((row) => row.limitFils !== null && row.spentFils > row.limitFils).length;
  }, [state.budgets, state.transactions, runningMonth, heroKey, heroCurrent, liveAccounts, heroInternal]);
  // Over last month's pace (the running month only): the chip's warning
  // colour, and a short haptic when Home sees the crossing, once a day.
  const livePace = heroKey === runningMonth ? paceState(heroCurrent.series.trend) : null;
  const paceMemory = useRef<PaceMemory | null | undefined>(undefined);
  useEffect(() => {
    if (!state.hydrated || !state.onboarded || livePace === null || !revealReady) return;
    let alive = true;
    const observe = (memory: PaceMemory | null) => {
      const { memory: next, nudge } = nextPaceMemory(memory, heroKey, livePace, projectionDay);
      paceMemory.current = next;
      if (next && next !== memory) void savePaceMemory(next);
      if (nudge) nudgeHaptic();
    };
    if (paceMemory.current !== undefined) observe(paceMemory.current);
    else void loadPaceMemory().then((memory) => { if (alive) observe(memory); });
    return () => { alive = false; };
  }, [state.hydrated, state.onboarded, livePace, heroKey, projectionDay, revealReady]);
  // Native widgets use Bills' complete 30-day recurring projection, never
  // Home's deliberately shorter 9-day list (which adds detected subscriptions
  // only once that shared projection has an answer).
  useEffect(() => {
    if (!state.hydrated || !state.onboarded || state.privateMode) {
      void invalidateWidgetSnapshotSync();
      return;
    }
    const generation = getStateGeneration();
    const source = getStateSnapshot();
    let request: ReturnType<typeof requestWidgetSnapshotSync> | undefined;
    let cancelled = false;
    const current = () => {
      const latest = getStateSnapshot();
      return !cancelled && generation === getStateGeneration() && latest.hydrated && latest.onboarded && !latest.privateMode
        && latest.transactions === source.transactions && latest.accounts === source.accounts
        && latest.budgets === source.budgets && latest.bills === source.bills && latest.cardDues === source.cardDues
        && latest.notSubscriptions === source.notSubscriptions && latest.cancelledSubscriptions === source.cancelledSubscriptions
        && latest.transferInternalIds === source.transferInternalIds && latest.transferNormalizationVersion === source.transferNormalizationVersion
        && latest.ledgerMoney === source.ledgerMoney && latest.marketId === source.marketId && latest.language === source.language
        && latest.historyImport === source.historyImport
        // The spending widget names categories, custom ones included (widget-ledger.ts).
        && latest.customCategories === source.customCategories;
    };
    // After Home's first frames and entrance: preparing the snapshot walks the
    // ledger and the native write re-renders every placed widget.
    const task = runAfterFirstFrames(() => {
      if (current()) request = requestWidgetSnapshotSync({ state: source, now: new Date(), moneySpec,
        language: language === 'ar' ? 'ar' : 'en' }, current);
    });
    return () => { cancelled = true; task.cancel(); request?.cancel(); };
    // Keyed on the day, not the resume clock: every reopen used to rebuild
    // the snapshot and rewrite the widgets with the same figures. A new day
    // still refreshes them (todayISO, the week, Coming up all move).
  }, [state.hydrated, state.onboarded, state.privateMode, state.transactions, state.accounts, state.budgets, state.bills,
    state.cardDues, state.notSubscriptions, state.cancelledSubscriptions, state.transferInternalIds, state.transferNormalizationVersion,
    state.ledgerMoney, state.marketId, state.historyImport, state.customCategories, moneySpec, language, projectionDay,
    getStateGeneration, getStateSnapshot]);
  // Recent activity, and which transfers it leaves to the Transfers screen,
  // come from the one dashboard projection rather than a second ledger walk.
  const hasPeriodTransfers = dashboard.hasPeriodTransfers === true;
  // "Empty month" means no live record at all, not merely no recent cash-flow
  // row: card-payment settlements and internal movements are records too.
  const hasPeriodRecords = dashboard.hasPeriodRecords === true || hasPeriodTransfers;
  // A live capture that lands while Home is open slides in at the top of
  // Recent transactions: checked against every row painted for the same
  // period since mount. Ids only, so no old ledger is held; nothing arrives on
  // first paint, while the ledger loads, or when the period changes.
  const activityScope = state.hydrated ? JSON.stringify(period) : '';
  const shownActivity = useRef<ShownActivity | null>(null);
  const mountedAt = useRef<number | null>(null);
  useEffect(() => { mountedAt.current = Date.now(); }, []);
  const arrivedRowId = arrivedActivityRow(shownActivity.current, activityScope, dashboard.activityRows[0], mountedAt.current);
  useEffect(() => {
    shownActivity.current = rememberActivity(shownActivity.current, activityScope, dashboard.activityRows, arrivedRowId);
  }, [activityScope, dashboard.activityRows, arrivedRowId]);
  const insightWidgetVisible = homeWidgetVisible(homeWidgets, 'insight');
  const historyAnalysisBlocked = state.historyImport !== null && state.historyImport.status !== 'complete';
  const completedInsightInputs = useRef<readonly unknown[] | null>(null);
  // Focus resumes unfinished work, but a simple tab round trip must not
  // repeat a completed full-history projection for identical inputs.
  const insightInputs = [state.transactions, state.accounts, state.budgets, state.notSubscriptions,
    state.transferInternalIds, state.transferNormalizationVersion, state.historyImport?.status,
    state.marketId, state.ledgerMoney, state.customCategories, language, period, projectionDay];
  const insightInputsCompleted = () =>
    completedInsightInputs.current?.every((value, index) => Object.is(value, insightInputs[index])) === true;
  const insightDisabled = !homeAnalysisReady || !insightWidgetVisible || historyAnalysisBlocked;
  // Runs whether or not Home is focused: a disabled insight clears at once,
  // and obsolete ledger references are released even while this tab is hidden.
  useEffect(() => {
    if (insightDisabled) {
      completedInsightInputs.current = null;
      setHomeInsight(null);
      return;
    }
    if (!insightInputsCompleted()) completedInsightInputs.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightDisabled, state.transactions, state.accounts, state.budgets, state.notSubscriptions,
    state.transferInternalIds, state.transferNormalizationVersion, state.historyImport?.status,
    state.marketId, state.ledgerMoney, state.customCategories, language, period, projectionDay]);
  // Queued work is cancelled on blur; new inputs are analysed only on Home.
  useFocusEffect(useCallback(() => {
    if (insightDisabled || insightInputsCompleted()) return;
    const inputs = insightInputs;
    let cancelled = false;
    // Keep the previous card only inside its original period/language while
    // recomputing. Analysis must not hitch the turn that just painted an SMS.
    const task = runAfterFirstFrames(() => {
      if (cancelled) return;
      const next = measureRuntimeOperation('home-insight', () =>
        projectDashboardInsight(state, period, now));
      if (!cancelled) {
        completedInsightInputs.current = inputs;
        startTransition(() => setHomeInsight(next ? { ...next, scope: `${language}:${JSON.stringify(period)}` } : null));
      }
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
    // Capture/progress state must not restart historical analysis. The optional
    // insight is computed only after Home is already interactive and only while
    // the user has that widget enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightDisabled, state.transactions, state.accounts, state.budgets, state.notSubscriptions,
    state.transferInternalIds, state.transferNormalizationVersion, state.historyImport?.status,
    state.marketId, state.ledgerMoney, state.customCategories, language, period, projectionDay]));
  // Home names the transfers waiting only once they are known: the same count
  // the Transfers card gives (transferWaitingSummary), so Home's "N transfers
  // need an answer" and the card's agree. The graph is built after interactions,
  // never during hydration or a running history import, and not at all when no
  // row could be a transfer.
  useEffect(() => {
    if (historyAnalysisBlocked) setPendingTransfers(null);
  }, [historyAnalysisBlocked]);
  // The last queue computed, with the inputs it came from: unlocking, a tab
  // round trip or an import finishing does not walk the transfer graph again
  // for the same ledger. Inputs are held by reference only while they are
  // the store's current ones (a new ledger replaces them).
  const transferQueueCache = useRef<{ inputs: readonly unknown[]; value: HomeTransferQueue } | null>(null);
  const transferInputs = [state.transactions, state.accounts, state.transferInternalIds, state.transferNormalizationVersion] as const;
  const transferInputsCached = () =>
    transferQueueCache.current?.inputs.every((value, index) => Object.is(value, transferInputs[index])) === true;
  // Runs focused or not, so a hidden Home never keeps an old ledger alive.
  useEffect(() => {
    if (!transferInputsCached()) transferQueueCache.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.transactions, state.accounts, state.transferInternalIds, state.transferNormalizationVersion]);
  useFocusEffect(useCallback(() => {
    if (historyAnalysisBlocked || !privacyGateCleared || !state.hydrated || !state.onboarded) return;
    let cancelled = false;
    const inputs = transferInputs;
    const cached = transferQueueCache.current;
    if (cached && transferInputsCached()) {
      setPendingTransfers(cached.value);
      return;
    }
    const publish = (next: HomeTransferQueue) => {
      if (cancelled) return;
      transferQueueCache.current = { inputs, value: next };
      // An unchanged queue keeps its object, so returning Home does not
      // re-render it once the graph is rebuilt.
      startTransition(() => setPendingTransfers((current) => current !== null && current.count === next.count
        && current.incomingFils === next.incomingFils && current.outgoingFils === next.outgoingFils
        && current.questions === next.questions ? current : next));
    };
    let activityTask: ReturnType<typeof runAfterFirstFrames> | null = null;
    let graph: ReturnType<typeof transferReconciliationForStateInSlices> | null = null;
    const task = runAfterFirstFrames(() => {
      if (cancelled) return;
      if (!state.transactions.some(isTransferCandidate)) {
        publish({ count: 0, incomingFils: 0, outgoingFils: 0, questions: 0 });
        return;
      }
      // The reconciliation cached per stored transfer receipt, shared with
      // Transactions and Transfers, rather than a second full graph build.
      // Built in short slices: on a 15k-row phone the whole graph in one go
      // was the one long task after a cold launch. A ledger change cancels
      // this effect and with it the build.
      graph = transferReconciliationForStateInSlices(state, (reconciliation) => {
        if (cancelled) return;
        if (!reconciliation) {
          publish({ count: 0, incomingFils: 0, outgoingFils: 0, questions: 0 });
          return;
        }
        // The activity walk is a second pass over the whole ledger; two frames
        // between it and the graph let input and drawing through.
        activityTask = runAfterFirstFrames(() => {
          if (cancelled) return;
          const activity = getTransferActivity(state.transactions, state.accounts, reconciliation);
          // Every transfer kept out of the totals until the person answers, a pair once: the
          // number the Transfers card and the Transactions summary give.
          const waiting = transferWaitingSummary(activity).transfers;
          // With nothing waiting but entries still queued (duplicate observations,
          // archived accounts, likely card repayments), Home names those; Transfers
          // lists them as groups to answer.
          const ids = waiting > 0 ? new Set(activity.filter(item => !item.confirmed).map(item => item.transaction.id))
            : unaskedPendingIds(activity, reconciliation.pendingIds);
          const summary = pendingTransferSummary(state.transactions, ids);
          publish({ ...summary, count: waiting > 0 ? waiting : summary.count, questions: waiting });
        }, { idle: false, delayMs: 0 });
      });
    });
    return () => {
      cancelled = true;
      task.cancel();
      graph?.cancel();
      activityTask?.cancel();
    };
    // Transfer receipts change the reconciliation even when the arrays do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [privacyGateCleared, state.hydrated, state.onboarded, historyAnalysisBlocked, state.transactions, state.accounts,
    state.transferInternalIds, state.transferNormalizationVersion]));
  const history = state.historyImport?.status !== 'complete' ? state.historyImport : null;
  const status: CaptureSurfaceState = state.captureOptOut || needsPermission ? 'off'
    : Platform.OS === 'android' && !isProActive(state) ? 'paused' : captureState;
  const moneyPicture = moneyPictureProgress({
    nowMs: now.getTime(),
    trialStartTs: state.trialStartTs,
    history: state.historyImport,
    transactionCount: state.transactions.length,
    activeAccountCount: state.accounts.reduce((count, account) => count + (account.archived ? 0 : 1), 0),
    obligationCount: state.bills.length + state.cardDues.length,
    captureReady: status === 'waiting-for-alert' || status === 'first-alert-captured' ||
      (Platform.OS === 'android' && !state.captureOptOut && !needsPermission),
  });

  useEffect(() => {
    if (!state.hydrated || state.privateMode) return;
    const pending: typeof state.transactions = [];
    for (const transaction of state.transactions) {
      if (transaction.fxSource !== 'fallback') continue;
      pending.push(transaction);
      if (pending.length === 16) break;
    }
    if (pending.length === 0) return;
    const signature = pending.map((transaction) => `${transaction.id}:${transaction.originalCurrency}:${transaction.date}`).join('|');
    if (signature === lastFxAttempt.current) return;
    lastFxAttempt.current = signature;
    void buildReferenceFxUpdates(pending, ledgerCurrencyCode())
      .then((updates) => { if (updates.length > 0) applyFxUpdates(updates); })
      .catch(() => { lastFxAttempt.current = ''; });
  }, [state.hydrated, state.privateMode, state.transactions, applyFxUpdates]);

  const requestReminderSync = useCallback(() => {
    const sync = reminderSync.current;
    if (!sync.alive) return;
    // A later completed scan queues one newer snapshot without overlapping
    // native cancel/schedule operations from the previous manual refresh.
    sync.pending = {
      readState: getStateSnapshot,
      getGeneration: getStateGeneration,
      generation: getStateGeneration(),
      epoch: sync.epoch,
    };
    if (sync.running) return;
    sync.running = true;
    manualReminderTail = manualReminderTail.then(async () => {
      try {
        while (sync.pending) {
          const request = sync.pending;
          sync.pending = null;
          try {
            if (!sync.alive || request.epoch !== sync.epoch ||
              request.generation !== request.getGeneration()) continue;
            await syncPaymentReminders(request.readState());
          } catch {
            // Reminders are best-effort; their failure is not an SMS failure.
          }
        }
      } finally { sync.running = false; }
    });
  }, [getStateGeneration, getStateSnapshot]);

  const onRefresh = useCallback(async () => {
    const sync = reminderSync.current;
    if (!sync.alive || refreshInFlight.current !== null) return;
    const epoch = sync.epoch;
    const generation = getStateGeneration();
    const isCurrent = () => sync.alive && sync.epoch === epoch &&
      getStateGeneration() === generation;
    refreshInFlight.current = epoch;
    setRefreshing(true);
    const before = getStateSnapshot();
    try {
      await runAutoImport(true);
      if (!isCurrent()) return;
      setNow(new Date());
    } catch {
      if (isCurrent()) toast.show(t('captureRefreshFailed'), { tone: 'error' });
      return;
    } finally {
      if (refreshInFlight.current === epoch) {
        refreshInFlight.current = null;
        if (sync.alive && sync.epoch === epoch) setRefreshing(false);
      }
    }
    if (reminderScheduleInputsChanged(before, getStateSnapshot())) requestReminderSync();
  }, [getStateGeneration, getStateSnapshot, requestReminderSync, runAutoImport, toast]);

  const openCapture = () => {
    if (status === 'paused') { router.push('/pro'); return; }
    if (state.captureOptOut) {
      void setCaptureOptOut(false).then(() => {
        if (Platform.OS === 'ios') router.push('/ios-setup');
      }).catch(() => Alert.alert(t('capturePreferenceFailed')));
    } else if (Platform.OS === 'ios' && (status === 'off' || status === 'needs-automation')) {
      router.push('/ios-setup');
    } else if (status === 'queue-warning') router.push('/settings?section=imports');
    else void onRefresh();
  };
  const retryHistory = () => {
    const action = history?.error === 'inbox-access'
      ? openSmsPermissionSettings().then(() => beginHistoryImport())
      : beginHistoryImport();
    void action.catch(() => toast.show(t('captureRefreshFailed'), { tone: 'error' }));
  };
  const openPayment = (item: Outgoing) => {
    if (item.kind === 'card' && item.dueId) setCardDue(state.cardDues.find((due) => due.id === item.dueId) ?? null);
    else if (item.subscription) setRecurring(item.subscription);
    else router.push('/bills');
  };
  const captureLabel = status === 'paused' ? t('trialEndedBanner')
    : status === 'checking' ? t('captureChecking')
    : status === 'unsupported' ? t('capturePhoneOnly')
    : Platform.OS === 'android' ? t(status === 'off' ? 'turnOnTracking' : 'captureAndroidOn')
    : t(status === 'first-alert-captured' ? 'captureIosFirstAlertCaptured'
      : status === 'waiting-for-alert' ? 'captureIosWaitingForAlert'
        : status === 'queue-warning' ? 'captureIosQueueWarning'
          : status === 'migration-retry' ? 'captureIosMigrationRetry'
            : status === 'needs-automation' ? 'captureIosNeedsAutomation' : 'captureIosOff');
  const healthy = status === 'waiting-for-alert' || status === 'first-alert-captured';
  // Capture is set up and expected to be delivering: healthy on iPhone; on
  // Android, permission granted, not opted out and not paused.
  const captureSetUp = Platform.OS === 'android'
    ? status !== 'off' && status !== 'paused' && status !== 'unsupported' && status !== 'checking'
    : healthy;
  const captureTimes = useMemo(() => liveCaptureTimes(state.transactions, isLiveCapture, now, 180),
    // Day-keyed like the other Home projections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.transactions, projectionDay]);
  const capturePause = captureSetUp && !history
    ? detectCapturePause({ captureTimes, nowMs: now.getTime(), snoozedAtMs: captureSnoozedAt }) : null;
  const captureStopped = capturePause?.stopped === true;
  const hasLiveCapture = useMemo(() => state.transactions.some(isLiveCapture), [state.transactions]);
  const budgetMonthKey = period.mode === 'month' && period.key === monthKey(now) ? period.key : null;
  const periodStartISO = period.mode === 'month' ? monthStartISO(period.key)
    : period.mode === 'range' ? period.from : null;
  // First days: nothing recorded before this period, so offer the past.
  const offerPast = periodStartISO !== null && state.hydrated && !history && !hasRecordsBefore(state.transactions, periodStartISO);
  const snoozeCapture = () => {
    const at = Date.now();
    // Move Home's clock too: a snooze later than `now` would be ignored.
    setNow(new Date(at));
    setCaptureSnoozedAt(at);
    void saveCapturePauseSnooze(at);
  };
  const checkCaptureSetup = () => {
    if (Platform.OS === 'ios') router.push('/ios-setup');
    else router.push('/settings?section=imports');
  };
  const rhythmLine = capturePause
    ? capturePause.rhythm === 'several-a-day' ? summaryWords.rhythmSeveral
      : capturePause.rhythm === 'about-daily' ? summaryWords.rhythmDaily
        : summaryWords.rhythmEvery(Math.max(2, Math.round(capturePause.typicalGapMs / 86_400_000)))
    : '';
  const stoppedTitle = capturePause
    ? Platform.OS === 'ios' ? summaryWords.stoppedIos(capturePause.silentDays) : summaryWords.stoppedAndroid(capturePause.silentDays)
    : '';
  const stoppedCause = Platform.OS === 'ios' ? summaryWords.stoppedCauseIos : summaryWords.stoppedCauseAndroid;
  const captureStoppedNotice = captureStopped ? <View testID="home-capture-stopped" style={[styles.stoppedNotice, { borderColor: theme.cardBorder }]}>
    <View accessible accessibilityRole="text" accessibilityLabel={[stoppedTitle, rhythmLine, stoppedCause].join(' ')} style={styles.stoppedCopy}>
      <View style={styles.stoppedHeading}>
        <Icon name="alert" size={17} color={theme.warning} />
        <ThemedText type="smallBold" style={styles.grow}>{stoppedTitle}</ThemedText>
      </View>
      <ThemedText type="meta" themeColor="textSecondary">{rhythmLine} {stoppedCause}</ThemedText>
    </View>
    <View style={styles.stoppedActions}>
      <Pressable testID="home-capture-check" accessibilityRole="button" accessibilityLabel={summaryWords.checkSetup}
        onPress={checkCaptureSetup} style={({ pressed }) => [styles.stoppedAction, { backgroundColor: pressed ? theme.backgroundSelected : band.card }]}>
        <ThemedText type="smallBold" themeColor="primary">{summaryWords.checkSetup}</ThemedText>
      </Pressable>
      <Pressable testID="home-capture-away" accessibilityRole="button" accessibilityLabel={summaryWords.away}
        onPress={snoozeCapture} style={({ pressed }) => [styles.stoppedAction, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
        <ThemedText type="smallBold">{summaryWords.away}</ThemedText>
      </Pressable>
    </View>
  </View> : null;
  // Transfers is the one page for the queue: its card asks one question at a time, and what the
  // card cannot ask (a likely card repayment, an archived account) waits there as a group row.
  const transferNotice = pendingTransfers && pendingTransfers.count > 0 ? <TransferReviewNotice
    pendingCount={pendingTransfers.count} incomingFils={pendingTransfers.incomingFils} outgoingFils={pendingTransfers.outgoingFils}
    onPress={() => router.push('/transfers')} /> : null;
  const transfersLink = <Pressable testID="home-transfers-link" accessibilityRole="button" accessibilityLabel={transferWords.viewAll}
    accessibilityHint={transferWords.walletDetail} onPress={() => router.push('/transfers')}
    style={({ pressed }) => [styles.utilityRow, styles.transferAction, { borderColor: band.rule, opacity: pressed ? 0.7 : 1 }]}>
    <View style={[styles.rowGlyph, { backgroundColor: band.glyphGround }]}><Icon name="repeat" size={18} color={band.text} /></View>
    <View style={[styles.grow, styles.utilityCopy]}>
      <ThemedText type="smallBold">{transferWords.viewAll}</ThemedText>
      <ThemedText type="meta" style={{ color: band.textSecondary }}>{transferWords.walletDetail}</ThemedText>
    </View>
    <Icon name="chevron-right" size={18} color={band.textSecondary} />
  </Pressable>;

  // ── Needs you: the one thing that truly needs the person, highest priority
  // first (home-needs-you.ts). Dismissed for the session per need. ──
  const trackingNeed = !state.hydrated || !state.onboarded || history ? null
    : status === 'paused' ? 'paused' as const
      : captureStopped ? 'stopped' as const
        : !state.captureOptOut && (needsPermission || (Platform.OS === 'ios' && (status === 'off' || status === 'needs-automation')))
          ? 'off' as const : null;
  const need = state.hydrated && state.onboarded ? pickNeed({
    tracking: trackingNeed,
    overdueCard: earliestOverdueCard(payments),
    transferQuestions: pendingTransfers?.questions ?? 0,
    limitsOver,
    dismissed: dismissedNeedKeys,
  }) : null;
  const openNeed = (shown: Need) => {
    if (shown.kind === 'tracking') {
      if (shown.tracking === 'stopped') checkCaptureSetup();
      else openCapture();
    } else if (shown.kind === 'card') setCardDue(state.cardDues.find((due) => due.id === shown.dueId) ?? null);
    else if (shown.kind === 'transfers') router.push('/transfers');
    else router.push('/flow?view=categories&filter=limited');
  };
  const needLabel = (shown: Need) => shown.kind === 'tracking'
    ? shown.tracking === 'paused' ? homeWords.trackingPaused : shown.tracking === 'stopped' ? homeWords.trackingStopped : homeWords.trackingOff
    : shown.kind === 'card' ? homeWords.cardOverdue(shown.title)
      : shown.kind === 'transfers' ? homeWords.transfersToAnswer(shown.count) : homeWords.limitsOver(shown.count);
  // The pill's one visible line; it speaks needLabel in full.
  const needShortLabel = (shown: Need) => shown.kind === 'tracking'
    ? shown.tracking === 'paused' ? homeWords.needShort.trackingPaused
      : shown.tracking === 'stopped' ? homeWords.needShort.trackingStopped : homeWords.needShort.trackingOff
    : shown.kind === 'card' ? homeWords.needShort.cardOverdue : needLabel(shown);
  // Large text or a short window: the pill sits at the top of the sheet, so it never covers the first rows.
  const pillInline = needsYouInline({ largeText, fontScale, height: windowHeight });
  const needsYouPill = need ? <NeedsYouPill needKey={need.key} label={needShortLabel(need)} spokenLabel={needLabel(need)}
    hint={homeWords.needHint[need.kind]} icon={need.kind === 'transfers' ? 'repeat' : need.kind === 'card' ? 'calendar' : 'alert'}
    warning={need.kind === 'tracking' || need.kind === 'card'} dismissLabel={homeWords.dismiss} inline={pillInline}
    onPress={() => openNeed(need)} onDismiss={() => dismissNeed(need.key)} band={band} hold={!revealReady} /> : null;
  // Capture shows by itself while it needs the person (tracking off, paused or
  // stopped, the first week's progress, set up with no message read yet), even
  // when switched off in Customize Home, and goes again once it does not. The
  // offer to fill in the past is only an offer: it waits in the section.
  const captureNeeded = state.hydrated && state.onboarded && (trackingNeed !== null || captureStopped
    || (!history && moneyPicture !== null) || (captureSetUp && !hasLiveCapture && !history));
  const drawnWidgets = withNeededHomeSections(homeWidgets, captureNeeded ? ['capture'] : []);
  // Transfers still waiting that the Needs you pill does not name (no question
  // the card can ask: a likely card repayment, an archived account): one quiet
  // line under the transactions while the Transfers section is off.
  const quietTransfers = !homeWidgetVisible(drawnWidgets, 'transfers') && pendingTransfers
    && pendingTransfers.count > 0 && pendingTransfers.questions === 0
    ? <Pressable testID="home-transfers-waiting" accessibilityRole="button"
        accessibilityLabel={homeWords.transfersToAnswer(pendingTransfers.count)} accessibilityHint={homeWords.needHint.transfers}
        onPress={() => router.push('/transfers')}
        style={({ pressed }) => [styles.quietLine, { opacity: pressed ? 0.6 : 1 }]}>
        <Icon name="repeat" size={16} color={band.textSecondary} />
        <ThemedText type="meta" style={[styles.grow, { color: band.textSecondary }]}>{homeWords.transfersToAnswer(pendingTransfers.count)}</ThemedText>
        <Icon name="chevron-right" size={16} color={band.textSecondary} />
      </Pressable> : null;
  const founderUnlockEnabled = process.env.EXPO_PUBLIC_WAFRA_FOUNDER_UNLOCK === '1';
  const unlockFounder = founderUnlockEnabled && !state.founderPro
    ? () => {
        void unlockFounderPro()
          .then(() => toast.show('Founder Pro unlocked'))
          .catch(() => toast.show('Founder Pro could not be saved', { tone: 'error' }));
      }
    : undefined;
  const openRecap = recapEntry ? () => {
    const descriptor = recapEntry.descriptor;
    const value = descriptor.kind === 'year' ? descriptor.year : descriptor.key;
    setRecapEntry((current) => current ? { ...current, unread: false } : current);
    router.push(`/recap?kind=${descriptor.kind}&value=${encodeURIComponent(String(value))}` as never);
  } : undefined;
  const preferredName = state.userName === 'there' ? null : normalizePreferredName(state.userName);
  const greetingBase = language === 'ar'
    ? now.getHours() < 12 ? 'صباح الخير' : 'مساء الخير'
    : now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const greeting = preferredName
    ? `${greetingBase}${language === 'ar' ? '،' : ','} ${preferredName}`
    : greetingBase;
  // Hermes' Intl date formatting with options is slow enough to notice on a
  // screen that re-renders on every store update; the label changes by day.
  const dateLabel = useMemo(
    () => now.toLocaleDateString(language === 'ar' ? 'ar-AE' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectionDay, language]);

  const renderWidget = (id: HomeWidgetId) => {
    if (!homeWidgetVisible(homeWidgets, id)) return null;
    if (id === 'assistant') return <Pressable key={id} testID="home-widget-assistant" accessibilityRole="button"
      accessibilityLabel={t('homeWidgetAssistantTitle')} accessibilityHint={t('homeWidgetAssistantDetail')}
      onPress={() => router.push('/assistant')}
      style={({ pressed }) => [styles.utilityRow, { borderColor: band.rule, opacity: pressed ? 0.7 : 1 }]}>
      <View style={[styles.rowGlyph, { backgroundColor: band.glyphGround }]}><Icon name="spark" size={18} color={band.text} /></View>
      <View style={[styles.grow, styles.utilityCopy]}>
        <ThemedText type="smallBold">{t('homeWidgetAssistantTitle')}</ThemedText>
        <ThemedText type="meta" style={{ color: band.textSecondary }}>{t('homeWidgetAssistantDetail')}</ThemedText>
      </View>
      <Icon name="chevron-right" size={18} color={band.textSecondary} />
    </Pressable>;
    if (id === 'insight') {
      const insight = homeInsight?.scope === `${language}:${JSON.stringify(period)}` ? homeInsight : null;
      return insight ? <Pressable key={id} testID="home-widget-insight" accessibilityRole={insight.href ? 'button' : 'text'}
        disabled={!insight.href} accessibilityLabel={`${t('homeWidgetInsightTitle')}. ${insight.title}. ${insight.body}`}
        onPress={() => insight.href && router.push(insight.href as never)}
        style={({ pressed }) => [styles.utilityRow, { borderColor: band.rule, opacity: pressed ? 0.7 : 1 }]}>
        {/* One factual line, not a card: the observation and its figure. */}
        <View style={[styles.rowGlyph, { backgroundColor: band.glyphGround }]}><Icon name={insight.icon ?? 'chart'} size={18} color={band.text} /></View>
        <View style={[styles.grow, styles.utilityCopy]}>
          <ThemedText type="smallBold">{insight.title}</ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{insight.body}</ThemedText>
        </View>
        {insight.href ? <Icon name="chevron-right" size={18} color={band.textSecondary} /> : null}
      </Pressable> : null;
    }
    if (id === 'due' || id === 'upcoming') {
      const due = payments.filter(item => id === 'due' ? (item.overdue || item.urgent) : (!item.overdue && !item.urgent));
      if (due.length === 0) return null;
      // The heading totals every payment in this group, ≈ when any is an
      // estimate (bills and subscriptions; card dues are exact).
      const dueTotal = due.reduce((sum, item) => sum + item.amountFils, 0);
      const dueEstimated = due.some(item => item.kind !== 'card');
      const dueTotalText = `${dueEstimated ? '≈ ' : ''}${formatMoneyText(dueTotal, moneySpec, { decimals: true })}`;
      return <View key={id} style={styles.section} testID={`home-widget-${id}`}>
        <View style={styles.sectionHeading}><ThemedText type="smallBold" style={[styles.sectionTitle, styles.grow]}>{id === 'due' ? t('homeWidgetDueTitle') : words.upcoming}</ThemedText>
          <Pressable testID={`home-widget-${id}-total`} onPress={() => router.push('/bills')} accessibilityRole="button"
            accessibilityLabel={`${words.more}. ${words.dueTotal(due.length, `${dueEstimated ? `${paymentWords.estimate} ` : ''}${spokenMoney(dueTotal)}`)}`}
            style={styles.smallAction}>
            <ThemedText type="meta" style={{ color: band.textSecondary }}>{dueTotalText}</ThemedText>
            <Icon name="chevron-right" size={18} color={theme.text} /></Pressable></View>
        <View style={[styles.cardGroup, { borderColor: theme.cardBorder }]}>{due.slice(0, 3).map(item => <Pressable key={item.id} accessibilityRole="button"
          accessibilityLabel={`${item.displayLabel ?? item.title}. ${daysPhrase(item.daysLeft)}. ${item.kind !== 'card' ? `${paymentWords.estimate} ` : ''}${formatMoneyText(item.amountFils, moneySpec, { decimals: true })}`}
          onPress={() => openPayment(item)} style={[styles.paymentRow, { borderBottomColor: theme.cardBorder }]}>
          {/* Every payee row keeps its logo tile; the category glyph is only the fallback. */}
          <MerchantAvatar title={item.title} category={item.subscription?.category ?? 'other'} size={40} />
          <View style={styles.grow}><ThemedText type="smallBold">{item.displayLabel ?? item.title}</ThemedText><ThemedText type="meta" themeColor="textSecondary">{daysPhrase(item.daysLeft)}</ThemedText></View>
          <View style={[styles.paymentMoney, largeText && styles.paymentAmountStacked]}>
            {item.kind !== 'card' ? <ThemedText type="meta" style={{ color: band.textSecondary }}>≈</ThemedText> : null}
            <Money fils={item.amountFils} moneySpec={moneySpec} type="smallBold" decimals color={band.text} />
          </View></Pressable>)}</View>
      </View>;
    }
    // Transfers waiting for an answer, and the way to every transfer: off by
    // default (the Needs you pill names the queue when it has questions).
    if (id === 'transfers') {
      if (!transferNotice && !hasPeriodTransfers) return null;
      return <View key={id} style={styles.transfersBlock} testID="home-widget-transfers">{transferNotice}{hasPeriodTransfers ? transfersLink : null}</View>;
    }
    if (id !== 'activity') return null;
    // The period's latest rows, grouped by day; the whole row opens its sheet.
    return <HomeRecent key={id} rows={dashboard.activityRows.slice(0, HOME_RECENT_ROWS)} accountById={dashboard.accountById}
      internalIds={dashboard.internalTransactionIds} onPress={setEntry} arrivedRowId={arrivedRowId} Arriving={ArrivingRow}
      hold={!revealReady} todayISO={projectionDay} band={band} title={homeWords.transactions} seeAll={homeWords.seeAll}
      seeAllHint={homeWords.seeAllHint} onSeeAll={() => router.push('/transactions')}
      note={period.mode === 'month' && period.key === runningMonth ? undefined : periodLabel(period)}
      empty={!hasPeriodRecords ? <EmptyMonth monthName={periodLabel(period)} onReadInbox={() => void onRefresh()} primaryLabel={t('checkBankAlerts')} onAddManually={() => router.push('/add-transaction')} />
        : hasPeriodTransfers ? transfersLink : null}
      footer={quietTransfers} />;
  };

  const summaryProps = {
    theme, band, language, largeText, greeting, dateLabel, periodLabel: periodLabel(period),
    incomeFils: dashboard.hero.incomeFils, expenseFils: dashboard.hero.expenseFils, netFils: dashboard.hero.netFils,
    moneySpec,
    onPeriod: () => setPeriodOpen(true), onAdd: () => router.push('/add-transaction'),
    onSettings: () => router.push('/settings'),
    onIncome: () => router.push('/transactions?type=income'),
    onSpending: () => router.push('/flow'),
  };

  const layout = splitHomeWidgetLayout(drawnWidgets);
  // On the band, the month line sits right under the Today tiles and names the
  // period; anywhere else (hidden, or moved down the sheet) the tiles name it.
  const sectionProps = { ...summaryProps, today: homeToday,
    showPeriodContext: !layout.band.includes('overview'),
    onToday: () => router.push('/transactions'),
    onBudgets: () => router.push('/flow?view=categories&filter=limited'),
    onSetBudget: budgetMonthKey ? () => setBudgetSheetOpen(true) : undefined,
    captureStopped,
    motionHold: !revealReady,
  };
  const greetingInToolbar = layout.band[0] === 'greeting';
  const sheetPalette = { ...band, onBand: band.text, onBandSecondary: band.textSecondary,
    tile: band.glyphGround, bandMark: band.textSecondary, bandRule: band.rule };
  const renderCapture = () => (<View style={styles.captureBlock}>
    {captureStoppedNotice}
    {!history && moneyPicture ? <MoneyPictureProgress model={moneyPicture} onResume={retryHistory} /> : null}
        {captureSetUp && !hasLiveCapture && !history ? <View testID="home-capture-ready" accessible accessibilityRole="text"
          accessibilityLabel={`${Platform.OS === 'android' ? summaryWords.readyAndroid : summaryWords.readyIos}. ${summaryWords.readyBody}`}
          style={[styles.readyCard, { borderColor: theme.cardBorder }]}>
          <Icon name="mail" size={18} color={theme.primary} />
          <View style={styles.grow}>
            <ThemedText type="smallBold">{Platform.OS === 'android' ? summaryWords.readyAndroid : summaryWords.readyIos}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">{summaryWords.readyBody}</ThemedText>
          </View>
        </View> : null}
        {offerPast ? <View style={styles.section} testID="home-fill-past">
          <ThemedText type="smallBold" style={styles.sectionTitle}>{summaryWords.pastTitle}</ThemedText>
          <View style={[styles.cardGroup, { borderColor: theme.cardBorder }]}>
            {([
              { id: 'statement', icon: 'upload', title: summaryWords.pastImport, body: summaryWords.pastImportBody, href: '/statement-import' },
              { id: 'manual', icon: 'plus', title: summaryWords.addByHand, body: summaryWords.addByHandBody, href: '/add-transaction' },
            ] as const).map((item) => <Pressable key={item.id} testID={`home-fill-past-${item.id}`} accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${item.body}`} onPress={() => router.push(item.href)}
              style={({ pressed }) => [styles.pastRow, { borderBottomColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
              <Icon name={item.icon} size={18} color={theme.primary} />
              <View style={styles.grow}>
                <ThemedText type="smallBold">{item.title}</ThemedText>
                <ThemedText type="meta" themeColor="textSecondary">{item.body}</ThemedText>
              </View>
              <Icon name="chevron-right" size={16} color={theme.textSecondary} />
            </Pressable>)}
          </View>
        </View> : null}


        {/* One dismissable pointer to the Widgets screen, after a week of capture. */}
        <WidgetsHint hydrated={state.hydrated} onboarded={state.onboarded} captureSetUp={captureSetUp}
          captureStopped={captureStopped} firstDays={moneyPicture !== null || history !== null || offerPast}
          transactions={state.transactions} now={now} palette={band} />
<View style={[styles.captureFooter, { backgroundColor: band.card }]} testID="journal-import-controls">
          <Pressable accessibilityRole="button" accessibilityLabel={`${words.import}. ${captureLabel}`}
            disabled={status === 'checking' || status === 'unsupported' || refreshing}
            onPress={openCapture} style={[styles.captureRow, largeText && styles.utilityStacked]}>
            <View style={[styles.utilityGlyph, { backgroundColor: band.glyphGround }]}><Icon name="mail" size={22} color={healthy ? theme.primary : theme.warning} /></View>
            <View style={[styles.grow, styles.utilityCopy]}><ThemedText type="smallBold" style={styles.utilityTitle}>{words.import}</ThemedText>
              <ThemedText type="meta" themeColor="textSecondary">{captureLabel}</ThemedText></View>
            <Icon name="chevron-right" size={16} color={theme.textSecondary} />
          </Pressable>
          {dashboard.uncategorised.shouldPrompt ? <Pressable onPress={() => router.push('/categorise')} accessibilityRole="button" style={styles.footerAction}>
            <ThemedText type="meta">{tf('uncategorisedMerchantCount', {
              count: dashboard.uncategorised.summary.merchants.length + dashboard.uncategorised.summary.paymentPurposes.length,
              s: dashboard.uncategorised.summary.merchants.length + dashboard.uncategorised.summary.paymentPurposes.length === 1 ? '' : 's',
            })}</ThemedText>
            <Icon name="chevron-right" size={16} color={theme.textSecondary} /></Pressable>
          : dashboard.unreadFormats?.shouldPrompt ? <Pressable onPress={() => router.push('/accuracy')} accessibilityRole="button" style={styles.footerAction}>
            <ThemedText type="meta">{tf('unreadFormatCount', { count: dashboard.unreadFormats.count,
              s: dashboard.unreadFormats.count === 1 ? '' : 's' })}</ThemedText>
            <Icon name="chevron-right" size={16} color={theme.textSecondary} /></Pressable> : null}
        </View>
  </View>);
  const renderSection = (id: HomeWidgetId, onBand = false) => {
    const props = { ...sectionProps, band: onBand ? band : sheetPalette, figureInset: onBand ? 0 : 32,
      pattern: id === 'greeting' && !greetingInToolbar ? <YourPattern compact testID="home-personal-pattern" tile={24} gap={3} /> : undefined };
    const content = id === 'greeting' ? <ReferenceHomeGreeting {...props} />
      : id === 'hero' ? <HomeHero band={props.band} moneySpec={moneySpec} language={language} largeText={largeText}
          current={heroCurrent} previous={heroPrevious} onWantPrevious={wantHeroPrevious} budgets={state.budgets}
          warning={livePace === 'over'} hold={!revealReady} />
      : id === 'overview' ? <ReferenceHomeSummary {...props} onBand={onBand} />
      : id === 'today' ? <ReferenceHomeToday {...props} />
      : id === 'week' ? <ReferenceHomeWeek {...props} />
      : id === 'capture' ? renderCapture() : renderWidget(id);
    if (!content) return null;
    const financial = id === 'overview' || id === 'today' || id === 'week';
    return <View key={id} testID={`home-section-${id}`}
      style={!onBand && financial ? [styles.movedMoneyBlock, { backgroundColor: band.card }] : undefined}>{content}</View>;
  };

  return <>
    <BandScaffold band="home" tabbed testID="home-screen" contentStyle={styles.screen}
      floatingClearance={Math.max(Platform.OS === 'android' ? HOME_ADD_BUTTON_CLEARANCE : 0, need && !pillInline ? NEEDS_YOU_CLEARANCE : 0)}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={band.onBand} />}
      bandContent={state.hydrated ? <ReferenceHomeBand {...sectionProps}
        sections={layout.band.map(id => renderSection(id, true))}
        pattern={greetingInToolbar ? <YourPattern compact testID="home-personal-pattern" tile={24} gap={3} /> : undefined}
        today={homeToday}
        onToday={() => router.push('/transactions')}
        hideHeaderAdd={Platform.OS === 'android'}
        onSetBudget={budgetMonthKey ? () => setBudgetSheetOpen(true) : undefined}
        captureStopped={captureStopped}
        // The recap W sits on the dark band, so it draws in the dark palette.
        brandMark={openRecap ? <ThemeScope.Provider value={band.statusBar === 'light' ? 'dark' : 'light'}>
          <RecapLogoTrigger
            unread={recapEntry?.unread ?? false}
            accessibilityLabel={language === 'ar'
              ? `ملخص وفرة · ${recapEntry?.descriptor.label ?? ''}`
              : `Wafra Recap · ${recapEntry?.descriptor.label ?? ''}`}
            onPress={openRecap}
            onLongPress={unlockFounder}
          /></ThemeScope.Provider> : undefined}
        onFounderUnlock={unlockFounder} /> : null}>
      {!state.hydrated ? <View accessibilityRole="progressbar" accessibilityLabel={t('loadingLedger')} style={styles.loading}>
        <SkeletonRows count={1} height={160} /><SkeletonRows count={4} height={66} />
      </View> : <>
        {/* What needs the person (capture stopped, transfers to answer, …) is
            the Needs you pill: here, at the top of the sheet, with large text
            or on a short window; otherwise floating above the tab bar. The
            full notices live in Capture status and Transfers in Customize Home. */}
        {pillInline ? needsYouPill : null}
        {/* First week: one truthful progress surface. After it retires, blocking
            history states keep their existing compact recovery card. */}
        {history ? (moneyPicture ? <MoneyPictureProgress model={moneyPicture} onResume={retryHistory} />
          : <HistoryReadingStatus progress={history} onResume={retryHistory} />) : null}


        {/* The band holds the greeting and the Spent hero. The sheet leads
            with the transactions, then any section switched on in Customize
            Home, in the saved order. */}
        {layout.sheet.map(id => renderSection(id))}


        <Pressable testID="home-customize-link" onPress={() => router.push('/home-customize')} accessibilityRole="button"
          accessibilityHint={t('homeCustomizeDetail')} style={styles.customizeAction}>
          <Icon name="sliders" size={18} color={band.textSecondary} />
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{t('homeCustomizeTitle')}</ThemedText>
        </Pressable>
      </>}
    </BandScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} />
    <CardPaymentSheet due={cardDue} onClose={() => setCardDue(null)} />
    <BillDetailSheet subscription={recurring} onClose={() => setRecurring(null)} />
    {budgetMonthKey ? <LimitSheet category={null} open={budgetSheetOpen} monthKey={budgetMonthKey} onClose={() => setBudgetSheetOpen(false)} /> : null}
    {Platform.OS === 'android' && state.hydrated ? <HomeAddButton label={words.add} onPress={() => router.push('/add-transaction')} /> : null}
    {pillInline ? null : needsYouPill}
  </>;
}

const styles = StyleSheet.create({
  screen: { gap: 24 },
  captureBlock: { gap: 16 },
  quietLine: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8 },
  movedMoneyBlock: { padding: 16, borderRadius: 24 },
  utilityStacked: { flexDirection: 'column', alignItems: 'stretch' },
  loading: { gap: 20, paddingTop: 20 },
  grow: { flex: 1, minWidth: 0 },
  // Its own line under the payee at the accessibility sizes, so the name is
  // not squeezed into breaking mid-word beside the figure.
  paymentAmountStacked: { flexBasis: '100%' },
  section: { paddingTop: 2, paddingBottom: 0 },
  activityHeading: { flex: 1, minWidth: 0, gap: 4 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 2 },
  sectionTitle: { fontSize: 20, lineHeight: 26 },
  smallAction: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  cardGroup: { overflow: 'hidden' },
  dateLabel: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 12, paddingBottom: 0 },
  dateDot: { height: 4, width: 4, borderRadius: 2 },
  dateRule: { height: StyleSheet.hairlineWidth, flex: 1 },
  importNotice: { borderStartWidth: 3, paddingStart: 14, paddingVertical: 10, marginBottom: 4, flexDirection: 'row', gap: 12, alignItems: 'center' },
  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, minHeight: 74, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  paymentDate: { width: 38, height: 38, borderWidth: 0, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  paymentAmount: { flexShrink: 1 },
  paymentMoney: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 4, marginStart: 'auto' },
  inlineAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  captureFooter: { borderRadius: 22, padding: 16, gap: 8 },
  captureRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 },
  footerAction: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  stoppedNotice: { gap: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  stoppedCopy: { gap: 4 },
  stoppedHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stoppedActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stoppedAction: { minHeight: 44, paddingHorizontal: 14, borderRadius: 999, justifyContent: 'center' },
  readyCard: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  pastRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  assistantCard: { minHeight: 76, borderRadius: 22, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  widgetCard: { borderRadius: 24, padding: 20, gap: 12 },
  utilityGlyph: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  utilityCopy: { gap: 4 },
  transferAction: { marginTop: 14 },
  transfersBlock: { gap: 4 },
  utilityTitle: { fontSize: 17, lineHeight: 23 },
  insightHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  insightTitle: { fontSize: 24, lineHeight: 30, letterSpacing: -0.6 },
  // Home v2: Ask Wafra, the insight and Transfers are plain rows, not cards.
  utilityRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  rowGlyph: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  dayHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 12, paddingTop: 12 },
  dayTitle: { fontFamily: Fonts.sansSemi },
  // Over the arriving row's logo tile, at its top end corner.
  arrivalCoin: { position: 'absolute', top: 0, start: 24, pointerEvents: 'none' },
  customizeAction: { minHeight: 48, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8 },
});

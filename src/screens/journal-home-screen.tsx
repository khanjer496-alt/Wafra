import { HistoryReadingStatus } from '@/components/history-reading-status';
import { MoneyPictureProgress } from '@/components/money-picture-progress';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, InteractionManager, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';

import { ThemedText } from '@/components/themed-text';
import { TransactionRow } from '@/components/transaction-row';
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
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { ThemeScope, useTheme } from '@/hooks/use-theme';
import { useBand } from '@/hooks/use-band';
import { projectDashboard, projectDashboardInsight } from '@/lib/dashboard-projection';
import type { Insight } from '@/lib/insights';
import { measureRuntimeOperation } from '@/lib/runtime-performance';
import { openSmsPermissionSettings } from '@/lib/auto-import';
import { buildReferenceFxUpdates } from '@/lib/fx';
import { monthEndISO, monthKey, monthStartISO } from '@/lib/format';
import { daysPhrase, type Outgoing } from '@/lib/leaving-soon';
import { markLaunchPhase } from '@/lib/launch-performance';
import { ledgerCurrencyCode, marketCurrencyCode } from '@/lib/markets';
import { formatMoneyText, ledgerMoneySpec } from '@/lib/ledger-money';
import { isSpending, liveAccountIds, transferReconciliationForState } from '@/lib/ledger';
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
import type { Subscription } from '@/lib/subscriptions';
import type { AppState as LedgerState, CardDue, Transaction } from '@/lib/types';
import { t, tf } from '@/lib/i18n';
import { homeWidgetVisible, loadHomeWidgetPreferences, splitHomeWidgetLayout, subscribeHomeWidgetPreferences, type HomeWidgetId, type HomeWidgetPreferences } from '@/lib/home-widgets';
import { defaultHomeWidgetPreferences } from '@/lib/home-widget-preferences';
import { hasRecapActivity, recapCandidates, type RecapDescriptor } from '@/lib/recap';
import { loadViewedRecaps } from '@/lib/recap-view-state';
import { transferActivityCopy } from '@/lib/transfer-activity-copy';
import { isTransferCandidate } from '@/lib/transfer-reconciliation';

/** Presentation-only vocabulary; every amount still comes from the shared ledger. */
const copy = {
  en: { journal: 'Your money, in view', month: 'THIS PERIOD', activity: 'Recent transactions',
    add: 'Add an entry', breakdown: 'View spending', upcoming: 'Coming up',
    import: 'Bank alerts', paused: 'History import paused', resume: 'Resume',
    more: 'View all payments', accounts: 'Your accounts',
    income: 'Money in', spent: 'Spent', netNote: 'Income minus spending · not your bank balance',
    progress: 'Reading history', attention: 'Needs your attention' },
  ar: { journal: 'أموالك بوضوح', month: 'هذه الفترة', activity: 'حركتك المالية',
    add: 'إضافة حركة', breakdown: 'عرض الإنفاق', upcoming: 'الدفعات القادمة',
    import: 'تنبيهات البنك', paused: 'استيراد السجل متوقف مؤقتاً', resume: 'متابعة',
    more: 'عرض كل الدفعات', accounts: 'حساباتك',
    income: 'الدخل', spent: 'الإنفاق', netNote: 'الدخل ناقص الإنفاق · ليس رصيد البنك',
    progress: 'قراءة السجل', attention: 'يحتاج إلى انتباهك' },
} as const;

const sameHomeWidgets = (a: HomeWidgetPreferences, b: HomeWidgetPreferences): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

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
  'historyImport',
] as const satisfies readonly (keyof LedgerState)[];
const homeStateEqual = fieldsEqual<LedgerState>(HOME_STATE_FIELDS);

export default function JournalHomeScreen() {
  const theme = useTheme();
  // Design language E: Home wears the ink band in both schemes.
  const band = useBand('home');
  const language = useLanguage();
  const words = copy[language === 'ar' ? 'ar' : 'en'];
  const transferWords = transferActivityCopy(language);
  const largeText = useLargeTextLayout();
  const focused = useIsFocused();
  const privacyGateCleared = usePrivacyGateCleared();
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
  // The tab shell still owns capture. This screen only observes or explicitly joins it.
  const { runAutoImport, needsPermission, captureState } = useAutoImport(false, true);
  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [entry, setEntry] = useState<Transaction | null>(null);
  const [cardDue, setCardDue] = useState<CardDue | null>(null);
  const [recurring, setRecurring] = useState<Subscription | null>(null);
  const [homeWidgets, setHomeWidgets] = useState<HomeWidgetPreferences>(() => defaultHomeWidgetPreferences());
  const [homeAnalysisReady, setHomeAnalysisReady] = useState(false);
  const [homeInsight, setHomeInsight] = useState<(Insight & { scope: string }) | null>(null);
  const [recapEntry, setRecapEntry] = useState<{ descriptor: RecapDescriptor; unread: boolean } | null>(null);
  // The transfer review queue, computed after interactions (it needs the
  // full reconciliation graph). Null until known.
  const [pendingTransfers, setPendingTransfers] = useState<PendingTransferSummary | null>(null);
  // "I was away" on the capture-stopped notice (epoch ms), or null.
  const [captureSnoozedAt, setCaptureSnoozedAt] = useState<number | null>(null);
  const [budgetSheetOpen, setBudgetSheetOpen] = useState(false);
  const summaryWords = homeSummaryCopy[language === 'ar' ? 'ar' : 'en'];
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
  useEffect(() => {
    if (!focused) return;
    let alive = true;
    // Every return to this tab reloads the preference. Only publish a new
    // object when something actually changed, so the tab switch itself does
    // not re-render Home a second time.
    const apply = (preferences: HomeWidgetPreferences) => {
      if (alive) setHomeWidgets(current => sameHomeWidgets(current, preferences) ? current : preferences);
    };
    const unsubscribe = subscribeHomeWidgetPreferences(apply);
    void loadHomeWidgetPreferences().then(apply);
    return () => { alive = false; unsubscribe(); };
  }, [focused]);

  useEffect(() => {
    if (!focused) return;
    let alive = true;
    void loadCapturePauseSnooze().then((snoozedAt) => {
      if (alive) setCaptureSnoozedAt((current) => current === snoozedAt ? current : snoozedAt);
    });
    return () => { alive = false; };
  }, [focused]);

  useEffect(() => {
    if (!focused || !privacyGateCleared || !state.hydrated || !state.onboarded) return;
    // Mark Home usable from the first committed ledger frame. Category/parser
    // cleanup is intentionally NOT scheduled from Home: both dedicated tools
    // remain available in Settings, and a large ledger must not pay multiple
    // full-history scans a moment after the first frame just to render a prompt.
    markLaunchPhase('first-usable-home');
  }, [focused, privacyGateCleared, state.hydrated, state.onboarded]);
  useEffect(() => {
    if (!focused || !privacyGateCleared || !state.hydrated || !state.onboarded || homeAnalysisReady) return;
    // The insight is lower priority again. Its Home variant deliberately skips
    // subscription detection; Bills owns that full historical analysis.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => setHomeAnalysisReady(true), 1_800);
    });
    return () => {
      task.cancel();
      if (timer !== null) clearTimeout(timer);
    };
  }, [focused, homeAnalysisReady, privacyGateCleared, state.hydrated, state.onboarded]);
  useEffect(() => {
    if (!focused || !privacyGateCleared || !state.hydrated || !state.onboarded) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // Recap is celebratory, never launch-critical. Wait until Home and its
    // existing insight lane are settled, then do only the cheap period presence
    // check. The full ledger projection runs after the user taps the W.
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        const candidates = recapCandidates(now).filter((descriptor) =>
          hasRecapActivity(state.transactions, descriptor));
        if (candidates.length === 0) {
          if (alive) setRecapEntry(null);
          return;
        }
        void loadViewedRecaps().then((viewed) => {
          const descriptor = candidates.find((candidate) => !viewed.has(candidate.id)) ?? candidates[0]!;
          if (alive) setRecapEntry({ descriptor, unread: !viewed.has(descriptor.id) });
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
  }, [focused, privacyGateCleared, state.hydrated, state.onboarded, state.transactions, projectionDay]);
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
  }),
    // Progress counters do not change totals. Transfer receipts can change
    // financial scope even when finalization preserves the ledger arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.hydrated, state.transactions, state.accounts, state.budgets, state.bills,
      state.cardDues, state.notSubscriptions, state.merchantOverrides, state.language,
      state.ledgerMoney, state.transferInternalIds, state.transferNormalizationVersion,
      state.historyImport?.status, state.marketId, period, projectionDay]);
  const payments = dashboard.upcoming.items;
  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);
  // Today and this week use the same spending definition and transfer scope as
  // the period totals below them. Budget pace applies only to the live month.
  const homeToday = useMemo(() => {
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
  }, [state.transactions, state.budgets, liveAccounts, dashboard.internalTransactionIds, period, projectionDay]);
  // Native widgets use Bills' complete 30-day recurring projection, never
  // Home's deliberately shorter, subscription-free first-paint list.
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
        && latest.historyImport === source.historyImport;
    };
    const task = InteractionManager.runAfterInteractions(() => {
      if (current()) request = requestWidgetSnapshotSync({ state: source, now: new Date(), moneySpec,
        language: language === 'ar' ? 'ar' : 'en' }, current);
    });
    return () => { cancelled = true; task.cancel(); request?.cancel(); };
  }, [state.hydrated, state.onboarded, state.privateMode, state.transactions, state.accounts, state.budgets, state.bills,
    state.cardDues, state.notSubscriptions, state.cancelledSubscriptions, state.transferInternalIds, state.transferNormalizationVersion,
    state.ledgerMoney, state.marketId, state.historyImport, moneySpec, language, now, getStateGeneration, getStateSnapshot]);
  // Recent activity, and which transfers it leaves to the Transfers screen,
  // come from the one dashboard projection rather than a second ledger walk.
  const hasPeriodTransfers = dashboard.hasPeriodTransfers === true;
  // "Empty month" means no live record at all, not merely no recent cash-flow
  // row: card-payment settlements and internal movements are records too.
  const hasPeriodRecords = dashboard.hasPeriodRecords === true || hasPeriodTransfers;
  const insightWidgetVisible = homeWidgetVisible(homeWidgets, 'insight');
  const historyAnalysisBlocked = state.historyImport !== null && state.historyImport.status !== 'complete';
  useEffect(() => {
    if (!homeAnalysisReady || !insightWidgetVisible || historyAnalysisBlocked) {
      setHomeInsight(null);
      return;
    }
    let cancelled = false;
    // Keep the previous card only inside its original period/language while
    // recomputing. Analysis must not hitch the turn that just painted an SMS.
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      const next = measureRuntimeOperation('home-insight', () =>
        projectDashboardInsight(state, period, now));
      if (!cancelled) setHomeInsight(next ? { ...next, scope: `${language}:${JSON.stringify(period)}` } : null);
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
    // Capture/progress state must not restart historical analysis. The optional
    // insight is computed only after Home is already interactive and only while
    // the user has that widget enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeAnalysisReady, insightWidgetVisible, historyAnalysisBlocked, state.transactions, state.accounts, state.budgets,
    state.notSubscriptions, state.transferInternalIds, state.transferNormalizationVersion,
    state.historyImport?.status, state.marketId, state.ledgerMoney, language, period, projectionDay]);
  // Home names the transfer review queue only once it is known: the same
  // pendingIds the review screen lists, so the count and the list agree. The
  // graph is built after interactions, never during hydration or a running
  // history import, and not at all when no row could be a transfer.
  useEffect(() => {
    if (historyAnalysisBlocked) { setPendingTransfers(null); return; }
    if (!focused || !privacyGateCleared || !state.hydrated || !state.onboarded) return;
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      // The reconciliation cached per stored transfer receipt, shared with
      // Transactions and Transfers, rather than a second full graph build.
      const reconciliation = state.transactions.some(isTransferCandidate) ? transferReconciliationForState(state) : null;
      const next = reconciliation
        ? pendingTransferSummary(state.transactions, reconciliation.pendingIds)
        : { count: 0, incomingFils: 0, outgoingFils: 0 };
      if (!cancelled) setPendingTransfers(next);
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
    // Transfer receipts change the reconciliation even when the arrays do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, privacyGateCleared, state.hydrated, state.onboarded, historyAnalysisBlocked, state.transactions, state.accounts,
    state.transferInternalIds, state.transferNormalizationVersion]);
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
  const transferNotice = pendingTransfers && pendingTransfers.count > 0 ? <TransferReviewNotice
    pendingCount={pendingTransfers.count} incomingFils={pendingTransfers.incomingFils} outgoingFils={pendingTransfers.outgoingFils}
    onPress={() => router.push('/review-transfers')} /> : null;
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
      style={({ pressed }) => [styles.assistantCard, largeText && styles.utilityStacked, { backgroundColor: band.card, opacity: pressed ? 0.75 : 1 }]}>
      <View style={[styles.utilityGlyph, { backgroundColor: band.glyphGround }]}><Icon name="spark" size={22} color={band.text} /></View>
      <View style={[styles.grow, styles.utilityCopy]}>
        <ThemedText type="smallBold" style={styles.utilityTitle}>{t('homeWidgetAssistantTitle')}</ThemedText>
        <ThemedText type="meta" style={{ color: band.textSecondary }}>{t('homeWidgetAssistantDetail')}</ThemedText>
      </View>
      <Icon name="chevron-right" size={18} color={theme.textSecondary} />
    </Pressable>;
    if (id === 'insight') {
      const insight = homeInsight?.scope === `${language}:${JSON.stringify(period)}` ? homeInsight : null;
      return insight ? <Pressable key={id} testID="home-widget-insight" accessibilityRole={insight.href ? 'button' : 'text'}
        disabled={!insight.href} accessibilityLabel={`${t('homeWidgetInsightTitle')}. ${insight.title}. ${insight.body}`}
        onPress={() => insight.href && router.push(insight.href as never)}
        style={({ pressed }) => [styles.widgetCard, { backgroundColor: band.card, opacity: pressed ? 0.8 : 1 }]}>
        <View style={styles.insightHeading}>
          <View style={[styles.utilityGlyph, { backgroundColor: band.glyphGround }]}><Icon name={insight.icon ?? 'chart'} size={22} color={band.text} /></View>
          <ThemedText type="meta" style={[styles.grow, { color: band.textSecondary }]}>{t('homeWidgetInsightTitle')} · {periodLabel(period)}</ThemedText>
          {insight.href ? <Icon name="arrow-up-right" size={20} color={band.text} /> : null}
        </View>
        <ThemedText type="heading" style={styles.insightTitle}>{insight.title}</ThemedText>
        <ThemedText type="small" style={{ color: band.textSecondary }}>{insight.body}</ThemedText>
      </Pressable> : null;
    }
    if (id === 'due' || id === 'upcoming') {
      const due = payments.filter(item => id === 'due' ? (item.overdue || item.urgent) : (!item.overdue && !item.urgent));
      if (due.length === 0) return null;
      return <View key={id} style={styles.section} testID={`home-widget-${id}`}>
        <View style={styles.sectionHeading}><ThemedText type="smallBold" style={styles.sectionTitle}>{id === 'due' ? t('homeWidgetDueTitle') : words.upcoming}</ThemedText>
          <Pressable onPress={() => router.push('/bills')} accessibilityRole="button" accessibilityLabel={words.more} style={styles.smallAction}><Icon name="chevron-right" size={18} color={theme.text} /></Pressable></View>
        <View style={[styles.cardGroup, { borderColor: theme.cardBorder }]}>{due.slice(0, 2).map(item => <Pressable key={item.id} accessibilityRole="button"
          accessibilityLabel={`${item.title}. ${daysPhrase(item.daysLeft)}. ${item.kind !== 'card' ? `${paymentWords.estimate} ` : ''}${formatMoneyText(item.amountFils, moneySpec, { decimals: true })}`}
          onPress={() => openPayment(item)} style={[styles.paymentRow, { borderBottomColor: theme.cardBorder }]}>
          {/* Every payee row keeps its logo tile; the category glyph is only the fallback. */}
          <MerchantAvatar title={item.title} category={item.subscription?.category ?? 'other'} size={40} />
          <View style={styles.grow}><ThemedText type="smallBold">{item.title}</ThemedText><ThemedText type="meta" themeColor="textSecondary">{daysPhrase(item.daysLeft)}</ThemedText></View>
          <View style={[styles.paymentMoney, largeText && styles.paymentAmountStacked]}>
            {item.kind !== 'card' ? <ThemedText type="meta" style={{ color: band.textSecondary }}>≈</ThemedText> : null}
            <Money fils={item.amountFils} moneySpec={moneySpec} type="smallBold" decimals color={band.text} />
          </View></Pressable>)}</View>
      </View>;
    }
    if (id !== 'activity') return null;
    return <View key={id} style={styles.section} testID="home-widget-activity">
      <View style={styles.sectionHeading}><View style={styles.activityHeading}><ThemedText type="smallBold" style={styles.sectionTitle}>{words.activity}</ThemedText>
        <ThemedText testID="home-activity-period" type="meta" style={{ color: band.textSecondary }}>{periodLabel(period)}</ThemedText></View>
        <Pressable onPress={() => router.push('/transactions')} accessibilityRole="button" style={styles.smallAction}><Icon name="search" size={18} color={theme.text} /><ThemedText type="meta">{t('allActivity')}</ThemedText></Pressable></View>
      <View style={[styles.cardGroup, { borderColor: theme.cardBorder }]}>{dashboard.activityRows.slice(0, 5).map(transaction =>
        <TransactionRow key={transaction.id} transaction={transaction} account={dashboard.accountById.get(transaction.accountId)} onPress={setEntry} internal={dashboard.internalTransactionIds.has(transaction.id)} />)}</View>
      {hasPeriodTransfers && <Pressable testID="home-transfers-link" accessibilityRole="button" accessibilityLabel={transferWords.viewAll}
        accessibilityHint={transferWords.walletDetail} onPress={() => router.push('/transfers')}
        style={[styles.assistantCard, styles.transferAction, largeText && styles.utilityStacked, { backgroundColor: band.card }]}>
        <View style={[styles.utilityGlyph, { backgroundColor: band.glyphGround }]}><Icon name="repeat" size={22} color={band.text} /></View>
        <View style={[styles.grow, styles.utilityCopy]}>
          <ThemedText type="smallBold" style={styles.utilityTitle}>{transferWords.viewAll}</ThemedText>
          <ThemedText type="meta" style={{ color: band.textSecondary }}>{transferWords.walletDetail}</ThemedText>
        </View>
        <Icon name="chevron-right" size={18} color={band.textSecondary} />
      </Pressable>}
      {dashboard.activityRows.length === 0 && !hasPeriodRecords && <EmptyMonth monthName={periodLabel(period)} onReadInbox={() => void onRefresh()} primaryLabel={t('checkBankAlerts')} onAddManually={() => router.push('/add-transaction')} />}
    </View>;
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

  const sectionProps = { ...summaryProps, today: homeToday,
    showPeriodContext: !homeWidgetVisible(homeWidgets, 'overview') || homeWidgets.order.indexOf('overview') > homeWidgets.order.indexOf('today'),
    onToday: () => router.push('/transactions'),
    onBudgets: () => router.push('/flow?view=categories&filter=limited'),
    onSetBudget: budgetMonthKey ? () => setBudgetSheetOpen(true) : undefined,
    captureStopped,
  };
  const layout = splitHomeWidgetLayout(homeWidgets);
  const greetingInToolbar = layout.band[0] === 'greeting';
  const sheetPalette = { ...band, onBand: band.text, onBandSecondary: band.textSecondary,
    tile: band.glyphGround, bandMark: band.textSecondary, bandRule: band.rule };
  const renderCapture = () => (<View style={styles.captureBlock}>
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
      pattern: id === 'greeting' && !greetingInToolbar ? <YourPattern tile={24} gap={3} /> : undefined };
    const content = id === 'greeting' ? <ReferenceHomeGreeting {...props} />
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
      floatingClearance={Platform.OS === 'android' ? HOME_ADD_BUTTON_CLEARANCE : 0}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={band.onBand} />}
      bandContent={state.hydrated ? <ReferenceHomeBand {...sectionProps}
        sections={layout.band.map(id => renderSection(id, true))}
        pattern={greetingInToolbar ? <YourPattern tile={24} gap={3} /> : undefined}
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
        {/* Notices that change how the band's figures read come first on the sheet. */}
        {captureStoppedNotice}
        {transferNotice}
        {/* First week: one truthful progress surface. After it retires, blocking
            history states keep their existing compact recovery card. */}
        {history ? (moneyPicture ? <MoneyPictureProgress model={moneyPicture} onResume={retryHistory} />
          : <HistoryReadingStatus progress={history} onResume={retryHistory} />) : null}


        {/* The band keeps the selected total beside daily spending. The sheet
            leads with actionable payments and activity in the saved order. */}
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
  </>;
}

const styles = StyleSheet.create({
  screen: { gap: 24 },
  captureBlock: { gap: 16 },
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
  utilityTitle: { fontSize: 17, lineHeight: 23 },
  insightHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  insightTitle: { fontSize: 24, lineHeight: 30, letterSpacing: -0.6 },
  customizeAction: { minHeight: 48, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8 },
});

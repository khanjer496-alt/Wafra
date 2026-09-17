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
import { ReferenceHomeSummary } from '@/components/reference-home-summary';
import { RecapLogoTrigger } from '@/components/recap/recap-logo-trigger';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { EmptyMonth, SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useAutoImport, type CaptureSurfaceState } from '@/hooks/use-auto-import';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { projectDashboard, projectDashboardInsight } from '@/lib/dashboard-projection';
import { measureRuntimeOperation } from '@/lib/runtime-performance';
import { openSmsPermissionSettings } from '@/lib/auto-import';
import { buildReferenceFxUpdates } from '@/lib/fx';
import { formatAmount } from '@/lib/format';
import { daysPhrase, type Outgoing } from '@/lib/leaving-soon';
import { markLaunchPhase } from '@/lib/launch-performance';
import { ledgerCurrencyCode, marketCurrencyCode } from '@/lib/markets';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import { moneyPictureProgress } from '@/lib/money-picture-progress';
import { normalizePreferredName } from '@/lib/onboarding';
import { syncPaymentReminders } from '@/lib/notifications';
import { reminderScheduleInputsChanged } from '@/lib/reminders';
import { periodLabel } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { isProActive } from '@/lib/purchases';
import { useStore } from '@/lib/store';
import type { Subscription } from '@/lib/subscriptions';
import type { CardDue, Transaction } from '@/lib/types';
import { t, tf } from '@/lib/i18n';
import { homeWidgetVisible, loadHomeWidgetPreferences, type HomeWidgetId, type HomeWidgetPreferences } from '@/lib/home-widgets';
import { defaultHomeWidgetPreferences } from '@/lib/home-widget-preferences';
import { hasRecapActivity, recapCandidates, type RecapDescriptor } from '@/lib/recap';
import { loadViewedRecaps } from '@/lib/recap-view-state';

/** Presentation-only vocabulary; every amount still comes from the shared ledger. */
const copy = {
  en: { journal: 'Your money, in view', month: 'THIS PERIOD', activity: 'Recent transactions',
    add: 'Add an entry', breakdown: 'View spending', upcoming: 'Upcoming',
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
export default function JournalHomeScreen() {
  const theme = useTheme();
  const language = useLanguage();
  const words = copy[language === 'ar' ? 'ar' : 'en'];
  const largeText = useLargeTextLayout();
  const focused = useIsFocused();
  const privacyGateCleared = usePrivacyGateCleared();
  const router = useRouter();
  const toast = useToast();
  const {
    state,
    getStateSnapshot,
    getStateGeneration,
    applyFxUpdates,
    setCaptureOptOut,
    beginHistoryImport,
  } = useStore();
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
  const [recapEntry, setRecapEntry] = useState<{ descriptor: RecapDescriptor; unread: boolean } | null>(null);
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
    void loadHomeWidgetPreferences().then((preferences) => {
      if (!alive) return;
      setHomeWidgets((current) => sameHomeWidgets(current, preferences) ? current : preferences);
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
    // Status/progress changes must not recompute the financial projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.hydrated, state.transactions, state.accounts, state.budgets, state.bills,
      state.cardDues, state.notSubscriptions, state.merchantOverrides, state.language,
      state.ledgerMoney, state.marketId, period, projectionDay]);
  const payments = dashboard.upcoming.items;
  const insightWidgetVisible = homeWidgetVisible(homeWidgets, 'insight');
  const historyAnalysisBlocked = state.historyImport !== null && state.historyImport.status !== 'complete';
  const homeInsight = useMemo(() =>
    homeAnalysisReady && insightWidgetVisible && !historyAnalysisBlocked
      ? measureRuntimeOperation('home-insight', () => projectDashboardInsight(state, period, now))
      : null,
    // Capture/progress state must not restart historical analysis. The optional
    // insight is computed only after Home is already interactive and only while
    // the user has that widget enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [homeAnalysisReady, insightWidgetVisible, historyAnalysisBlocked, state.transactions, state.accounts, state.budgets,
      state.notSubscriptions, state.marketId, period, projectionDay]);
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
    const pending = state.transactions.filter((transaction) => transaction.fxSource === 'fallback').slice(0, 16);
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
      style={({ pressed }) => [styles.assistantCard, { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
      <Icon name="spark" size={18} color={theme.primary} />
      <ThemedText type="smallBold" style={styles.grow}>{t('homeWidgetAssistantTitle')}</ThemedText>
      <Icon name="chevron-right" size={18} color={theme.textSecondary} />
    </Pressable>;
    if (id === 'insight') {
      const insight = homeInsight;
      return insight ? <Pressable key={id} testID="home-widget-insight" accessibilityRole="button"
        onPress={() => insight.href && router.push(insight.href as never)} style={[styles.widgetCard, { borderColor: theme.cardBorder }]}>
        <View style={styles.grow}><ThemedText type="micro" themeColor="textSecondary">{t('homeWidgetInsightTitle')}</ThemedText>
          <ThemedText type="smallBold">{insight.title}</ThemedText><ThemedText type="meta" themeColor="textSecondary">{insight.body}</ThemedText></View>
        {insight.href ? <Icon name="chevron-right" size={18} color={theme.textSecondary} /> : null}
      </Pressable> : null;
    }
    if (id === 'due' || id === 'upcoming') {
      const due = payments.filter(item => id === 'due' ? (item.overdue || item.urgent) : (!item.overdue && !item.urgent));
      if (due.length === 0) return null;
      return <View key={id} style={styles.section} testID={`home-widget-${id}`}>
        <View style={styles.sectionHeading}><ThemedText type="smallBold" style={styles.sectionTitle}>{id === 'due' ? t('homeWidgetDueTitle') : words.upcoming}</ThemedText>
          <Pressable onPress={() => router.push('/bills')} accessibilityRole="button" accessibilityLabel={words.more} style={styles.smallAction}><Icon name="chevron-right" size={18} color={theme.text} /></Pressable></View>
        <View style={[styles.cardGroup, { borderColor: theme.cardBorder }]}>{due.slice(0, 2).map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => openPayment(item)} style={[styles.paymentRow, { borderBottomColor: theme.cardBorder }]}>
          <View style={styles.grow}><ThemedText type="smallBold">{item.title}</ThemedText><ThemedText type="meta" themeColor="textSecondary">{daysPhrase(item.daysLeft)}</ThemedText></View>
          <ThemedText type="smallBold" tabular>{formatAmount(item.amountFils)}</ThemedText></Pressable>)}</View>
      </View>;
    }
    return <View key={id} style={styles.section} testID="home-widget-activity">
      <View style={styles.sectionHeading}><ThemedText type="smallBold" style={styles.sectionTitle}>{words.activity}</ThemedText>
        <Pressable onPress={() => router.push('/transactions')} accessibilityRole="button" style={styles.smallAction}><Icon name="search" size={18} color={theme.text} /><ThemedText type="meta">{t('allActivity')}</ThemedText></Pressable></View>
      <View style={[styles.cardGroup, { borderColor: theme.cardBorder }]}>{dashboard.activityRows.slice(0, 5).map(transaction =>
        <TransactionRow key={transaction.id} transaction={transaction} account={dashboard.accountById.get(transaction.accountId)} onPress={setEntry} internal={dashboard.internalTransactionIds.has(transaction.id)} />)}</View>
      {dashboard.activityRows.length === 0 && <EmptyMonth monthName={periodLabel(period)} onReadInbox={() => void onRefresh()} primaryLabel={t('checkBankAlerts')} onAddManually={() => router.push('/add-transaction')} />}
    </View>;
  };

  return <>
    <ScreenScaffold tabbed headerMode="inline" contentStyle={styles.screen}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}>
      {!state.hydrated ? <View accessibilityRole="progressbar" accessibilityLabel={t('loadingLedger')} style={styles.loading}>
        <SkeletonRows count={1} height={160} /><SkeletonRows count={4} height={66} />
      </View> : <>
        <ReferenceHomeSummary theme={theme} language={language} largeText={largeText}
          greeting={greeting} dateLabel={dateLabel} periodLabel={periodLabel(period)}
          incomeFils={dashboard.hero.incomeFils} expenseFils={dashboard.hero.expenseFils}
          netFils={dashboard.hero.netFils}
          moneySpec={moneySpec}
          onPeriod={() => setPeriodOpen(true)} onAdd={() => router.push('/add-transaction')}
          onSettings={() => router.push('/settings')}
          onIncome={() => router.push('/transactions?type=income')}
          onSpending={() => router.push('/flow')}
          brandMark={openRecap ? <RecapLogoTrigger
            unread={recapEntry?.unread ?? false}
            accessibilityLabel={language === 'ar'
              ? `ملخص وفرة · ${recapEntry?.descriptor.label ?? ''}`
              : `Wafra Recap · ${recapEntry?.descriptor.label ?? ''}`}
            onPress={openRecap}
          /> : undefined} />
        {/* First week: one truthful progress surface. After it retires, blocking
            history states keep their existing compact recovery card. */}
        {moneyPicture
          ? <MoneyPictureProgress model={moneyPicture} onResume={retryHistory} />
          : history ? <HistoryReadingStatus progress={history} onResume={retryHistory} /> : null}

        {homeWidgets.order.map(renderWidget)}

        <View style={[styles.captureFooter, { borderTopColor: theme.cardBorder }]} testID="journal-import-controls">
          <Pressable accessibilityRole="button" accessibilityLabel={`${words.import}. ${captureLabel}`}
            disabled={status === 'checking' || status === 'unsupported' || refreshing}
            onPress={openCapture} style={styles.captureRow}>
            <Icon name="mail" size={17} color={healthy ? theme.primary : theme.warning} />
            <View style={styles.grow}><ThemedText type="smallBold">{words.import}</ThemedText>
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
      </>}
    </ScreenScaffold>
    <PeriodSheet visible={periodOpen} onClose={() => setPeriodOpen(false)} />
    <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} />
    <CardPaymentSheet due={cardDue} onClose={() => setCardDue(null)} />
    <BillDetailSheet subscription={recurring} onClose={() => setRecurring(null)} />
  </>;
}

const styles = StyleSheet.create({
  screen: { gap: 24 },
  loading: { gap: 20, paddingTop: 20 },
  grow: { flex: 1, minWidth: 0 },
  section: { paddingTop: 2, paddingBottom: 0 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 2 },
  sectionTitle: { fontSize: 17, lineHeight: 24 },
  smallAction: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  cardGroup: { borderTopWidth: 1, overflow: 'hidden' },
  dateLabel: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 12, paddingBottom: 0 },
  dateDot: { height: 4, width: 4, borderRadius: 2 },
  dateRule: { height: StyleSheet.hairlineWidth, flex: 1 },
  importNotice: { borderStartWidth: 3, paddingStart: 14, paddingVertical: 10, marginBottom: 4, flexDirection: 'row', gap: 12, alignItems: 'center' },
  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10, minHeight: 74, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  paymentDate: { width: 38, height: 38, borderWidth: 0, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  paymentAmount: { flexShrink: 1 },
  inlineAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  captureFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, marginTop: 16, paddingBottom: 16 },
  captureRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 },
  footerAction: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  assistantCard: { minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  widgetCard: { minHeight: 72, borderTopWidth: 1, borderBottomWidth: 1, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
});

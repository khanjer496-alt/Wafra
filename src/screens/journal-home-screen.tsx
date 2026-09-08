import { HistoryReadingStatus } from '@/components/history-reading-status';
import { TransferReviewNotice } from '@/components/transfer-review-notice';
import { reconcileTransfers } from '@/lib/transfer-reconciliation';
import { liveAccountIds } from '@/lib/ledger';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
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
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import { EmptyMonth, SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { useAutoImport, type CaptureSurfaceState } from '@/hooks/use-auto-import';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { projectDashboard } from '@/lib/dashboard-projection';
import { openSmsPermissionSettings } from '@/lib/auto-import';
import { buildReferenceFxUpdates } from '@/lib/fx';
import { formatAmount, shortDate } from '@/lib/format';
import { daysPhrase, type Outgoing } from '@/lib/leaving-soon';
import { markLaunchPhase } from '@/lib/launch-performance';
import { ledgerCurrencyCode, marketCurrencyCode } from '@/lib/markets';
import { ledgerMoneySpec } from '@/lib/ledger-money';
import { syncPaymentReminders } from '@/lib/notifications';
import { inPeriod, periodLabel } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { isProActive } from '@/lib/purchases';
import { useStore } from '@/lib/store';
import type { Subscription } from '@/lib/subscriptions';
import type { CardDue, Transaction } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

/** Presentation-only vocabulary; every amount still comes from the shared ledger. */
const copy = {
  en: { journal: 'Your money, in view', month: 'THIS PERIOD', activity: 'Recent transactions',
    add: 'Add an entry', breakdown: 'View spending', upcoming: 'Upcoming',
    import: 'Bank alerts', paused: 'History import paused', resume: 'Resume',
    review: 'Review alerts', more: 'View all payments', accounts: 'Your accounts',
    income: 'Money in', spent: 'Spent', netNote: 'Income minus spending · not your bank balance',
    progress: 'Reading history', attention: 'Needs your attention' },
  ar: { journal: 'أموالك بوضوح', month: 'هذه الفترة', activity: 'حركتك المالية',
    add: 'إضافة حركة', breakdown: 'عرض الإنفاق', upcoming: 'الدفعات القادمة',
    import: 'تنبيهات البنك', paused: 'استيراد السجل متوقف مؤقتاً', resume: 'متابعة',
    review: 'مراجعة التنبيهات', more: 'عرض كل الدفعات', accounts: 'حساباتك',
    income: 'الدخل', spent: 'الإنفاق', netNote: 'الدخل ناقص الإنفاق · ليس رصيد البنك',
    progress: 'قراءة السجل', attention: 'يحتاج إلى انتباهك' },
} as const;

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
  const { state, getStateSnapshot, getStateGeneration, applyFxUpdates, setCaptureOptOut, beginHistoryImport } = useStore();
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
    if (focused && privacyGateCleared && state.hydrated && state.onboarded) {
      markLaunchPhase('first-usable-home');
    }
  }, [focused, privacyGateCleared, state.hydrated, state.onboarded]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(new Date());
    });
    return () => listener.remove();
  }, []);

  const reviewCount = state.reviewTray.pending.filter((item) => item.expiresAt > now.getTime()).length;
  const pendingTransfers = useMemo(() => {
    const pending = reconcileTransfers(state.transactions, state.accounts).pendingIds;
    const live = liveAccountIds(state.accounts);
    let pendingCount = 0, incomingFils = 0, outgoingFils = 0;
    for (const row of state.transactions) {
      if (!pending.has(row.id) || !live.has(row.accountId) || !inPeriod(row.date, period)) continue;
      pendingCount += 1;
      if (row.type === 'income') incomingFils += row.amountFils;
      else outgoingFils += row.amountFils;
    }
    return { pendingCount, incomingFils, outgoingFils };
  }, [state.transactions, state.accounts, period]);
  const hasPendingReview = reviewCount > 0;
  const dashboard = useMemo(() => projectDashboard({ state, period, now, surface: 'home', includeInsights: false }),
    // Status/progress changes must not recompute the financial projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.hydrated, state.transactions, state.accounts, state.budgets, state.bills,
      state.cardDues, state.notSubscriptions, state.merchantOverrides, state.language,
      state.ledgerMoney, state.marketId, period, now, hasPendingReview]);
  const payments = dashboard.upcoming.items;
  const history = state.historyImport?.status !== 'complete' ? state.historyImport : null;
  const status: CaptureSurfaceState = state.captureOptOut || needsPermission ? 'off'
    : Platform.OS === 'android' && !isProActive(state) ? 'paused' : captureState;

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
    requestReminderSync();
  }, [getStateGeneration, requestReminderSync, runAutoImport, toast]);

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
  const greeting = language === 'ar'
    ? now.getHours() < 12 ? 'صباح الخير' : 'مساء الخير'
    : now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
  const dateLabel = now.toLocaleDateString(language === 'ar' ? 'ar-AE' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

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
          onSpending={() => router.push('/flow')} />
        <TransferReviewNotice {...pendingTransfers} onPress={() => router.push('/review-transfers')} />

        {/* Blocking states stay visible, but a healthy connection is not a banner. */}
        {history && <HistoryReadingStatus progress={history} onResume={retryHistory} />}

        {payments.length > 0 && <View style={styles.section} testID="journal-payments">
          <View style={styles.sectionHeading}><ThemedText type="smallBold" style={styles.sectionTitle}>{words.upcoming}</ThemedText>
            <Pressable onPress={() => router.push('/bills')} accessibilityRole="button" accessibilityLabel={words.more} style={styles.smallAction}>
              <Icon name="chevron-right" size={18} color={theme.text} /></Pressable></View>
          <View style={[styles.cardGroup, { borderColor: theme.cardBorder }]}>{payments.slice(0, 2).map((item) => <Pressable key={item.id} accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${shortDate(item.dateISO)}, ${formatAmount(item.amountFils)} ${ledgerCurrencyCode()}`}
            onPress={() => openPayment(item)} style={[styles.paymentRow, { borderBottomColor: theme.cardBorder }]}>
            <View style={[styles.paymentDate, { borderColor: theme.cardBorder, backgroundColor: 'transparent' }]}>
              <Icon name={item.kind === 'card' ? 'wallet' : 'receipt'} size={20} color={theme.primary} />
            </View>
            <View style={styles.grow}><ThemedText type="smallBold">{item.title}</ThemedText>
              <ThemedText type="meta" style={{ color: item.overdue || item.urgent ? theme.warning : theme.textSecondary }}>
                {daysPhrase(item.daysLeft)}</ThemedText></View>
            <ThemedText type="smallBold" tabular style={styles.paymentAmount}>{formatAmount(item.amountFils)}</ThemedText>
          </Pressable>)}</View>
          {payments.length > 2 && <Pressable onPress={() => router.push('/bills')} accessibilityRole="button" style={styles.inlineAction}>
            <ThemedText type="meta">{words.more} ({payments.length})</ThemedText><Icon name="chevron-right" size={15} color={theme.text} />
          </Pressable>}
        </View>}

        <View style={styles.section} testID="journal-activity">
          <View style={styles.sectionHeading}>
            <ThemedText type="smallBold" style={styles.sectionTitle}>{words.activity}</ThemedText>
            <Pressable onPress={() => router.push('/transactions')} accessibilityRole="button" style={styles.smallAction}>
              <Icon name="search" size={18} color={theme.text} />
              <ThemedText type="meta">{t('allActivity')}</ThemedText>
            </Pressable>
          </View>
          <View style={[styles.cardGroup, { borderColor: theme.cardBorder }]}>{dashboard.activityRows.slice(0, 5).map((transaction, index) => <React.Fragment key={transaction.id}>
            {(index === 0 || transaction.date !== dashboard.activityRows[index - 1].date) &&
              <View style={styles.dateLabel}><View style={[styles.dateDot, { backgroundColor: theme.textTertiary }]} />
                <ThemedText type="meta" themeColor="textSecondary">{shortDate(transaction.date)}</ThemedText>
                <View style={[styles.dateRule, { backgroundColor: theme.cardBorder }]} />
              </View>}
            <TransactionRow transaction={transaction} account={dashboard.accountById.get(transaction.accountId)}
              onPress={setEntry} internal={dashboard.internalTransactionIds.has(transaction.id)} />
          </React.Fragment>)}</View>
          {dashboard.activityRows.length === 0 && <EmptyMonth monthName={periodLabel(period)}
            onReadInbox={() => void onRefresh()} primaryLabel={t('checkBankAlerts')}
            onAddManually={() => router.push('/add-transaction')} />}
        </View>

        <View style={[styles.captureFooter, { borderTopColor: theme.cardBorder }]} testID="journal-import-controls">
          <Pressable accessibilityRole="button" accessibilityLabel={`${words.import}. ${captureLabel}`}
            disabled={status === 'checking' || status === 'unsupported' || refreshing}
            onPress={openCapture} style={styles.captureRow}>
            <Icon name="mail" size={17} color={healthy ? theme.primary : theme.warning} />
            <View style={styles.grow}><ThemedText type="smallBold">{words.import}</ThemedText>
              <ThemedText type="meta" themeColor="textSecondary">{captureLabel}</ThemedText></View>
            <Icon name="chevron-right" size={16} color={theme.textSecondary} />
          </Pressable>
          {reviewCount > 0 ? <Pressable onPress={() => router.push('/review-alerts')} accessibilityRole="button" style={styles.footerAction}>
            <ThemedText type="smallBold" style={{ color: theme.warning }}>{words.review} · {reviewCount}</ThemedText>
            <Icon name="chevron-right" size={16} color={theme.warning} /></Pressable>
          : dashboard.uncategorised.shouldPrompt ? <Pressable onPress={() => router.push('/categorise')} accessibilityRole="button" style={styles.footerAction}>
            <ThemedText type="meta">{tf('uncategorisedMerchantCount', { count: dashboard.uncategorised.summary.merchants.length,
              s: dashboard.uncategorised.summary.merchants.length === 1 ? '' : 's' })}</ThemedText>
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
});

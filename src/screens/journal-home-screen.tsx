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
import { Money } from '@/components/ui/money';
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
import { ledgerCurrencyCode } from '@/lib/markets';
import { syncPaymentReminders } from '@/lib/notifications';
import { periodLabel } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { isProActive } from '@/lib/purchases';
import { useStore } from '@/lib/store';
import type { Subscription } from '@/lib/subscriptions';
import type { CardDue, Transaction } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

/** Presentation-only vocabulary; every amount still comes from the shared ledger. */
const copy = {
  en: { journal: 'Your money, in view', month: 'THIS PERIOD', activity: 'Your activity',
    add: 'Add an entry', breakdown: 'View spending', upcoming: 'Coming up',
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
  const { state, getStateSnapshot, applyFxUpdates, setCaptureOptOut, beginHistoryImport } = useStore();
  const { period } = usePeriod();
  // The tab shell still owns capture. This screen only observes or explicitly joins it.
  const { runAutoImport, needsPermission, captureState } = useAutoImport(false, true);
  const [now, setNow] = useState(() => new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [paymentsExpanded, setPaymentsExpanded] = useState(false);
  const [entry, setEntry] = useState<Transaction | null>(null);
  const [cardDue, setCardDue] = useState<CardDue | null>(null);
  const [recurring, setRecurring] = useState<Subscription | null>(null);
  const lastFxAttempt = useRef('');

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

  const dashboard = useMemo(() => projectDashboard({ state, period, now, includeInsights: false }),
    // Status/progress changes must not recompute the financial projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.hydrated, state.transactions, state.accounts, state.budgets, state.bills,
      state.cardDues, state.notSubscriptions, state.merchantOverrides, state.language,
      state.ledgerMoney, state.marketId, period, now]);
  const payments = useMemo(() => dashboard.upcoming.items.filter((item) => item.kind !== 'subscription'),
    [dashboard.upcoming.items]);
  const reviewCount = state.reviewTray.pending.filter((item) => item.expiresAt > now.getTime()).length;
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

  const onRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await runAutoImport(true);
      await syncPaymentReminders(getStateSnapshot());
      setNow(new Date());
    } catch {
      toast.show(t('captureRefreshFailed'), { tone: 'error' });
    } finally { setRefreshing(false); }
  }, [getStateSnapshot, refreshing, runAutoImport, toast]);

  const openCapture = () => {
    if (status === 'paused') { router.push('/pro'); return; }
    if (state.captureOptOut) {
      void setCaptureOptOut(false).then(() => {
        if (Platform.OS === 'ios') router.push('/ios-setup');
      }).catch(() => Alert.alert(t('capturePreferenceFailed')));
    } else if (Platform.OS === 'ios' && (status === 'off' || status === 'needs-automation')) {
      router.push('/ios-setup');
    } else if (status === 'queue-warning') router.push('/settings');
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
  const cashRatio = dashboard.hero.incomeFils > 0
    ? Math.max(0, Math.min(1, dashboard.hero.expenseFils / dashboard.hero.incomeFils)) : null;

  return <>
    <ScreenScaffold tabbed headerMode="inline"
      header={{ title: 'Wafra', actions: [
        { label: words.add, icon: 'plus', onPress: () => router.push('/add-transaction') },
        { label: t('settingsTitle'), icon: 'sliders', onPress: () => router.push('/settings') },
      ] }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />}>
      {!state.hydrated ? <View accessibilityRole="progressbar" accessibilityLabel={t('loadingLedger')} style={styles.loading}>
        <SkeletonRows count={1} height={160} /><SkeletonRows count={4} height={66} />
      </View> : <>
        <View style={styles.masthead}>
          <ThemedText type="meta" themeColor="textSecondary">{words.journal}</ThemedText>
          <Pressable onPress={() => setPeriodOpen(true)} accessibilityRole="button"
            accessibilityLabel={periodLabel(period)} style={[styles.period, { borderColor: theme.cardBorder }]}>
            <ThemedText type="smallBold">{periodLabel(period)}</ThemedText>
            <Icon name="chevron-down" size={14} color={theme.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.spread} testID="journal-summary">
          <ThemedText type="meta" style={styles.eyebrow} themeColor="textSecondary">{t('netAfterSpending')}</ThemedText>
          <Money fils={dashboard.hero.netFils} type="display" color={theme.text} style={styles.net} />
          <ThemedText type="meta" themeColor="textTertiary">{words.netNote}</ThemedText>
          <View style={[styles.facts, largeText && styles.factsLarge]}>
            <Pressable style={[styles.fact, { borderStartColor: theme.income }]} accessibilityRole="button"
              accessibilityLabel={`${words.income} ${formatAmount(dashboard.hero.incomeFils)} ${ledgerCurrencyCode()}`}
              onPress={() => router.push('/transactions?type=income')}>
              <View style={styles.factLabel}><Icon name="arrow-down" size={14} color={theme.income} />
                <ThemedText type="meta" themeColor="textSecondary">{words.income}</ThemedText></View>
              <ThemedText type="smallBold" tabular>{formatAmount(dashboard.hero.incomeFils)}</ThemedText>
            </Pressable>
            <Pressable style={[styles.fact, { borderStartColor: theme.textSecondary }]} accessibilityRole="button"
              accessibilityLabel={`${words.spent} ${formatAmount(dashboard.hero.expenseFils)} ${ledgerCurrencyCode()}`}
              onPress={() => router.push('/transactions?type=expense')}>
              <View style={styles.factLabel}><Icon name="arrow-up" size={14} color={theme.textSecondary} />
                <ThemedText type="meta" themeColor="textSecondary">{words.spent}</ThemedText></View>
              <ThemedText type="smallBold" tabular>{formatAmount(dashboard.hero.expenseFils)}</ThemedText>
            </Pressable>
          </View>
          {cashRatio !== null && <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
            style={[styles.balanceTrack, { backgroundColor: theme.backgroundSelected }]}>
            <View style={[styles.spentTrack, { width: `${cashRatio * 100}%`, backgroundColor: theme.primary }]} />
          </View>}
          <Pressable style={styles.inlineAction} accessibilityRole="button" onPress={() => router.push('/flow')}>
            <ThemedText type="meta" themeColor="textSecondary">{words.breakdown}</ThemedText>
            <Icon name="chevron-right" size={15} color={theme.textSecondary} />
          </Pressable>
        </View>

        {/* Blocking states stay visible, but a healthy connection is not a banner. */}
        {history && <View style={[styles.importNotice, { borderStartColor: history.status === 'failed' ? theme.warning : theme.primary }]}>
          <View style={styles.grow} accessibilityLiveRegion="polite">
            <ThemedText type="smallBold">{history.status === 'failed' ? words.attention
              : history.status === 'paused' ? words.paused : words.progress}</ThemedText>
            <ThemedText type="meta" themeColor="textSecondary">{history.status === 'failed'
              ? t(history.error === 'inbox-access' ? 'historyImportAccessBody' : 'historyImportSavedBody')
              : tf('historyImportLiveProgress', { scanned: history.scanned, found: history.found })}</ThemedText>
          </View>
          {history.status !== 'running' && <Pressable onPress={retryHistory} accessibilityRole="button" style={styles.smallAction}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>{history.error === 'inbox-access'
              ? t('openPhoneSettings') : words.resume}</ThemedText>
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
          {dashboard.activityRows.map((transaction, index) => <React.Fragment key={transaction.id}>
            {(index === 0 || transaction.date !== dashboard.activityRows[index - 1].date) &&
              <View style={styles.dateLabel}><View style={[styles.dateDot, { backgroundColor: theme.textTertiary }]} />
                <ThemedText type="meta" themeColor="textSecondary">{shortDate(transaction.date)}</ThemedText>
                <View style={[styles.dateRule, { backgroundColor: theme.cardBorder }]} />
              </View>}
            <TransactionRow transaction={transaction} account={dashboard.accountById.get(transaction.accountId)}
              onPress={setEntry} internal={dashboard.internalTransactionIds.has(transaction.id)} />
          </React.Fragment>)}
          {dashboard.activityRows.length === 0 && <EmptyMonth monthName={periodLabel(period)}
            onReadInbox={() => void onRefresh()} primaryLabel={t('checkBankAlerts')}
            onAddManually={() => router.push('/add-transaction')} />}
        </View>

        {payments.length > 0 && <View style={styles.section} testID="journal-payments">
          <View style={styles.sectionHeading}><ThemedText type="smallBold" style={styles.sectionTitle}>{words.upcoming}</ThemedText>
            <Pressable onPress={() => router.push('/bills')} accessibilityRole="button" accessibilityLabel={words.more} style={styles.smallAction}>
              <Icon name="chevron-right" size={18} color={theme.text} /></Pressable></View>
          {(paymentsExpanded ? payments : payments.slice(0, 3)).map((item) => <Pressable key={item.id} accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${shortDate(item.dateISO)}, ${formatAmount(item.amountFils)} ${ledgerCurrencyCode()}`}
            onPress={() => openPayment(item)} style={[styles.paymentRow, { borderBottomColor: theme.cardBorder }]}>
            <View style={[styles.paymentDate, { borderColor: theme.cardBorder }]}>
              <ThemedText type="smallBold" tabular>{shortDate(item.dateISO)}</ThemedText>
            </View>
            <View style={styles.grow}><ThemedText type="smallBold">{item.title}</ThemedText>
              <ThemedText type="meta" style={{ color: item.overdue || item.urgent ? theme.warning : theme.textSecondary }}>
                {daysPhrase(item.daysLeft)}</ThemedText></View>
            <ThemedText type="smallBold" tabular style={styles.paymentAmount}>{formatAmount(item.amountFils)}</ThemedText>
          </Pressable>)}
          {payments.length > 3 && !paymentsExpanded && <Pressable onPress={() => setPaymentsExpanded(true)} accessibilityRole="button" style={styles.inlineAction}>
            <ThemedText type="meta">{words.more} ({payments.length})</ThemedText><Icon name="chevron-right" size={15} color={theme.text} />
          </Pressable>}
        </View>}

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
          : dashboard.unreadFormats.shouldPrompt ? <Pressable onPress={() => router.push('/accuracy')} accessibilityRole="button" style={styles.footerAction}>
            <ThemedText type="meta">{tf('unreadFormatCount', { count: dashboard.unreadFormats.count,
              s: dashboard.unreadFormats.count === 1 ? '' : 's' })}</ThemedText>
            <Icon name="chevron-right" size={16} color={theme.textSecondary} /></Pressable> : null}
          <Pressable onPress={() => router.push('/wallet')} accessibilityRole="button" style={styles.footerAction}>
            <ThemedText type="meta" themeColor="textSecondary">{words.accounts}</ThemedText>
            <Icon name="chevron-right" size={16} color={theme.textSecondary} /></Pressable>
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
  loading: { gap: 20, paddingTop: 20 },
  grow: { flex: 1, minWidth: 0 },
  masthead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', paddingBottom: 16 },
  period: { minHeight: 48, paddingHorizontal: 12, gap: 8, flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 24 },
  spread: { paddingTop: 12, paddingBottom: 14, gap: 10 },
  eyebrow: { letterSpacing: 0.5 },
  net: { paddingVertical: 2 },
  facts: { flexDirection: 'row', gap: 28, marginTop: 16 },
  factsLarge: { flexDirection: 'column', gap: 16 },
  fact: { flex: 1, minHeight: 56, borderStartWidth: 2, paddingStart: 14, gap: 6 },
  factLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  balanceTrack: { height: 4, borderRadius: 2, marginTop: 10, overflow: 'hidden' },
  spentTrack: { height: 4, borderRadius: 2 },
  inlineAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  section: { paddingTop: 14, paddingBottom: 16 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 },
  sectionTitle: { fontSize: 20, lineHeight: 28 },
  smallAction: { minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dateLabel: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingTop: 16, paddingBottom: 6 },
  dateDot: { height: 4, width: 4, borderRadius: 2 },
  dateRule: { height: StyleSheet.hairlineWidth, flex: 1 },
  importNotice: { borderStartWidth: 3, paddingStart: 14, paddingVertical: 10, marginBottom: 12, flexDirection: 'row', gap: 12, alignItems: 'center' },
  paymentRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, minHeight: 76, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  paymentDate: { minWidth: 64, minHeight: 48, padding: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  paymentAmount: { flexShrink: 1 },
  captureFooter: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 14, marginTop: 8, paddingBottom: 16 },
  captureRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12 },
  footerAction: { minHeight: 48, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
});

/**
 * Home v3 — rebuilt from scratch as composed sections.
 *
 * Layout contract:
 *   Hero (period net) → dues → insights rail → subscriptions line →
 *   upcoming bills (live month only) → budgets (month mode only) → recent.
 * Money semantics: the hero is IN minus OUT for the selected period; real
 * account balances live in Wallet. Dues/subscriptions describe NOW and stay
 * visible in every period.
 */
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';

import { InsightCard } from '@/components/insight-card';
import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionRow } from '@/components/transaction-row';
import { CountUpAmount } from '@/components/ui/count-up';
import { Icon } from '@/components/ui/icon';
import { ProgressBar } from '@/components/ui/progress-bar';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/lib/i18n';
import {
  buildImportPlan,
  hasSmsPermission,
  isSmsScanningAvailable,
  requestSmsPermission,
  scanInbox,
} from '@/lib/auto-import';
import { billsForMonth } from '@/lib/bills';
import { openDues } from '@/lib/cards';
import { getCategory } from '@/lib/categories';
import { formatAED, formatCompactAED, greetingForHour, shortDate } from '@/lib/format';
import { REPORT_PROMPT_THRESHOLD, unreadFormatCount } from '@/lib/accuracy';
import { buildInsights, spentInMonthForCategory, summarizeMonth } from '@/lib/insights';
import { isProActive } from '@/lib/purchases';
import { requestNotificationPermission, syncPaymentReminders } from '@/lib/notifications';
import { inPeriod, isCurrentMonth, periodLabel, type Period } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { useStore } from '@/lib/store';
import {
  activeSubscriptions,
  detectSubscriptions,
  daysUntilNext,
  subscriptionsMonthlyTotal,
  trueSubscriptions,
  type Subscription,
} from '@/lib/subscriptions';
import type { AppState } from '@/lib/types';


// Once per app session: auto-import + notification sync.
let autoImportRan = false;

/* ── Section scaffolding ─────────────────────────────────────────────── */

function Section({
  title,
  action,
  onAction,
  icon,
  delay,
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  icon?: React.ComponentProps<typeof Icon>['name'];
  delay: number;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(350)} style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          {icon && <Icon name={icon} size={16} color={theme.gold} />}
          <ThemedText type="micro" themeColor="textSecondary">
            {title}
          </ThemedText>
        </View>
        {action && (
          <ThemedText type="small" themeColor="textSecondary" onPress={onAction}>
            {action}
          </ThemedText>
        )}
      </View>
      {children}
    </Animated.View>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────── */

function Hero({
  period,
  live,
  netFils,
  incomeFils,
  expenseFils,
  onOpenPeriod,
}: {
  period: Period;
  live: boolean;
  netFils: number;
  incomeFils: number;
  expenseFils: number;
  onOpenPeriod: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const caption =
    (netFils >= 0 ? t('saved') : t('overspent')) +
    ' ' +
    (live ? t('soFarThisMonth') : period.mode === 'all' ? t('allTime') : `${t('inWord')} ${periodLabel(period)}`) +
    ` · ${t('inMinusOut')}`;

  return (
    <Animated.View entering={FadeInDown.duration(350)} style={styles.hero}>
      <View style={styles.heroTopRow}>
        <Pressable onPress={onOpenPeriod} hitSlop={8} style={styles.periodChipWrap}>
          <ThemedText type="small" themeColor="textSecondary">
            {greetingForHour(new Date().getHours())} ·{' '}
          </ThemedText>
          <ThemedText
            type="small"
            style={{ color: live ? theme.textSecondary : theme.primary, fontWeight: '700' }}>
            {periodLabel(period)}
          </ThemedText>
          <Icon name="chevron-right" size={12} color={theme.textSecondary} />
        </Pressable>
        <Pressable onPress={() => router.push('/stats')} hitSlop={8}>
          <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>
            {t('report')}
          </ThemedText>
        </Pressable>
      </View>

      {Math.abs(netFils) >= 1_000_000_000 ? (
        <ThemedText type="display" tabular>
          {netFils < 0 ? '−' : ''}AED {formatCompactAED(netFils)}
        </ThemedText>
      ) : (
        <CountUpAmount fils={netFils} type="display" />
      )}
      <ThemedText type="micro" themeColor="textSecondary">
        {caption}
      </ThemedText>

      <View style={styles.heroStats}>
        {(
          [
            ['In', incomeFils, theme.income, '/transactions?type=income'],
            ['Out', expenseFils, theme.expense, '/transactions?type=expense'],
          ] as const
        ).map(([label, fils, color, href]) => (
          <Pressable key={label} onPress={() => router.push(href)} hitSlop={6} style={styles.heroStat}>
            <View style={[styles.heroDot, { backgroundColor: color }]} />
            <ThemedText type="small" themeColor="textSecondary">
              {label}{' '}
              <ThemedText type="smallBold" tabular style={{ color }}>
                {formatAED(fils, { decimals: false })}
              </ThemedText>
            </ThemedText>
            <Icon name="chevron-right" size={11} color={theme.textSecondary} />
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

/* ── Dues ─────────────────────────────────────────────────────────────── */

function DuesSection({ state, now }: { state: AppState; now: Date }) {
  const theme = useTheme();
  const router = useRouter();
  const dues = useMemo(() => openDues(state, now), [state, now]);
  if (dues.length === 0) return null;
  return (
    <Section title={t('cardPayments')} action={t('tabWallet')} onAction={() => router.push('/wallet')} delay={60}>
      {dues.slice(0, 2).map(({ due, status, daysLeft, remainingFils }) => {
        const account = state.accounts.find((a) => a.id === due.accountId);
        const urgent = status === 'urgent' || status === 'overdue';
        return (
          <Pressable key={due.id} onPress={() => router.push('/wallet')} style={styles.lineRow}>
            <View style={styles.lineTitle}>
              <Icon name="wallet" size={14} color={theme.textSecondary} />
              <ThemedText type="small" numberOfLines={1} style={{ flexShrink: 1 }}>
                {account?.name ?? 'Card'}
              </ThemedText>
            </View>
            <ThemedText type="small" style={{ color: urgent ? theme.expense : theme.textSecondary }}>
              {status === 'overdue' ? `${-daysLeft}d overdue` : `pay by ${shortDate(due.dueDate)}`}
            </ThemedText>
            <ThemedText
              type="smallBold"
              tabular
              style={[styles.lineAmount, urgent && { color: theme.expense }]}>
              {formatAED(remainingFils, { decimals: false })}
            </ThemedText>
          </Pressable>
        );
      })}
    </Section>
  );
}

/* ── Subscriptions line ──────────────────────────────────────────────── */

function SubscriptionsLine({ subs, now }: { subs: Subscription[]; now: Date }) {
  const router = useRouter();
  const theme = useTheme();
  const next = useMemo(() => {
    const upcoming = subs
      .map((s) => ({ s, d: daysUntilNext(s, now) }))
      .filter((x) => x.d >= 0)
      .sort((a, b) => a.d - b.d);
    return upcoming[0] ?? null;
  }, [subs, now]);
  if (subs.length === 0) return null;
  return (
    <Animated.View entering={FadeInDown.delay(140).duration(350)}>
      <Pressable onPress={() => router.push('/bills')} style={styles.subsRow}>
        <Icon name="repeat" size={14} color={theme.textSecondary} />
        <ThemedText type="small">
          {subs.length} {subs.length === 1 ? t('subscriptionWord') : t('subscriptionsWord')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={styles.subsNext}>
          {next ? `${next.s.title} in ${next.d}d` : ''}
        </ThemedText>
        <ThemedText type="smallBold" tabular>
          {formatAED(subscriptionsMonthlyTotal(subs), { decimals: false })}/mo
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

/* ── Upcoming bills (live month only) ─────────────────────────────────── */

/**
 * The parser only improves if the formats it misreads come back to us, and
 * the report screen was buried in Settings where nobody found it. This
 * surfaces once enough distinct formats have piled up to be worth a tap, and
 * says how many rows it would fix so the ask is concrete rather than a chore.
 */
function UnreadFormatsPrompt({ state }: { state: AppState }) {
  const theme = useTheme();
  const router = useRouter();
  const formats = useMemo(() => unreadFormatCount(state), [state]);
  if (formats < REPORT_PROMPT_THRESHOLD) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Report ${formats} unrecognised bank message formats`}
      onPress={() => router.push('/accuracy')}
      style={({ pressed }) => [
        styles.reportRow,
        {
          borderColor: theme.cardBorder,
          backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
        },
      ]}>
      <View style={[styles.reportIcon, { backgroundColor: `${theme.warning}1f` }]}>
        <Icon name="search" size={16} color={theme.warning} strokeWidth={1.9} />
      </View>
      <View style={styles.reportText}>
        <ThemedText type="smallBold">
          {formats} message {formats === 1 ? 'format' : 'formats'} we couldn&apos;t read
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Send them over and they get recognised next release. Digits are masked.
        </ThemedText>
      </View>
      <Icon name="chevron-right" size={16} color={theme.textSecondary} />
    </Pressable>
  );
}

function BillsSection({ state, now }: { state: AppState; now: Date }) {
  const theme = useTheme();
  const router = useRouter();
  const upcoming = useMemo(
    () =>
      billsForMonth(state.bills, state.transactions, now)
        .filter((b) => b.status !== 'paid')
        .slice(0, 3),
    [state.bills, state.transactions, now],
  );
  if (upcoming.length === 0) return null;
  return (
    <Section title={t('upcomingBills')} action={t('manage')} onAction={() => router.push('/bills')} delay={180}>
      {upcoming.map(({ bill, status, daysLeft }) => (
        <Pressable key={bill.id} onPress={() => router.push('/bills')} style={styles.lineRow}>
          <View style={styles.lineTitle}>
            <Icon
              name={getCategory(bill.category).icon}
              size={14}
              color={getCategory(bill.category).color}
            />
            <ThemedText type="small" numberOfLines={1} style={{ flexShrink: 1 }}>
              {bill.title}
            </ThemedText>
          </View>
          <ThemedText
            type="small"
            style={{
              color:
                status === 'overdue'
                  ? theme.expense
                  : status === 'due-soon'
                    ? theme.warning
                    : theme.textSecondary,
            }}>
            {status === 'overdue' ? `${-daysLeft}d overdue` : daysLeft === 0 ? 'today' : `in ${daysLeft}d`}
          </ThemedText>
          <ThemedText type="smallBold" tabular style={styles.lineAmount}>
            {formatAED(bill.amountFils, { decimals: false })}
          </ThemedText>
        </Pressable>
      ))}
    </Section>
  );
}

/* ── Budgets snapshot (month mode only) ──────────────────────────────── */

function BudgetsSection({ state, period }: { state: AppState; period: Period }) {
  const theme = useTheme();
  const router = useRouter();
  const top = useMemo(
    () =>
      state.budgets
        .map((b) => ({
          budget: b,
          spent: spentInMonthForCategory(state.transactions, period, b.category),
        }))
        .sort((a, b) => b.spent / b.budget.limitFils - a.spent / a.budget.limitFils)
        .slice(0, 3),
    [state.budgets, state.transactions, period],
  );
  if (top.length === 0) return null;
  return (
    <Section title={t('budgetsSection')} action={t('manage')} onAction={() => router.push('/budgets')} delay={220}>
      {top.map(({ budget, spent }) => {
        const meta = getCategory(budget.category);
        const ratio = spent / budget.limitFils;
        return (
          <View key={budget.category} style={styles.budgetRow}>
            <View style={styles.budgetTop}>
              <View style={styles.lineTitle}>
                <Icon name={meta.icon} size={14} color={meta.color} />
                <ThemedText type="small">{meta.label}</ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary" tabular>
                {formatAED(spent, { decimals: false })} /{' '}
                {formatAED(budget.limitFils, { decimals: false })}
              </ThemedText>
            </View>
            {/* Matches the Budgets tab: the bar encodes budget health, never
                the category's identity color. */}
            <ProgressBar
              ratio={ratio}
              color={ratio >= 1 ? theme.expense : ratio >= 0.85 ? theme.warning : theme.primary}
              height={5}
            />
          </View>
        );
      })}
    </Section>
  );
}

/* ── Screen ───────────────────────────────────────────────────────────── */

export default function HomeScreen() {
  const theme = useTheme();
  const tabBarClearance = useTabBarClearance();
  const router = useRouter();
  const toast = useToast();
  const { state, importBatch, undoBatch } = useStore();
  const { period } = usePeriod();

  const now = useMemo(() => new Date(), []);
  const live = isCurrentMonth(period, now);
  const [refreshing, setRefreshing] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);

  const summary = useMemo(
    () => summarizeMonth(state.transactions, period),
    [state.transactions, period],
  );
  const insights = useMemo(
    () =>
      buildInsights(state.transactions, state.budgets, period, now, state.notSubscriptions).slice(0, 5),
    [state.transactions, state.budgets, period, now, state.notSubscriptions],
  );
  const recent = useMemo(
    () => state.transactions.filter((t) => !t.isTransfer && inPeriod(t.date, period)).slice(0, 5),
    [state.transactions, period],
  );
  const subs = useMemo(
    () =>
      activeSubscriptions(
        trueSubscriptions(detectSubscriptions(state.transactions, state.notSubscriptions)),
      ),
    [state.transactions, state.notSubscriptions],
  );

  const runAutoImport = useCallback(
    async (interactive: boolean) => {
      // Hard paywall: tracking pauses when the trial ends without Pro.
      if (!isProActive(state)) {
        if (interactive) router.push('/pro');
        return;
      }
      if (!isSmsScanningAvailable()) return;
      let granted = await hasSmsPermission();
      if (!granted && interactive) granted = await requestSmsPermission();
      if (!granted) {
        setNeedsPermission(true);
        return;
      }
      setNeedsPermission(false);
      const sinceMs = state.lastScanTs > 0 ? state.lastScanTs + 1 : 0;
      const { parsed, newestTs } = await scanInbox(sinceMs, state.merchantOverrides);
      const plan = buildImportPlan(parsed, state, newestTs);
      if (plan.txCount === 0 && plan.dueCount === 0) {
        if (interactive) toast.show('Up to date. No new bank messages.');
        return;
      }
      const ids = importBatch(plan.batch);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      toast.show(
        `Imported ${plan.txCount} transaction${plan.txCount === 1 ? '' : 's'}${plan.newAccountCount > 0 ? ` · ${plan.newAccountCount} new card${plan.newAccountCount === 1 ? '' : 's'}` : ''}`,
        [
          { label: 'Undo', onPress: () => undoBatch(ids) },
          { label: 'Review', onPress: () => router.push('/transactions?source=sms') },
        ],
      );
    },
    [state, importBatch, undoBatch, toast, router],
  );

  // Silent auto-import + reminder sync, once per session.
  useEffect(() => {
    if (!state.hydrated || autoImportRan) return;
    autoImportRan = true;
    (async () => {
      try {
        await runAutoImport(false);
        await requestNotificationPermission();
        await syncPaymentReminders(state);
      } catch {
        // Best-effort; manual import still available.
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.hydrated]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await runAutoImport(true);
      await syncPaymentReminders(state);
    } finally {
      setRefreshing(false);
    }
  }, [runAutoImport, state]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: tabBarClearance }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }>
          <Hero
            period={period}
            live={live}
            netFils={summary.incomeFils - summary.expenseFils}
            incomeFils={summary.incomeFils}
            expenseFils={summary.expenseFils}
            onOpenPeriod={() => setPeriodSheetOpen(true)}
          />

          {!isProActive(state) && (
            <Animated.View entering={FadeInDown.duration(350)}>
              <Pressable
                onPress={() => router.push('/pro')}
                style={[styles.permissionRow, { borderColor: theme.gold }]}>
                <Icon name="diamond" size={18} color={theme.gold} />
                <View style={styles.permissionText}>
                  <ThemedText type="smallBold">{t('trialEndedBanner')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('trialEndedBannerSub')}
                  </ThemedText>
                </View>
                <Icon name="chevron-right" size={16} color={theme.textSecondary} />
              </Pressable>
            </Animated.View>
          )}

          {needsPermission && isProActive(state) && (
            <Animated.View entering={FadeInDown.duration(350)}>
              <Pressable
                onPress={() => runAutoImport(true)}
                style={[styles.permissionRow, { borderColor: theme.primary }]}>
                <Icon name="spark" size={18} color={theme.primary} />
                <View style={styles.permissionText}>
                  <ThemedText type="smallBold">{t('turnOnTracking')}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t('trackingPrivacy')}
                  </ThemedText>
                </View>
                <Icon name="chevron-right" size={16} color={theme.textSecondary} />
              </Pressable>
            </Animated.View>
          )}

          <DuesSection state={state} now={now} />

          {insights.length > 0 && (
            <Section
              title={t('insightsSection')}
              icon="spark"
              action={t('allWord')}
              onAction={() => router.push('/stats')}
              delay={100}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.insightScroll}>
                {insights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} width={230} />
                ))}
              </ScrollView>
            </Section>
          )}

          <SubscriptionsLine subs={subs} now={now} />

          <UnreadFormatsPrompt state={state} />

          {live && <BillsSection state={state} now={now} />}
          {period.mode === 'month' && <BudgetsSection state={state} period={period} />}

          <Section
            title={t('recentActivity')}
            action={t('seeAll')}
            onAction={() => router.push('/transactions')}
            delay={260}>
            <View>
              {recent.map((t, i) => (
                <View
                  key={t.id}
                  style={
                    i > 0
                      ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder }
                      : undefined
                  }>
                  <TransactionRow
                    transaction={t}
                    account={state.accounts.find((a) => a.id === t.accountId)}
                    onPress={() => router.push('/transactions')}
                  />
                </View>
              ))}
              {recent.length === 0 && (
                <View style={styles.emptyRecent}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Nothing yet. Tap + to add a transaction, or pull down to scan your SMS.
                  </ThemedText>
                </View>
              )}
            </View>
          </Section>
        </ScrollView>
      </SafeAreaView>
      <PeriodSheet visible={periodSheetOpen} onClose={() => setPeriodSheetOpen(false)} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
  },
  safe: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  content: {
    padding: Spacing.three,
    gap: Spacing.four,
  },
  hero: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  periodChipWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  heroStats: {
    flexDirection: 'row',
    gap: Spacing.four,
    marginTop: Spacing.one,
  },
  heroStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  heroDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  permissionText: {
    flex: 1,
    gap: 1,
  },
  section: {
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one + 2,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.one + 2,
  },
  lineTitle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  lineAmount: {
    minWidth: 84,
    textAlign: 'right',
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reportIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportText: {
    flex: 1,
    gap: 1,
  },
  insightScroll: {
    gap: Spacing.two,
    paddingRight: Spacing.three,
  },
  subsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  subsNext: {
    flex: 1,
  },
  budgetRow: {
    gap: Spacing.one + 1,
    paddingVertical: Spacing.one,
  },
  budgetTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  emptyRecent: {
    paddingVertical: Spacing.three,
  },
});

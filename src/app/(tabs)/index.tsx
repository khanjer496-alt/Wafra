/**
 * Home — am I ahead or behind, and what is about to leave?
 *
 * Order: period row → hero → in/out split → one written insight → Leaving soon
 * → Today.
 *
 * Two things this screen deliberately no longer does. It does not carry a
 * budget snapshot: that was a third copy of bars that already exist on Flow and
 * inside every limit. And it does not carry a five-card insight carousel —
 * five observations sat side by side is a list nobody reads, so one sentence
 * gets the space and the rest live on Flow.
 *
 * "Leaving soon" is the merge of what used to be three separate sections: card
 * dues, bills, and subscriptions. The user does not think of those as three
 * kinds of thing. They are all money that leaves on a date.
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionRow } from '@/components/transaction-row';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { CardPaymentSheet } from '@/components/card-payment-sheet';
import { BillDetailSheet } from '@/components/bill-detail-sheet';
import { CountUpAmount } from '@/components/ui/count-up';
import { Icon } from '@/components/ui/icon';
import { IconButton, PeriodPill, SectionHeader } from '@/components/ui/period-pill';
import { SkeletonRows } from '@/components/ui/states';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useTheme } from '@/hooks/use-theme';
import { REPORT_PROMPT_THRESHOLD, unreadFormatCount } from '@/lib/accuracy';
import {
  buildImportPlan,
  hasSmsPermission,
  isSmsScanningAvailable,
  requestSmsPermission,
  scanInbox,
} from '@/lib/auto-import';
import { daysPhrase, leavingSoon, type Outgoing } from '@/lib/leaving-soon';
import { formatAED, formatAmount, formatCompactAED, shortDate, totalAsShown } from '@/lib/format';
import { committed } from '@/lib/haptics';
import { t } from '@/lib/i18n';
import { liveAccountIds } from '@/lib/ledger';
import { buildInsights, composition, summarizeMonth } from '@/lib/insights';
import { PARSER_VERSION } from '@/lib/sms-parser';
import { requestNotificationPermission, syncPaymentReminders } from '@/lib/notifications';
import { inPeriod, isCurrentMonth, periodLabel, type Period } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { isProActive } from '@/lib/purchases';
import { useStore } from '@/lib/store';
import { type Subscription } from '@/lib/subscriptions';
import type { AppState, CardDue, Transaction } from '@/lib/types';

// Once per app session: auto-import + notification sync.
let autoImportRan = false;

/** How far ahead "leaving soon" looks. Beyond this it is not soon. */
const HORIZON_DAYS = 9;


/* ── Hero ─────────────────────────────────────────────────────────────── */

function Hero({
  period,
  live,
  netFils,
  incomeFils,
  expenseFils,
}: {
  period: Period;
  live: boolean;
  netFils: number;
  incomeFils: number;
  expenseFils: number;
}) {
  const theme = useTheme();
  const router = useRouter();

  const caption =
    (netFils >= 0 ? t('saved') : t('overspent')) +
    ' ' +
    (live
      ? t('soFarThisMonth')
      : period.mode === 'all'
        ? t('allTime')
        : `${t('inWord')} ${periodLabel(period)}`) +
    ` · ${t('inMinusOut')}`;

  return (
    <Animated.View entering={FadeInDown.duration(320)}>
      <ThemedText type="micro" themeColor="textTertiary" style={styles.heroLabel}>
        {caption}
      </ThemedText>

      {/* No card, no background. The figure IS the top of the screen. */}
      {Math.abs(netFils) >= 1_000_000_000 ? (
        <ThemedText type="display" tabular>
          <ThemedText type="smallBold" themeColor="textSecondary" tabular style={styles.aed}>
            AED{' '}
          </ThemedText>
          {netFils < 0 ? '−' : ''}
          {formatCompactAED(netFils)}
        </ThemedText>
      ) : (
        <View style={styles.heroRow}>
          <ThemedText type="smallBold" themeColor="textSecondary" tabular style={styles.aed}>
            AED
          </ThemedText>
          <CountUpAmount fils={netFils} type="display" prefix="" durationMs={900} />
        </View>
      )}

      {/* Two cells divided by rules rather than boxed — the split is a
          continuation of the hero, not a separate component. */}
      <View style={styles.split}>
        {(
          [
            ['In', incomeFils, theme.income, '/transactions?type=income'],
            ['Out', expenseFils, theme.expense, '/transactions?type=expense'],
          ] as const
        ).map(([label, fils, color, href], i) => (
          <Pressable
            key={label}
            onPress={() => router.push(href)}
            style={[
              styles.splitCell,
              { borderTopColor: theme.cardBorder },
              i === 1 && { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: theme.cardBorder },
            ]}>
            <View style={styles.splitTop}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <ThemedText type="nano" themeColor="textTertiary">
                {label}
              </ThemedText>
            </View>
            <ThemedText type="small" tabular style={styles.splitFigure}>
              {formatAmount(fils, { decimals: false })}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

/* ── Leaving soon ─────────────────────────────────────────────────────── */

/**
 * The merge itself lives in `@/lib/leaving-soon` so it can be unit-tested and
 * reused; this is only its presentation.
 *
 * A row opens the sheet for the thing it names rather than navigating to a
 * screen: "what do I owe on this card" is a question about one statement, and
 * answering it by dropping the user on Wallet made them find it again.
 */
function LeavingSoon({
  state,
  now,
  onOpen,
}: {
  state: AppState;
  now: Date;
  onOpen: (item: Outgoing) => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const items = useMemo(() => leavingSoon(state, now, { withinDays: HORIZON_DAYS }), [state, now]);
  if (items.length === 0) return null;

  // The heading used to say "Leaving in 9 days" over the total of everything
  // in the list — including statements 28 days overdue, which have not been
  // leaving in nine days for a month. And only three rows were ever drawn, so
  // AED 70,976 sat above rows adding to 15,785 with nothing to say where the
  // rest of it was.
  //
  // The total still covers the whole list, because "what is about to leave my
  // account" is the useful number and truncating it to three rows would be a
  // different lie. Two things make it legible instead: the heading admits the
  // overdue items are in there, and the remainder is stated below the rows so
  // the column reconciles.
  const shown = items.slice(0, 3);
  const late = items.filter((x) => x.overdue).length;
  const hidden = items.length - shown.length;

  return (
    <Animated.View entering={FadeInDown.delay(80).duration(320)} style={styles.section}>
      <SectionHeader
        title={late > 0 ? `Overdue and leaving in ${HORIZON_DAYS} days` : `Leaving in ${HORIZON_DAYS} days`}
        right={formatAED(totalAsShown(items.map((x) => x.amountFils)), { decimals: false })}
      />
      {shown.map((x, i) => {
        const alarming = x.overdue || x.urgent;
        return (
          <Pressable
            key={x.id}
            accessibilityRole="button"
            accessibilityLabel={x.title}
            onPress={() => onOpen(x)}
            style={[
              styles.leaveRow,
              i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
            ]}>
            <Icon name={x.icon} size={17} color={alarming ? theme.expense : theme.text} />
            <View style={styles.leaveText}>
              <ThemedText type="small" numberOfLines={1}>
                {x.title}
              </ThemedText>
              <ThemedText
                type="meta"
                themeColor={x.overdue ? undefined : 'textTertiary'}
                style={x.overdue ? { color: theme.expense } : undefined}>
                {shortDate(x.dateISO)} · {daysPhrase(x.daysLeft)}
              </ThemedText>
            </View>
            <ThemedText type="small" tabular style={x.overdue ? { color: theme.expense } : undefined}>
              {formatAmount(x.amountFils, { decimals: false })}
            </ThemedText>
          </Pressable>
        );
      })}
      {hidden > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`See all ${items.length} upcoming payments`}
          onPress={() => router.push('/bills')}
          style={[
            styles.leaveRow,
            { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
          ]}>
          <Icon name="chevron-right" size={17} color={theme.textTertiary} />
          <View style={styles.leaveText}>
            <ThemedText type="small" themeColor="textSecondary">
              {hidden} more
            </ThemedText>
          </View>
          <ThemedText type="small" tabular themeColor="textSecondary">
            {formatAmount(totalAsShown(items.slice(3).map((x) => x.amountFils)), {
              decimals: false,
            })}
          </ThemedText>
        </Pressable>
      )}
    </Animated.View>
  );
}

/* ── Unread SMS formats ───────────────────────────────────────────────── */

/**
 * The parser only improves if the formats it misreads come back to us, and the
 * report screen was buried in Settings where nobody found it. This surfaces
 * once enough distinct formats have piled up to be worth a tap, and says how
 * many so the ask is concrete rather than a chore.
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
        styles.notice,
        {
          borderColor: theme.cardBorder,
          backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
        },
      ]}>
      <Icon name="search" size={17} color={theme.warning} />
      <View style={styles.noticeText}>
        <ThemedText type="small">
          {formats} message {formats === 1 ? 'format' : 'formats'} we couldn&apos;t read
        </ThemedText>
        <ThemedText type="meta" themeColor="textTertiary">
          Send them over and they get recognised next release. Digits are masked.
        </ThemedText>
      </View>
      <Icon name="chevron-right" size={16} color={theme.textTertiary} />
    </Pressable>
  );
}

/* ── Screen ───────────────────────────────────────────────────────────── */

export default function HomeScreen() {
  const theme = useTheme();
  const clearance = useTabBarClearance();
  const router = useRouter();
  const toast = useToast();
  const { state, importBatch, undoBatch, markParserVersion } = useStore();
  const { period } = usePeriod();

  const now = useMemo(() => new Date(), []);
  const live = isCurrentMonth(period, now);
  const [refreshing, setRefreshing] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [dismissedInsight, setDismissedInsight] = useState<string | null>(null);
  const [entry, setEntry] = useState<Transaction | null>(null);
  const [cardDue, setCardDue] = useState<CardDue | null>(null);
  const [recurring, setRecurring] = useState<Subscription | null>(null);

  /** A dated outgoing opens the sheet for whatever kind of thing it is. */
  const openOutgoing = useCallback(
    (item: Outgoing) => {
      if (item.kind === 'card' && item.dueId) {
        setCardDue(state.cardDues.find((d) => d.id === item.dueId) ?? null);
      } else if (item.subscription) {
        setRecurring(item.subscription);
      } else {
        router.push('/bills');
      }
    },
    [state.cardDues, router],
  );

  // Archiving an account used to remove its balance from Wallet and its
  // history from net worth, while its spending went on counting here. Hiding
  // a card now hides what it spent too.
  const liveAccounts = useMemo(() => liveAccountIds(state.accounts), [state.accounts]);

  const summary = useMemo(
    () => summarizeMonth(state.transactions, period, liveAccounts),
    [state.transactions, period, liveAccounts],
  );

  // One insight, not five. The rest are on Flow.
  /**
   * The hero's three figures, reconciled. Rounding each of in and out to whole
   * dirhams first and subtracting those is the only way the caption under them
   * can be checked by eye — which is the entire point of showing all three.
   */
  const hero = useMemo(() => {
    const expenseFils = composition(summary).totalFils;
    const incomeFils = Math.round(summary.incomeFils / 100) * 100;
    return { incomeFils, expenseFils, netFils: incomeFils - expenseFils };
  }, [summary]);

  const insight = useMemo(() => {
    const all = buildInsights(
      state.transactions,
      state.budgets,
      period,
      now,
      state.notSubscriptions,
    );
    return all.find((i) => i.id !== dismissedInsight) ?? null;
  }, [state.transactions, state.budgets, period, now, state.notSubscriptions, dismissedInsight]);

  const today = useMemo(
    () => state.transactions.filter((t) => !t.isTransfer && inPeriod(t.date, period)).slice(0, 6),
    [state.transactions, period],
  );

  const runAutoImport = useCallback(
    async (interactive: boolean) => {
      // Never scan against a ledger that has not finished loading. Every
      // duplicate check in the plan is a lookup against state.transactions,
      // so an unhydrated store means nothing matches and the entire inbox
      // imports as new — on top of the rows that arrive a moment later. The
      // effect below already waits for this; pull-to-refresh did not.
      if (!state.hydrated) {
        if (interactive) toast.show('Still loading your data — try again in a second.');
        return;
      }
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
      // The routine scan reads only what arrived since last time. That is
      // right for a normal refresh and wrong after a parser change: a message
      // is imported once and can never arrive again, so every improvement
      // would apply to the future only, and the card payments already in the
      // ledger would stay filed as spending forever. When the parser has moved
      // on, re-read everything — existing rows are recognized by fingerprint
      // and healed in place, not duplicated.
      const reread = state.parserVersion !== PARSER_VERSION;
      const sinceMs = reread || state.lastScanTs <= 0 ? 0 : state.lastScanTs + 1;
      const { parsed, newestTs } = await scanInbox(sinceMs, state.merchantOverrides);
      const plan = buildImportPlan(parsed, state, newestTs);
      // healedCount belongs in this test. A re-read that only CORRECTS rows —
      // exactly what a parser fix produces — was being thrown away here, so the
      // corrections never reached the store.
      if (plan.txCount === 0 && plan.dueCount === 0 && plan.healedCount === 0) {
        markParserVersion();
        if (interactive) toast.show('Up to date. No new bank messages.');
        return;
      }
      const ids = importBatch(plan.batch);
      committed();
      toast.show(
        `Imported ${plan.txCount} transaction${plan.txCount === 1 ? '' : 's'}${plan.newAccountCount > 0 ? ` · ${plan.newAccountCount} new card${plan.newAccountCount === 1 ? '' : 's'}` : ''}`,
        [
          { label: 'Undo', onPress: () => undoBatch(ids) },
          { label: 'Review', onPress: () => router.push('/transactions?source=sms') },
        ],
      );
    },
    [state, importBatch, undoBatch, markParserVersion, toast, router],
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
          contentContainerStyle={[styles.content, { paddingBottom: clearance }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
          }>
          <View style={styles.topRow}>
            <PeriodPill onPress={() => setPeriodSheetOpen(true)} />
            <View style={styles.topActions}>
              <IconButton
                name="search"
                label={t('seeAll')}
                onPress={() => router.push('/transactions')}
              />
              <IconButton name="sliders" label="Settings" onPress={() => router.push('/settings')} />
            </View>
          </View>

          <Hero
            period={period}
            live={live}
            // All three figures from one arithmetic, so the hero equals its
            // own two cells. It read "63,039 in, 8,815 out, saved 54,223" —
            // a subtraction that is off by one, in 40px type, at the top of
            // the screen. Each cell was rounded on its own while the net was
            // computed from the raw fils and rounded once more.
            //
            // Out is the composition total, which Flow prints above the
            // category split; in is rounded the same way; and the net is the
            // difference between those two, not a third measurement.
            netFils={hero.netFils}
            incomeFils={hero.incomeFils}
            expenseFils={hero.expenseFils}
          />

          {!isProActive(state) && (
            <Pressable
              onPress={() => router.push('/pro')}
              style={[styles.notice, { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement }]}>
              <Icon name="diamond" size={17} color={theme.warning} />
              <View style={styles.noticeText}>
                <ThemedText type="small">{t('trialEndedBanner')}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {t('trialEndedBannerSub')}
                </ThemedText>
              </View>
              <Icon name="chevron-right" size={16} color={theme.textTertiary} />
            </Pressable>
          )}

          {needsPermission && isProActive(state) && (
            <Pressable
              onPress={() => runAutoImport(true)}
              style={[styles.notice, { borderColor: theme.primaryBorder, backgroundColor: theme.primarySoft }]}>
              <Icon name="spark" size={17} color={theme.primary} />
              <View style={styles.noticeText}>
                <ThemedText type="small">{t('turnOnTracking')}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary">
                  {t('trackingPrivacy')}
                </ThemedText>
              </View>
              <Icon name="chevron-right" size={16} color={theme.textTertiary} />
            </Pressable>
          )}

          {/* One sentence, with somewhere to go. A carousel of five of these
              was five things to skim and nothing to act on. */}
          {insight && (
            <Animated.View
              entering={FadeInDown.delay(40).duration(320)}
              style={[
                styles.insight,
                { backgroundColor: theme.backgroundElement, borderColor: theme.cardBorder },
              ]}>
              <Icon name={insight.icon} size={17} color={theme.warning} />
              <ThemedText type="small" style={styles.insightTitle}>
                {insight.title}
              </ThemedText>
              <ThemedText type="meta" themeColor="textSecondary">
                {insight.body}
              </ThemedText>
              <View style={styles.insightActions}>
                <Pressable
                  onPress={() => router.push(insight.href ?? '/flow')}
                  style={[styles.btn, { backgroundColor: theme.primary }]}>
                  <ThemedText type="nano" style={{ color: theme.onPrimary }}>
                    See the breakdown
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => setDismissedInsight(insight.id)}
                  style={[styles.btn, { borderWidth: 1, borderColor: theme.cardBorder }]}>
                  <ThemedText type="nano" themeColor="textSecondary">
                    Dismiss
                  </ThemedText>
                </Pressable>
              </View>
            </Animated.View>
          )}

          <LeavingSoon state={state} now={now} onOpen={openOutgoing} />

          <UnreadFormatsPrompt state={state} />

          <Animated.View entering={FadeInDown.delay(120).duration(320)} style={styles.section}>
            <SectionHeader
              title={live ? t('recentActivity') : periodLabel(period)}
              right="ALL ACTIVITY"
              onPressRight={() => router.push('/transactions')}
            />
            {today.map((tx, i) => (
              <View
                key={tx.id}
                style={
                  i > 0
                    ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder }
                    : undefined
                }>
                <TransactionRow
                  transaction={tx}
                  account={state.accounts.find((a) => a.id === tx.accountId)}
                  onPress={setEntry}
                />
              </View>
            ))}
            {/* Reading the ledger back off disk takes long enough to paint,
                and an unhydrated store is indistinguishable from an empty one.
                The screen was announcing "No entries in this period yet" over
                AED 0 and then replacing it with a real month — telling the user
                their data was gone, every cold start. Skeletons until the store
                says it has looked. */}
            {!state.hydrated && today.length === 0 && <SkeletonRows count={4} height={44} />}
            {state.hydrated && today.length === 0 && (
              <View style={[styles.empty, { borderColor: theme.cardBorderStrong }]}>
                <ThemedText type="display" themeColor="textTertiary" tabular style={styles.emptyFigure}>
                  AED 0
                </ThemedText>
                <ThemedText type="small">No entries in this period yet</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary" style={styles.emptyBody}>
                  Pull down to read your inbox, or add the last thing you paid for — one entry is
                  enough to start the month.
                </ThemedText>
              </View>
            )}
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
      <PeriodSheet visible={periodSheetOpen} onClose={() => setPeriodSheetOpen(false)} />
      <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} />
      <CardPaymentSheet due={cardDue} onClose={() => setCardDue(null)} />
      <BillDetailSheet subscription={recurring} onClose={() => setRecurring(null)} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  content: { paddingHorizontal: ScreenPadding, paddingTop: Spacing.three },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.four,
  },
  topActions: { flexDirection: 'row', gap: Spacing.two },

  heroLabel: { marginBottom: Spacing.two },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  aed: { fontSize: 15, lineHeight: 20 },
  split: { flexDirection: 'row', marginTop: Spacing.four },
  splitCell: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 11,
    paddingBottom: Spacing.two,
    paddingRight: Spacing.three,
    paddingLeft: 0,
    gap: 5,
  },
  splitTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  splitFigure: { fontSize: 17, lineHeight: 22 },
  dot: { width: 5, height: 5, borderRadius: 3 },

  section: { marginTop: Spacing.five },

  insight: {
    marginTop: Spacing.four,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    paddingVertical: Spacing.three,
    paddingHorizontal: 18,
    gap: 6,
  },
  insightTitle: { marginTop: Spacing.one },
  insightActions: { flexDirection: 'row', gap: Spacing.two, marginTop: Spacing.two },
  btn: {
    borderRadius: Radius.tile,
    paddingVertical: 9,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    marginTop: Spacing.four,
    padding: Spacing.three,
    borderRadius: Radius.sheet,
    borderWidth: StyleSheet.hairlineWidth,
  },
  noticeText: { flex: 1, gap: 1 },

  leaveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 4,
    paddingVertical: 13,
  },
  leaveText: { flex: 1, gap: 1 },

  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.sheet + 2,
    padding: Spacing.four,
    gap: 6,
    alignItems: 'flex-start',
  },
  emptyFigure: { opacity: 0.35, marginBottom: Spacing.two },
  emptyBody: { maxWidth: 320 },
});

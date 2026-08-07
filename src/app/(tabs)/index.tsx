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
import { useFocusEffect, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState as RNAppState, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
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
import { useScreenEntering } from '@/hooks/use-screen-entering';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { REPORT_PROMPT_THRESHOLD, unreadFormatCount } from '@/lib/accuracy';
import { hasSmsPermission, isSmsScanningAvailable, requestSmsPermission } from '@/lib/auto-import';
import { enableRelayBackgroundSync } from '@/lib/background-relay';
import { isCaptureAvailable, planNewMessages } from '@/lib/capture';
import { daysPhrase, leavingSoon, type Outgoing } from '@/lib/leaving-soon';
import {
  formatAED,
  formatAmount,
  formatCompactAED,
  shortDate,
  totalAsShown,
} from '@/lib/format';
import { buildReferenceFxUpdates, formatOriginalCurrency } from '@/lib/fx';
import {
  previewForeignActivity,
  summarizeForeignActivity,
  type ForeignActivitySummary,
} from '@/lib/fx-summary';
import { committed, tapped } from '@/lib/haptics';
import {
  internalTransferIds,
  isSpending,
  isUnassignedAccountRef,
  liveAccountIds,
} from '@/lib/ledger';
import { buildInsights, summarizeMonth } from '@/lib/insights';
import { syncPaymentReminders } from '@/lib/notifications';
import { inPeriod, isCurrentMonth, periodLabel, type Period } from '@/lib/period';
import { usePeriod } from '@/lib/period-context';
import { isProActive } from '@/lib/purchases';
import { isBillingAvailable, refreshEntitlement } from '@/lib/billing';
import { getActiveMarket } from '@/lib/markets';
import { getRelayAutomationProof, getRelayConfig } from '@/lib/relay';
import { useStore } from '@/lib/store';
import { type Subscription } from '@/lib/subscriptions';
import type { AppState, CardDue, Transaction } from '@/lib/types';
import { t, tf } from '@/lib/i18n';

// The one-time setup that must not repeat: asking for notification
// permission, and the first reminder sync.
let sessionSetupRan = false;

/**
 * How long a scan stays fresh enough to skip on returning to the app.
 *
 * Coming back from the banking app to see the charge is the single most
 * common way this screen is opened, so the bar for re-scanning is low. It is
 * not zero only because flicking between two apps should not run a full inbox
 * read on every flick.
 */
const RESCAN_AFTER_MS = 30_000;
let lastScanAt = 0;

/**
 * What a scan attempt actually did, so a caller who only *joined* it — rather
 * than starting it — can tell whether it still owes its own interactive
 * feedback. `'imported'` is the one outcome that already shows a toast
 * unconditionally; every other outcome only acts when `interactive` was true
 * for THAT attempt, so a silent attempt that hit one of them delivered
 * nothing a joining interactive caller would see.
 */
type AutoImportOutcome =
  | 'not-hydrated'
  | 'not-pro'
  | 'unavailable'
  | 'no-permission'
  | 'needs-setup'
  | 'up-to-date'
  | 'imported';

/** How far ahead "leaving soon" looks. Beyond this it is not soon. */
const HORIZON_DAYS = 9;

type CaptureSurfaceState =
  | 'checking'
  | 'active'
  | 'pipe-ready'
  | 'needs-test'
  | 'off'
  | 'paused'
  | 'unsupported';

/**
 * The product promise, above the fold. This is deliberately a live status and
 * an action rather than marketing copy: it says whether capture is actually
 * connected on this platform, and tapping it either syncs now or finishes the
 * platform-specific setup.
 */
function AutomaticCapture({
  status,
  lastCaptureDate,
  onPress,
}: {
  status: CaptureSurfaceState;
  lastCaptureDate?: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const enter = useScreenEntering();
  const active = status === 'active';
  const title =
    status === 'paused'
      ? t('trialEndedBanner')
      : status === 'checking'
      ? t('captureChecking')
      : status === 'unsupported'
        ? t('capturePhoneOnly')
        : Platform.OS === 'ios'
          ? active
            ? t('captureIosOn')
            : status === 'pipe-ready'
              ? t('captureIosPipeReady')
            : status === 'needs-test'
              ? t('captureIosNeedsTest')
              : t('captureIosOff')
          : active
            ? t('captureAndroidOn')
            : t('turnOnTracking');
  const detail = status === 'paused'
    ? t('trialEndedBannerSub')
    : status === 'checking' || status === 'unsupported'
      ? t('capturePhoneOnly')
      : active
    ? lastCaptureDate
      ? tf('captureLatest', { date: shortDate(lastCaptureDate) })
      : Platform.OS === 'ios'
        ? t('captureSyncNow')
        : t('captureAndroidPrivate')
    : status === 'pipe-ready'
      ? t('iosTestLimit')
    : Platform.OS === 'android'
      ? t('trackingPrivacy')
      : t('captureIosSetupDetail');
  const badge = status === 'paused'
    ? t('pausedBadge')
    : active
    ? t('captureReady')
    : status === 'pipe-ready'
      ? t('captureVerify')
    : status === 'needs-test'
      ? t('captureFinish')
      : status === 'checking' || status === 'unsupported'
        ? null
        : t('captureEnable');

  return (
    <Animated.View entering={enter(FadeInDown.duration(280))}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('automaticCapture')}. ${title}. ${detail}`}
        disabled={status === 'checking' || status === 'unsupported'}
        onPress={() => {
          tapped();
          onPress();
        }}
        style={({ pressed }) => [
          styles.capture,
          {
            backgroundColor: active ? theme.primarySoft : theme.backgroundElement,
            borderColor: active ? theme.primaryBorder : theme.cardBorder,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          },
        ]}>
        <View
          style={[
            styles.captureIcon,
            { backgroundColor: active ? theme.primary : theme.backgroundSelected },
          ]}>
          <Icon name="spark" size={18} color={active ? theme.onPrimary : theme.textSecondary} />
        </View>
        <View style={styles.captureText}>
          <View style={styles.captureTitleRow}>
            {active && <View style={[styles.liveDot, { backgroundColor: theme.primary }]} />}
            <ThemedText type="smallBold" numberOfLines={2} style={styles.captureTitle}>
              {title}
            </ThemedText>
          </View>
          <ThemedText type="meta" themeColor="textTertiary">
            {detail}
          </ThemedText>
        </View>
        {badge ? (
          <ThemedText type="nano" style={{ color: active ? theme.primary : theme.warning }}>
            {badge}
          </ThemedText>
        ) : null}
        {status !== 'checking' && status !== 'unsupported' ? (
          <Icon name="chevron-right" size={15} color={theme.textTertiary} />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

function ForeignActivityPreview({ summary }: { summary: ForeignActivitySummary }) {
  const theme = useTheme();
  const router = useRouter();
  const language = useStore().state.language === 'ar' ? 'ar' : 'en';
  if (summary.groups.length === 0) return null;
  const preview = previewForeignActivity(summary);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t('foreignActivity')}, ${formatAED(preview.totalLocalFils)}`}
      onPress={() => {
        tapped();
        router.push('/currency');
      }}
      style={({ pressed }) => [
        styles.currencyPreview,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.cardBorder,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}>
      <View style={styles.currencyPreviewTop}>
        <View style={styles.currencyPreviewHeading}>
          <Icon name="plane" size={17} color={theme.primary} />
          <ThemedText type="micro" themeColor="textTertiary">
            {t('foreignActivity')}
          </ThemedText>
        </View>
        <Icon name="chevron-right" size={16} color={theme.textTertiary} />
      </View>
      <ThemedText type="heading" tabular>
        {formatAED(preview.totalLocalFils, { decimals: false })}
      </ThemedText>
      <View style={styles.currencyRows}>
        {preview.groups.map((group) => (
          <View key={group.currency} style={styles.currencyRow}>
            <ThemedText type="smallBold" tabular style={{ color: theme.primary }}>
              {group.currency}
            </ThemedText>
            <ThemedText type="meta" themeColor="textSecondary" numberOfLines={1} style={styles.currencyOriginal}>
              {formatOriginalCurrency(group.originalMinor, group.currency, language)}
            </ThemedText>
            <ThemedText type="small" tabular>
              {formatAED(group.localFils, { decimals: false })}
            </ThemedText>
          </View>
        ))}
        {preview.remainingCount > 0 && (
          <View style={styles.currencyRow}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>
              +{tf('moreItems', { count: preview.remainingCount })}
            </ThemedText>
            <View style={styles.currencyOriginal} />
            <ThemedText type="small" tabular>
              {formatAED(preview.remainingLocalFils, { decimals: false })}
            </ThemedText>
          </View>
        )}
      </View>
    </Pressable>
  );
}


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
  const enter = useScreenEntering();
  const dark = useColorScheme() === 'dark';

  const caption =
    (netFils >= 0 ? t('saved') : t('overspent')) +
    ' ' +
    (live
      ? t('soFarThisMonth')
      : period.mode === 'all'
        ? t('allTime')
        : `${t('inWord')} ${periodLabel(period)}`);

  return (
    <Animated.View
      entering={enter(FadeInDown.duration(320))}
      style={[styles.heroShell, { borderColor: theme.primaryBorder }]}>
      <LinearGradient
        pointerEvents="none"
        colors={dark ? ['#173D35', '#172A24', '#151A17'] : ['#DDF8EF', '#F2F7F3', '#F8F8F5']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <ThemedText type="meta" themeColor="textTertiary" style={styles.heroLabel}>
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
            [t('inLabel'), incomeFils, theme.income, '/transactions?type=income'],
            [t('outLabel'), expenseFils, theme.expense, '/transactions?type=expense'],
          ] as const
        ).map(([label, fils, color, href], i) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${formatAED(fils, { decimals: false })}`}
            onPress={() => {
              tapped();
              router.push(href);
            }}
            style={[
              styles.splitCell,
              { borderTopColor: theme.cardBorder },
              i === 1 && { borderStartWidth: StyleSheet.hairlineWidth, borderStartColor: theme.cardBorder },
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
  const enter = useScreenEntering();
  const [expanded, setExpanded] = useState(false);
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
  const shown = expanded ? items : items.slice(0, 3);
  const late = items.filter((x) => x.overdue).length;
  const hidden = items.length - shown.length;

  return (
    <Animated.View
      entering={enter(FadeInDown.delay(80).duration(320))}
      style={styles.section}>
      <SectionHeader
        title={
          late > 0
            ? tf('overdueAndLeaving', { days: HORIZON_DAYS })
            : tf('leavingInDays', { days: HORIZON_DAYS })
        }
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
          accessibilityLabel={tf('seeUpcomingPaymentsA11y', { count: items.length })}
          // Expand in place. This used to push to Bills, which opens on its
          // Cards segment — so tapping "3 more" under three card rows showed
          // the SAME three cards, and the three items actually being counted
          // (bills, not cards) were never reachable at all.
          onPress={() => {
            tapped();
            setExpanded(true);
          }}
          style={[
            styles.leaveRow,
            { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder },
          ]}>
          <Icon name="chevron-right" size={17} color={theme.textTertiary} />
          <View style={styles.leaveText}>
            <ThemedText type="small" themeColor="textSecondary">
              {tf('moreItems', { count: hidden })}
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
      accessibilityLabel={tf('reportUnreadFormatsA11y', { count: formats })}
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
          {tf('unreadFormatCount', { count: formats, s: formats === 1 ? '' : 's' })}
        </ThemedText>
        <ThemedText type="meta" themeColor="textTertiary">
          {t('unreadMessageHint')}
        </ThemedText>
      </View>
      <Icon name="chevron-right" size={16} color={theme.textTertiary} />
    </Pressable>
  );
}

/* ── Screen ───────────────────────────────────────────────────────────── */

export default function HomeScreen() {
  const theme = useTheme();
  const enter = useScreenEntering();
  const clearance = useTabBarClearance();
  const router = useRouter();
  const toast = useToast();
  const {
    state,
    importBatch,
    ensureDurable,
    undoBatch,
    markParserVersion,
    setPro,
    applyFxUpdates,
  } = useStore();
  const { period } = usePeriod();

  const now = useMemo(() => new Date(), []);
  const live = isCurrentMonth(period, now);
  const [refreshing, setRefreshing] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [captureState, setCaptureState] = useState<CaptureSurfaceState>('checking');
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [dismissedInsight, setDismissedInsight] = useState<string | null>(null);
  const [entry, setEntry] = useState<Transaction | null>(null);
  const [cardDue, setCardDue] = useState<CardDue | null>(null);
  const [recurring, setRecurring] = useState<Subscription | null>(null);
  const lastFxAttempt = React.useRef('');
  /**
   * Foreground resume, pull-to-refresh and the capture card can all request a
   * scan within the same second. Reading and parsing the same inbox twice is
   * both expensive and a race against two import plans built from one stale
   * ledger. Every caller joins the scan already in progress instead.
   *
   * Tracked with the interactivity it was started with: a silent background
   * scan and a user-initiated one owe different feedback, and joining the
   * wrong one used to mean the user's explicit pull-to-refresh silently rode
   * along on a scan that could not redirect to paywall/setup, prompt for SMS
   * permission, or show the up-to-date toast — all gated on `interactive`.
   */
  const importInFlight = React.useRef<{
    promise: Promise<AutoImportOutcome>;
    interactive: boolean;
  } | null>(null);

  // Read the real platform capability whenever Home regains focus. This makes
  // the card turn on immediately after returning from Settings or iOS setup,
  // without making the user relaunch to see that their choice worked.
  useFocusEffect(
    useCallback(() => {
      let current = true;
      void (async () => {
        if (Platform.OS === 'ios') {
          const [cfg, automationProof] = await Promise.all([
            getRelayConfig(),
            getRelayAutomationProof(),
          ]);
          if (!current) return;
          setCaptureState(
            cfg?.setupState === 'verified' && automationProof
              ? 'active'
              : cfg?.setupState === 'verified'
                ? 'pipe-ready'
              : cfg
                ? 'needs-test'
                : 'off',
          );
          return;
        }
        if (Platform.OS === 'android' && isSmsScanningAvailable()) {
          const granted = await hasSmsPermission().catch(() => false);
          if (!current) return;
          setNeedsPermission(!granted);
          setCaptureState(granted ? 'active' : 'off');
          return;
        }
        if (current) setCaptureState('unsupported');
      })();
      return () => {
        current = false;
      };
    }, []),
  );

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
  // Both halves of a move between the user's own accounts. Without this the
  // arriving half reads exactly like being paid.
  const internal = useMemo(
    () => internalTransferIds(state.transactions, liveAccounts),
    [state.transactions, liveAccounts],
  );

  // Raw financial totals and their per-row displayed equivalents are built in
  // one pass. Home and Flow consume these same fields, so neither screen gets
  // to invent a second whole-AED answer.
  const summary = useMemo(
    () => summarizeMonth(state.transactions, period, liveAccounts, internal),
    [state.transactions, period, liveAccounts, internal],
  );
  const categorySpend = useMemo(
    () => new Map(summary.byCategory.map((row) => [row.category, row.totalFils] as const)),
    [summary],
  );

  // One insight, not five. The rest are on Flow.
  /**
   * The hero's three figures, reconciled. Every transaction is rounded exactly
   * as its Activity row is shown before it enters In or Out, and the net is the
   * difference of those visible columns. A drill-down can therefore be checked
   * by eye instead of exposing a second, hidden-fils answer.
   */
  const hero = useMemo(() => {
    const incomeFils = summary.incomeShownFils;
    const expenseFils = summary.expenseShownFils;
    return { incomeFils, expenseFils, netFils: incomeFils - expenseFils };
  }, [summary]);

  const unassignedCount = useMemo(
    () => state.transactions.filter((transaction) => isUnassignedAccountRef(transaction.accountId)).length,
    [state.transactions],
  );

  const insight = useMemo(() => {
    const all = buildInsights(
      state.transactions,
      state.budgets,
      period,
      now,
      state.notSubscriptions,
      liveAccounts,
      internal,
      { current: summary, categorySpend },
    );
    return all.find((i) => i.id !== dismissedInsight) ?? null;
  }, [state.transactions, state.budgets, period, now, state.notSubscriptions, liveAccounts, internal, summary, categorySpend, dismissedInsight]);

  const today = useMemo(
    () =>
      state.transactions
        .filter(
          (transaction) =>
            !transaction.isTransfer &&
            !internal.has(transaction.id) &&
            liveAccounts.has(transaction.accountId) &&
            inPeriod(transaction.date, period),
        )
        .slice(0, 6),
    [state.transactions, period, internal, liveAccounts],
  );

  const foreignActivity = useMemo(
    () =>
      summarizeForeignActivity(
        state.transactions,
        (transaction) =>
          inPeriod(transaction.date, period) && isSpending(transaction, liveAccounts, internal),
      ),
    [state.transactions, period, liveAccounts, internal],
  );

  const lastAutomatic = useMemo(
    () => state.transactions.find((tx) => tx.source === 'sms'),
    [state.transactions],
  );

  // Foreign-only alerts arrive with an offline estimate so capture never
  // blocks on a network. Once the ledger is visible, replace only those
  // estimates with a dated public reference rate. A bank-quoted AED
  // equivalent is authoritative and Private Mode makes no request at all.
  useEffect(() => {
    if (!state.hydrated || state.privateMode) return;
    const pending = state.transactions
      .filter((tx) => tx.fxSource === 'fallback')
      .slice(0, 16);
    if (pending.length === 0) return;
    const signature = pending
      .map((tx) => `${tx.id}:${tx.originalCurrency}:${tx.date}`)
      .join('|');
    if (signature === lastFxAttempt.current) return;
    lastFxAttempt.current = signature;
    void buildReferenceFxUpdates(
      pending,
      getActiveMarket().currency.code,
    ).then((updates) => {
      if (updates.length > 0) applyFxUpdates(updates);
    });
  }, [state.hydrated, state.privateMode, state.transactions, applyFxUpdates]);

  const performAutoImport = useCallback(
    async (interactive: boolean): Promise<AutoImportOutcome> => {
      // Never scan against a ledger that has not finished loading. Every
      // duplicate check in the plan is a lookup against state.transactions,
      // so an unhydrated store means nothing matches and the entire inbox
      // imports as new — on top of the rows that arrive a moment later. The
      // effect below already waits for this; pull-to-refresh did not.
      if (!state.hydrated) {
        if (interactive) toast.show(t('stillLoading'));
        return 'not-hydrated';
      }
      // Hard paywall: tracking pauses when the trial ends without Pro — but
      // only on a build that can actually sell it. See isProActive.
      if (!isProActive(state, Date.now(), isBillingAvailable())) {
        if (interactive) router.push('/pro');
        return 'not-pro';
      }
      if (!isCaptureAvailable()) return 'unavailable';
      // Android needs the SMS permission before it can read anything. iOS has
      // no permission to ask for — its messages arrive over the relay — so the
      // prompt is skipped there rather than shown and refused.
      if (isSmsScanningAvailable()) {
        let granted = await hasSmsPermission();
        if (!granted && interactive) granted = await requestSmsPermission();
        if (!granted) {
          setNeedsPermission(true);
          setCaptureState('off');
          return 'no-permission';
        }
        setNeedsPermission(false);
        setCaptureState('active');
      }

      const { plan, source, commit, needsSetup } = await planNewMessages(state);
      if (needsSetup) {
        // The relay is not paired yet, so silence here means "not connected",
        // not "nothing new". Only say so when the user actually asked.
        if (interactive) router.push('/ios-setup');
        return 'needs-setup';
      }
      // healedCount belongs in this test. A re-read that only CORRECTS rows —
      // exactly what a parser fix produces — was being thrown away here, so the
      // corrections never reached the store.
      if (plan.txCount === 0 && plan.dueCount === 0 && plan.healedCount === 0) {
        markParserVersion();
        // Nothing arrived, so nothing is owed — but acking is still correct:
        // the relay may have queued rows that deduped against an earlier
        // in-memory import whose first disk write failed. Flush the current
        // authoritative ledger before dropping those server rows.
        if (source === 'relay') await ensureDurable();
        await commit();
        if (interactive) toast.show(t('upToDateNoNew'));
        return 'up-to-date';
      }
      const receipt = importBatch(plan.batch);
      // A React dispatch is not a disk commit. Wait for the encrypted SQLite
      // transaction; only then is it safe to drop the relay's sealed copy.
      await receipt.durable;
      await commit();
      committed();
      toast.show(
        tf('importedTransactions', {
          count: plan.txCount,
          s: plan.txCount === 1 ? '' : 's',
          cards:
            plan.newAccountCount > 0
              ? tf('importedNewCards', {
                  count: plan.newAccountCount,
                  s: plan.newAccountCount === 1 ? '' : 's',
                })
              : '',
        }),
        [
          { label: t('undo'), onPress: () => undoBatch(receipt.ids) },
          { label: t('review'), onPress: () => router.push('/transactions?source=sms') },
        ],
      );
      return 'imported';
    },
    [state, importBatch, ensureDurable, undoBatch, markParserVersion, toast, router],
  );

  // The single owner of `importInFlight`. Always starts a fresh scan — callers
  // that should instead join one already running go through `runAutoImport`.
  const startAutoImport = useCallback(
    (interactive: boolean): Promise<AutoImportOutcome> => {
      const operation = performAutoImport(interactive).finally(() => {
        if (importInFlight.current?.promise === operation) importInFlight.current = null;
      });
      importInFlight.current = { promise: operation, interactive };
      return operation;
    },
    [performAutoImport],
  );

  const runAutoImport = useCallback(
    (interactive: boolean): Promise<void> => {
      const existing = importInFlight.current;
      if (!existing) return startAutoImport(interactive).then(() => undefined);
      // Two silent callers, or an interactive caller joining another
      // interactive one already in flight: the one running owns delivering
      // whatever feedback applies, same as before.
      if (!interactive || existing.interactive) return existing.promise.then(() => undefined);
      // An explicit action (pull-to-refresh, tapping the capture card) joined
      // a scan nobody was watching. That scan only ever ran its `interactive`
      // branches as false, so a permission prompt, a paywall/setup redirect,
      // or the up-to-date toast never fired — the user's tap would otherwise
      // get no feedback at all. None of those outcomes did any actual
      // reading or importing, so re-running interactively is a fresh first
      // attempt for this request, not a second scan of the same data. The one
      // exception is `'imported'`, whose toast already fires unconditionally.
      return existing.promise.then((outcome) =>
        outcome === 'imported' ? undefined : startAutoImport(true).then(() => undefined),
      );
    },
    [startAutoImport],
  );

  // Silent auto-import on open, and again every time the app comes back to
  // the foreground.
  //
  // This used to run once per JS session, behind a module-level flag that was
  // never reset. Android keeps the JS context alive when the app is
  // backgrounded, so "once per session" meant once per COLD START: leaving the
  // app to pay for something and coming back — the exact moment a new bank SMS
  // exists — imported nothing, and the charge only appeared after a manual
  // pull-to-refresh. The app looked like it could not see messages it had
  // already captured.
  useEffect(() => {
    if (!state.hydrated) return;

    const scan = () => {
      if (Date.now() - lastScanAt < RESCAN_AFTER_MS) return;
      lastScanAt = Date.now();
      void runAutoImport(false).catch(() => {
        // Best-effort; manual import still available.
      });
    };

    scan();

    if (!sessionSetupRan) {
      sessionSetupRan = true;
      (async () => {
        try {
          // Ask the store who this customer is, once per launch.
          //
          // Without this, `pro` was a local boolean that nothing ever
          // re-checked: once true it stayed true through a lapsed
          // subscription, a refund or a cancellation, and a reinstall left a
          // paying customer to find the Restore button by themselves.
          //
          // A null answer means the store could not be reached, which is NOT
          // the same as not having paid — the cached flag stands in that
          // case, so a flight does not lock someone out of their own ledger.
          const entitled = await refreshEntitlement();
          if (entitled !== null && entitled !== state.pro) setPro(entitled);
        } catch {
          // Entitlement is best-effort; the cached flag stands.
        }
        try {
          await enableRelayBackgroundSync();
          // Never prompt on launch. Reminder/instant-alert surfaces ask only
          // after the user explicitly enables them; this call is a no-op when
          // notification authorization has not already been granted.
          await syncPaymentReminders(state);
        } catch {
          // Reminders are best-effort; the ledger does not depend on them.
        }
      })();
    }

    const sub = RNAppState.addEventListener('change', (next) => {
      if (next === 'active') scan();
    });
    return () => sub.remove();
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
          removeClippedSubviews={Platform.OS === 'android'}
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
              <IconButton name="sliders" label={t('settingsTitle')} onPress={() => router.push('/settings')} />
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
            // Both cells use the same per-row whole-AED rule as Activity; net
            // is their difference, not a third measurement of the raw fils.
            netFils={hero.netFils}
            incomeFils={hero.incomeFils}
            expenseFils={hero.expenseFils}
          />

          <AutomaticCapture
            status={
              !isProActive(state, Date.now(), isBillingAvailable())
                ? 'paused'
                : needsPermission
                  ? 'off'
                  : captureState
            }
            lastCaptureDate={lastAutomatic?.date}
            onPress={() => {
              if (!isProActive(state, Date.now(), isBillingAvailable())) router.push('/pro');
              else if (Platform.OS === 'ios') router.push('/ios-setup');
              else void runAutoImport(true);
            }}
          />

          {state.hydrated && unassignedCount > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tf('reviewUnassignedCount', {
                count: unassignedCount,
                s: unassignedCount === 1 ? '' : 's',
              })}
              onPress={() => {
                tapped();
                router.push('/transactions?review=unassigned');
              }}
              style={({ pressed }) => [
                styles.unassignedWarning,
                {
                  backgroundColor: `${theme.warning}14`,
                  borderColor: `${theme.warning}55`,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                },
              ]}>
              <View style={[styles.unassignedIcon, { backgroundColor: `${theme.warning}22` }]}>
                <Icon name="alert" size={17} color={theme.warning} />
              </View>
              <View style={styles.unassignedCopy}>
                <ThemedText type="smallBold">
                  {tf('reviewUnassignedCount', {
                    count: unassignedCount,
                    s: unassignedCount === 1 ? '' : 's',
                  })}
                </ThemedText>
                <ThemedText type="micro" themeColor="textSecondary">
                  {t('reviewUnassignedBody')}
                </ThemedText>
              </View>
              <Icon name="chevron-right" size={16} color={theme.textSecondary} />
            </Pressable>
          )}

          {/* One sentence, with somewhere to go. A carousel of five of these
              was five things to skim and nothing to act on. */}
          {insight && (
            <Animated.View
              entering={enter(FadeInDown.delay(40).duration(320))}
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
                  accessibilityRole="button"
                  onPress={() => {
                    tapped();
                    router.push(insight.href ?? '/flow');
                  }}
                  style={[styles.btn, { backgroundColor: theme.primary }]}>
                  <ThemedText type="nano" style={{ color: theme.onPrimary }}>
                    {t('seeBreakdown')}
                  </ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    tapped();
                    setDismissedInsight(insight.id);
                  }}
                  style={[styles.btn, { borderWidth: 1, borderColor: theme.cardBorder }]}>
                  <ThemedText type="nano" themeColor="textSecondary">
                    {t('dismiss')}
                  </ThemedText>
                </Pressable>
              </View>
            </Animated.View>
          )}

          <LeavingSoon state={state} now={now} onOpen={openOutgoing} />

          {/* Foreign-currency detail is useful but secondary on Home (and has
              a full destination in Wallet). Keeping it below the month's one
              insight and upcoming outgoings prevents four peer cards from
              competing directly under the hero. */}
          <ForeignActivityPreview summary={foreignActivity} />

          <UnreadFormatsPrompt state={state} />

          <Animated.View
            entering={enter(FadeInDown.delay(120).duration(320))}
            style={styles.section}>
            <SectionHeader
              title={live ? t('recentActivity') : periodLabel(period)}
              right={t('allActivity')}
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
                  internal={internal.has(tx.id)}
                />
              </View>
            ))}
            {/* Reading the ledger back off disk takes long enough to paint,
                and an unhydrated store is indistinguishable from an empty one.
                The screen was announcing t('noEntriesPeriod') over
                AED 0 and then replacing it with a real month — telling the user
                their data was gone, every cold start. Skeletons until the store
                says it has looked. */}
            {!state.hydrated && today.length === 0 && <SkeletonRows count={4} height={44} />}
            {state.hydrated && today.length === 0 && (
              <View style={[styles.empty, { borderColor: theme.cardBorderStrong }]}>
                <ThemedText type="display" themeColor="textTertiary" tabular style={styles.emptyFigure}>
                  AED 0
                </ThemedText>
                <ThemedText type="small">{t('noEntriesPeriod')}</ThemedText>
                <ThemedText type="meta" themeColor="textTertiary" style={styles.emptyBody}>
                  {t('emptyPeriodBody')}
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
    marginBottom: Spacing.three,
  },
  topActions: { flexDirection: 'row', gap: Spacing.two },

  capture: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    paddingHorizontal: Spacing.three,
    paddingVertical: 11,
    marginTop: Spacing.four,
  },
  captureIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureText: { flex: 1, gap: 2 },
  captureTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  captureTitle: { flexShrink: 1 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },

  heroLabel: { marginBottom: Spacing.two },
  heroShell: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
    overflow: 'hidden',
  },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  aed: { fontSize: 15, lineHeight: 20 },
  split: { flexDirection: 'row', marginTop: Spacing.four },
  splitCell: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 11,
    paddingBottom: Spacing.two,
    paddingEnd: Spacing.three,
    paddingStart: 0,
    gap: 5,
  },
  splitTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  splitFigure: { fontSize: 17, lineHeight: 22 },
  dot: { width: 5, height: 5, borderRadius: 3 },

  currencyPreview: {
    marginTop: Spacing.four,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  currencyPreviewTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  currencyPreviewHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  currencyRows: { gap: 5, marginTop: Spacing.one },
  currencyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  currencyOriginal: { flex: 1 },

  unassignedWarning: {
    minHeight: 64,
    marginTop: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.tile,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  unassignedIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unassignedCopy: { flex: 1, gap: 2 },

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
    minHeight: 44,
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

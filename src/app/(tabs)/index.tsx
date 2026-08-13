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
import { Alert, AppState, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TransactionRow } from '@/components/transaction-row';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { CardPaymentSheet } from '@/components/card-payment-sheet';
import { BillDetailSheet } from '@/components/bill-detail-sheet';
import { Icon } from '@/components/ui/icon';
import { useToast } from '@/components/ui/toast';
import { IconButton, PeriodPill, SectionHeader } from '@/components/ui/period-pill';
import { EmptyMonth, SkeletonRows } from '@/components/ui/states';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useAutoImport, type CaptureSurfaceState } from '@/hooks/use-auto-import';
import { useTabBarClearance } from '@/hooks/use-tab-bar-clearance';
import { useScreenEntering } from '@/hooks/use-screen-entering';
import { useTheme } from '@/hooks/use-theme';
import { daysPhrase, type Outgoing } from '@/lib/leaving-soon';
import { formatAED, formatAmount, formatCompactAED, shortDate, totalAsShown } from '@/lib/format';
import { buildReferenceFxUpdates } from '@/lib/fx';
import { tapped } from '@/lib/haptics';
import { syncPaymentReminders } from '@/lib/notifications';
import { periodLabel, type Period } from '@/lib/period';
import type { PeriodComparison } from '@/lib/analytics';
import { usePeriod } from '@/lib/period-context';
import { isProActive } from '@/lib/purchases';
import { ledgerCurrencyCode, ledgerCurrencyDisplay } from '@/lib/markets';
import { useStore } from '@/lib/store';
import { type Subscription } from '@/lib/subscriptions';
import type { CardDue, Transaction } from '@/lib/types';
import { t, tf } from '@/lib/i18n';
import { projectDashboard } from '@/lib/dashboard-projection';
import type { UncategorisedSummary } from '@/lib/uncategorised';

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
            // Ahead of every other iOS branch: a device the relay cut off has
            // a config that still looks finished, and reading it as merely
            // "off" would send the user back through setup with no idea that
            // the phone they are holding was removed on purpose.
            : status === 'revoked'
              ? t('captureIosRevoked')
            : status === 'pipe-ready'
              ? t('captureIosPipeReady')
            : status === 'needs-test'
              ? t('captureIosNeedsTest')
              : t('captureIosOff')
          : active
            ? t('captureAndroidOn')
            : t('turnOnTracking');
  // `unsupported` is deliberately absent here. Its title is already
  // t('capturePhoneOnly'), and this branch used to return the same key — so the
  // card printed one identical sentence twice, one line under the other, on the
  // first screen of the app. There is nothing more to say in that state, so the
  // detail line is dropped rather than padded, and the render below skips it.
  const detail: string | null = status === 'paused'
    ? t('trialEndedBannerSub')
    : status === 'unsupported'
    ? null
    : status === 'checking'
    ? t('capturePhoneOnly')
    : active
    ? lastCaptureDate
      ? tf('captureLatest', { date: shortDate(lastCaptureDate) })
      : Platform.OS === 'ios'
        ? t('captureSyncNow')
        : t('captureAndroidPrivate')
    : status === 'revoked'
      ? t('captureIosRevokedDetail')
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
        accessibilityLabel={[t('automaticCapture'), title, detail].filter(Boolean).join('. ')}
        disabled={status === 'checking' || status === 'unsupported'}
        onPress={() => {
          tapped();
          onPress();
        }}
        style={({ pressed }) => [
          styles.capture,
          active && styles.captureHealthy,
          {
            backgroundColor: active ? 'transparent' : theme.backgroundElement,
            borderColor: active ? 'transparent' : theme.cardBorder,
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
          {detail ? (
            <ThemedText type="meta" themeColor="textTertiary">
              {detail}
            </ThemedText>
          ) : null}
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

/**
 * One aggregate doorway, never one warning per unrecognized message.
 *
 * The review tray is structured evidence only and none of it is ledger money.
 * Keeping this as a separate target under capture preserves the capture card's
 * existing contract: that card still syncs or finishes setup; this one reviews.
 */
function ReviewAlertsPrompt({ count, onPress }: { count: number; onPress: () => void }) {
  const theme = useTheme();
  const enter = useScreenEntering();
  if (count === 0) return null;
  const label = tf('reviewAlertsHomeCount', { count, s: count === 1 ? '' : 's' });

  return (
    <Animated.View entering={enter(FadeInDown.delay(40).duration(280))}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${t('reviewAlertsTitle')}. ${label}`}
        accessibilityHint={t('reviewAlertsPrivacy')}
        onPress={() => {
          tapped();
          onPress();
        }}
        style={({ pressed }) => [
          styles.reviewPrompt,
          {
            borderColor: theme.cardBorder,
            backgroundColor: theme.backgroundElement,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          },
        ]}>
        <View style={[styles.reviewPromptIcon, { backgroundColor: theme.backgroundSelected }]}>
          <Icon name="alert" size={17} color={theme.warning} />
        </View>
        <ThemedText type="small" style={styles.reviewPromptCopy}>
          {label}
        </ThemedText>
        <ThemedText type="nano" style={{ color: theme.warning }}>
          {t('review')}
        </ThemedText>
        <Icon name="chevron-right" size={15} color={theme.textTertiary} />
      </Pressable>
    </Animated.View>
  );
}

/**
 * The comparison, as a sentence rather than a signed number.
 *
 * A bare "+4,890" needs the reader to work out the sign convention before it
 * means anything, and on a spending figure the intuitive reading of a plus is
 * backwards — more spent is worse. The words do that work: "more spent than Jul".
 *
 * Rounded to whole dirhams before the zero test, so a difference of eleven
 * fils reads as "the same" rather than as a change nobody can see. The colour
 * follows the same rule the rest of the app uses for money leaving.
 */
function comparisonSentence(c: PeriodComparison): string {
  const amount = formatAmount(Math.abs(c.deltaFils), { decimals: false });
  const period = c.previousLabel;
  const same = Math.round(Math.abs(c.deltaFils) / 100) === 0;
  if (same) return t(c.partial ? 'homeVsSamePartial' : 'homeVsSameWhole').replace('{period}', period);
  const key = c.deltaFils > 0
    ? (c.partial ? 'homeVsMorePartial' : 'homeVsMoreWhole')
    : (c.partial ? 'homeVsLessPartial' : 'homeVsLessWhole');
  return tf(key, { amount, period });
}

/* ── Hero ─────────────────────────────────────────────────────────────── */

function Hero({
  period,
  live,
  netFils,
  incomeFils,
  expenseFils,
  comparison,
}: {
  period: Period;
  live: boolean;
  netFils: number;
  incomeFils: number;
  expenseFils: number;
  comparison: PeriodComparison | null;
}) {
  const theme = useTheme();
  const router = useRouter();
  const enter = useScreenEntering();

  const caption =
    t('netAfterSpending') +
    ' ' +
    (live
      ? t('soFarThisMonth')
      : period.mode === 'all'
        ? t('allTime')
        : `${t('inWord')} ${periodLabel(period)}`);

  return (
    // No shell. This carried a bordered card filled with a three-stop
    // LinearGradient, directly above a comment saying "no card, no background"
    // and against theme.ts's own doctrine that grouping is done with 1px
    // dividers rather than boxes. The gradient also hard-coded six hexes that
    // exist in neither theme, so it did not move with the palette.
    <Animated.View entering={enter(FadeInDown.duration(320))}>
      <ThemedText type="meta" themeColor="textTertiary" style={styles.heroLabel}>
        {caption}
      </ThemedText>

      {/* The same period before this one, over the same number of days.
          Rendered only when there is something honest to compare against —
          `periodComparison` returns null for a ledger with no prior history,
          and "+100% vs nothing" would be the loudest claim this screen makes
          resting on the least evidence it has. Nothing is not a dash and not
          a 0%; it is nothing. */}
      {comparison && (
        <ThemedText
          type="meta"
          style={[
            styles.heroCompare,
            {
              color:
                comparison.deltaFils === 0
                  ? theme.textSecondary
                  : comparison.deltaFils > 0
                    ? theme.expense
                    : theme.income,
            },
          ]}>
          {comparisonSentence(comparison)}
        </ThemedText>
      )}

      {/* No card, no background. The figure IS the top of the screen. */}
      {Math.abs(netFils) >= 1_000_000_000 ? (
        <ThemedText type="display" tabular>
          <ThemedText type="smallBold" themeColor="textSecondary" tabular style={styles.aed}>
            {ledgerCurrencyDisplay()}{' '}
          </ThemedText>
          {netFils < 0 ? '−' : ''}
          {formatCompactAED(netFils)}
        </ThemedText>
      ) : (
        <View style={styles.heroRow}>
          <ThemedText type="smallBold" themeColor="textSecondary" tabular style={styles.aed}>
            {ledgerCurrencyDisplay()}
          </ThemedText>
          <ThemedText type="display" tabular>
            {netFils < 0 ? '−' : ''}
            {formatAmount(Math.abs(netFils), { decimals: false })}
          </ThemedText>
        </View>
      )}

      {/* Two cells divided by rules rather than boxed — the split is a
          continuation of the hero, not a separate component. */}
      <View style={styles.split}>
        {(
          [
            [t('inLabel'), incomeFils, theme.income, '/transactions?type=income'],
            [t('spentLabel'), expenseFils, theme.expense, '/transactions?type=expense'],
          ] as const
        ).map(([label, fils, color, href], i) => (
          <Pressable
            key={label}
            accessibilityRole={href ? 'button' : 'text'}
            accessibilityLabel={`${label}, ${formatAED(fils, { decimals: false })}`}
            onPress={href ? () => {
              tapped();
              router.push(href);
            } : undefined}
            style={[
              styles.splitCell,
              { borderTopColor: theme.cardBorder },
              i > 0 && { borderStartWidth: StyleSheet.hairlineWidth, borderStartColor: theme.cardBorder },
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
  items,
  withinDays,
  onOpen,
}: {
  items: Outgoing[];
  withinDays: number;
  onOpen: (item: Outgoing) => void;
}) {
  const theme = useTheme();
  const enter = useScreenEntering();
  const [expanded, setExpanded] = useState(false);
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
            ? tf('overdueAndLeaving', { days: withinDays })
            : tf('leavingInDays', { days: withinDays })
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
function UnreadFormatsPrompt({ count, shouldPrompt }: { count: number; shouldPrompt: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  if (!shouldPrompt) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tf('reportUnreadFormatsA11y', { count })}
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
          {tf('unreadFormatCount', { count, s: count === 1 ? '' : 's' })}
        </ThemedText>
        <ThemedText type="meta" themeColor="textTertiary">
          {t('unreadMessageHint')}
        </ThemedText>
      </View>
      <Icon name="chevron-right" size={16} color={theme.textTertiary} />
    </Pressable>
  );
}

/* ── Merchants with no category ───────────────────────────────────────── */

/**
 * The sibling of the row above, for the failure the row above cannot fix.
 *
 * `UnreadFormatsPrompt` collects messages the parser could not READ and sends
 * them to the developer. This one is for messages it read perfectly: the shop
 * name is right, and nothing shipped in an update will ever know what
 * "AL BAIT ALHAMAWI SUP" sells. Only the person who shopped there knows, and
 * one real ledger had 182 such entries sitting in Other.
 *
 * Same floor, same reasoning, and it is worth restating because this is the
 * row most likely to become a nag: below `CATEGORISE_PROMPT_THRESHOLD`
 * merchants it says nothing at all. One unrecognised shop is the normal
 * steady state of a working parser, and a prompt that is permanently on the
 * first screen of the app is a prompt the user learns to look past — which
 * costs nothing today and costs the whole feature on the day the list is
 * forty merchants deep.
 *
 * Dismissal is for this session only, exactly like the insight card below it.
 * A permanent dismissal would need a store flag, and the honest answer is that
 * the list grows: a user who dismissed it in March should be asked again once
 * six new shops have piled up. Coming back next launch IS the right behaviour
 * as long as the floor keeps it quiet the rest of the time.
 */
function CategorisePrompt({
  summary,
  shouldPrompt,
}: {
  summary: UncategorisedSummary;
  shouldPrompt: boolean;
}) {
  const theme = useTheme();
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || !shouldPrompt) return null;

  const count = summary.merchants.length;
  // The dismiss control is a sibling of the tappable area rather than a child
  // of it. Nesting a button inside a button gives a screen reader one target
  // with two actions and no way to say which is which, and the row has two
  // genuinely different meanings — "take me there" and "not now".
  return (
    <View
      style={[
        styles.notice,
        { borderColor: theme.cardBorder, backgroundColor: theme.backgroundElement },
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tf('categoriseMerchantsA11y', { count })}
        onPress={() => {
          tapped();
          router.push('/categorise');
        }}
        style={({ pressed }) => [styles.noticeMain, pressed && { opacity: 0.6 }]}>
        <Icon name="filter" size={17} color={theme.warning} />
        <View style={styles.noticeText}>
          <ThemedText type="small">
            {tf('uncategorisedMerchantCount', { count, s: count === 1 ? '' : 's' })}
          </ThemedText>
          <ThemedText type="meta" themeColor="textTertiary">
            {t('uncategorisedMerchantHint')}
          </ThemedText>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('dismiss')}
        hitSlop={10}
        onPress={() => {
          tapped();
          setDismissed(true);
        }}>
        <Icon name="close" size={16} color={theme.textTertiary} />
      </Pressable>
    </View>
  );
}

/* ── Screen ───────────────────────────────────────────────────────────── */

export default function HomeScreen() {
  const theme = useTheme();
  const enter = useScreenEntering();
  const clearance = useTabBarClearance();
  const router = useRouter();
  const toast = useToast();
  const { state, applyFxUpdates, setCaptureOptOut } = useStore();
  const { period } = usePeriod();
  // The tabs shell owns launch/foreground scanning so a restored Bills, Flow
  // or Wallet tab still runs parser migrations. Home owns only this visible
  // status surface and joins the shell's module-level in-flight scan on tap.
  const { runAutoImport, needsPermission, captureState } = useAutoImport(false, true);
  // One value for what the card SAYS and what tapping it DOES. They used to be
  // written out separately and drifted: the tap handler branched on the
  // platform alone, so a fully verified iOS user — card reading "Shortcut
  // connected", live dot, ON badge — tapped it and was dropped back into the
  // four-step setup they had finished weeks earlier, with no way to sync from
  // the surface whose whole job is syncing.
  const captureStatus: CaptureSurfaceState = !isProActive(state)
    ? 'paused'
    : state.captureOptOut || needsPermission
      ? 'off'
      : captureState;

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setNow(new Date());
    });
    return () => subscription.remove();
  }, []);
  const reviewAlertCount = state.reviewTray.pending.filter(
    (item) => item.expiresAt > now.getTime(),
  ).length;
  const [refreshing, setRefreshing] = useState(false);
  const [periodSheetOpen, setPeriodSheetOpen] = useState(false);
  const [dismissedInsight, setDismissedInsight] = useState<string | null>(null);
  const [entry, setEntry] = useState<Transaction | null>(null);
  const [cardDue, setCardDue] = useState<CardDue | null>(null);
  const [recurring, setRecurring] = useState<Subscription | null>(null);
  const lastFxAttempt = React.useRef('');
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

  // Home's pure facts cross one seam. Account visibility, internal transfers,
  // reconciled hero arithmetic, comparison, insights, prompts, and rows are
  // projected together so adjacent figures cannot drift onto different ledger
  // definitions while the screen stays focused on interactions and rendering.
  const dashboard = useMemo(
    () =>
      projectDashboard({
        state,
        period,
        now,
        dismissedInsightId: dismissedInsight,
      }),
    // The projection intentionally depends on ledger slices, not the whole
    // context object. Review-tray, entitlement, and theme updates
    // must not repeat the 10k-row financial analysis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.hydrated,
      state.transactions,
      state.accounts,
      state.budgets,
      state.bills,
      state.cardDues,
      state.notSubscriptions,
      state.merchantOverrides,
      state.language,
      period,
      now,
      dismissedInsight,
    ],
  );
  const insight = dashboard.insight;

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
      ledgerCurrencyCode(),
    ).then((updates) => {
      if (updates.length > 0) applyFxUpdates(updates);
    });
  }, [state.hydrated, state.privateMode, state.transactions, applyFxUpdates]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await runAutoImport(true);
      await syncPaymentReminders(state);
    } catch {
      toast.show(t('captureRefreshFailed'), { tone: 'error' });
    } finally {
      setRefreshing(false);
    }
  }, [runAutoImport, state, toast]);

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
                label={t('searchMerchants')}
                onPress={() => router.push('/transactions')}
              />
              <IconButton name="sliders" label={t('settingsTitle')} onPress={() => router.push('/settings')} />
            </View>
          </View>

          {!state.hydrated ? (
            <View
              style={styles.homeLoading}
              accessibilityLabel={t('loadingLedger')}
              accessibilityRole="progressbar">
              <SkeletonRows count={1} height={76} />
              <SkeletonRows count={2} height={48} />
              <SkeletonRows count={3} height={52} />
            </View>
          ) : (
          <>
          <Hero
            period={period}
            live={dashboard.live}
            comparison={dashboard.comparison}
            // Income, spending, and saved come from one arithmetic, so the hero equals its
            // own In and Spent cells. It read "63,039 in, 8,815 spent, saved 54,223" —
            // a subtraction that is off by one, in 40px type, at the top of
            // the screen. Each cell was rounded on its own while the net was
            // computed from the raw fils and rounded once more.
            //
            // Spent is the composition total, which Flow prints above the
            // category split; in is rounded the same way; and the net is the
            // difference between those two, not a third measurement.
            netFils={dashboard.hero.netFils}
            incomeFils={dashboard.hero.incomeFils}
            expenseFils={dashboard.hero.expenseFils}
          />

          <AutomaticCapture
            status={captureStatus}
            lastCaptureDate={dashboard.lastAutomaticCaptureDate}
            onPress={() => {
              if (captureStatus === 'paused') router.push('/pro');
              else if (state.captureOptOut) {
                // This tap is the user's explicit reversal of the durable
                // no-capture choice. Persist it before opening setup; a stale
                // Android READ_SMS grant must never be enough on its own.
                void setCaptureOptOut(false).then(() => {
                  if (Platform.OS === 'ios') router.push('/ios-setup');
                  // Android's foreground effect observes this preference
                  // change and starts with a fresh callback/state snapshot.
                  // Calling the old render's callback here would see the old
                  // opt-out and make this first tap look broken.
                }).catch(() => Alert.alert(t('capturePreferenceFailed')));
              }
              // Only iOS states that still owe the user setup go to the
              // wizard: 'off' (no relay config), 'needs-test' (paired but
              // unverified), 'pipe-ready' (verified pipe, automation not yet
              // proven) and 'revoked' (the relay cut this device off, so the
              // way back is a new pairing) each have something left to finish
              // there — and 'revoked' is why this stayed a !== test. 'active'
              // does not — its own detail line is "tap to sync now" — so it
              // gets the sync, exactly as Android does.
              else if (Platform.OS === 'ios' && captureStatus !== 'active') {
                router.push('/ios-setup');
              } else void runAutoImport(true);
            }}
          />

          {/* One next action, not four competing notices. */}
          {reviewAlertCount > 0 ? (
            <ReviewAlertsPrompt
              count={reviewAlertCount}
              onPress={() => router.push('/review-alerts')}
            />
          ) : dashboard.uncategorised.shouldPrompt ? (
            <CategorisePrompt summary={dashboard.uncategorised.summary} shouldPrompt />
          ) : dashboard.unreadFormats.shouldPrompt ? (
            <UnreadFormatsPrompt count={dashboard.unreadFormats.count} shouldPrompt />
          ) : insight ? (
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
          ) : null}

          <LeavingSoon
            items={dashboard.upcoming.items}
            withinDays={dashboard.upcoming.withinDays}
            onOpen={openOutgoing}
          />

          <Animated.View
            entering={enter(FadeInDown.delay(120).duration(320))}
            style={styles.section}>
            <SectionHeader
              title={dashboard.live ? t('recentActivity') : periodLabel(period)}
              right={t('allActivity')}
              onPressRight={() => router.push('/transactions')}
            />
            {dashboard.activityRows.map((tx, i) => (
              <View
                key={tx.id}
                style={
                  i > 0
                    ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.cardBorder }
                    : undefined
                }>
                <TransactionRow
                  transaction={tx}
                  account={dashboard.accountById.get(tx.accountId)}
                  onPress={setEntry}
                  internal={dashboard.internalTransactionIds.has(tx.id)}
                />
              </View>
            ))}
            {dashboard.activityRows.length === 0 && (
              <EmptyMonth
                monthName={periodLabel(period)}
                onReadInbox={() => void runAutoImport(true)}
                primaryLabel={t('checkBankAlerts')}
                body={t('emptyMonthCaptureHelp')}
                onAddManually={() => router.push('/add-transaction')}
              />
            )}
          </Animated.View>
          </>
          )}
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
  homeLoading: { gap: Spacing.four, paddingTop: Spacing.two },

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
  captureHealthy: {
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: Spacing.two,
    marginTop: Spacing.three,
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
  reviewPrompt: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control,
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  reviewPromptIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewPromptCopy: { flex: 1 },

  heroLabel: { marginBottom: Spacing.two },
  heroCompare: { marginTop: Spacing.two, marginBottom: Spacing.two },
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
  // The tappable part of a notice that also carries a dismiss, so the two
  // controls stay separate targets. See CategorisePrompt.
  noticeMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },

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

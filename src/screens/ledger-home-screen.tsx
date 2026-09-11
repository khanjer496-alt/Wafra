/**
 * Money overview, capture status and recent activity.
 * Detailed spending insights live on Flow; upcoming payments remain actionable below.
 */
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, Platform, Pressable, RefreshControl, StyleSheet, View } from 'react-native';

import { PeriodSheet } from '@/components/period-sheet';
import { ThemedText } from '@/components/themed-text';
import { TransactionRow } from '@/components/transaction-row';
import { EntryDetailSheet } from '@/components/entry-detail-sheet';
import { CardPaymentSheet } from '@/components/card-payment-sheet';
import { BillDetailSheet } from '@/components/bill-detail-sheet';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { MotionReveal } from '@/components/ui/motion-reveal';
import { SpringPressable } from '@/components/ui/spring-pressable';
import { useToast } from '@/components/ui/toast';
import { usePrivacyGateCleared } from '@/components/lock-gate';
import { PeriodPill, SectionHeader } from '@/components/ui/period-pill';
import { ScreenScaffold } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { EmptyMonth, SkeletonRows } from '@/components/ui/states';
import { Radius, Spacing } from '@/constants/theme';
import { useAutoImport, type CaptureSurfaceState } from '@/hooks/use-auto-import';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { daysPhrase, type Outgoing } from '@/lib/leaving-soon';
import { formatAED, formatAmount, shortDate } from '@/lib/format';
import { buildReferenceFxUpdates } from '@/lib/fx';
import { tapped } from '@/lib/haptics';
import { syncPaymentReminders } from '@/lib/notifications';
import { periodLabel } from '@/lib/period';
import type { PeriodComparison } from '@/lib/analytics';
import { usePeriod } from '@/lib/period-context';
import { isProActive } from '@/lib/purchases';
import { ledgerCurrencyCode } from '@/lib/markets';
import { useStore } from '@/lib/store';
import { type Subscription } from '@/lib/subscriptions';
import type { CardDue, Transaction } from '@/lib/types';
import type { HistoryImportProgress } from '@/lib/history-import';
import { t, tf } from '@/lib/i18n';
import { projectDashboard } from '@/lib/dashboard-projection';
import { openSmsPermissionSettings } from '@/lib/auto-import';
import { markLaunchPhase } from '@/lib/launch-performance';
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
  const active = status === 'waiting-for-alert' || status === 'first-alert-captured';
  const title =
    status === 'paused'
      ? t('trialEndedBanner')
      : status === 'checking'
      ? t('captureChecking')
      : status === 'unsupported'
        ? t('capturePhoneOnly')
        : Platform.OS === 'ios'
          ? status === 'first-alert-captured'
            ? t('captureIosFirstAlertCaptured')
            : status === 'waiting-for-alert'
              ? t('captureIosWaitingForAlert')
              : status === 'needs-automation'
                ? t('captureIosNeedsAutomation')
                : status === 'queue-warning'
                  ? t('captureIosQueueWarning')
                  : status === 'migration-retry'
                    ? t('captureIosMigrationRetry')
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
    : status === 'unsupported' || status === 'off' || status === 'waiting-for-alert'
    ? null
    : status === 'checking'
    ? t('capturePhoneOnly')
    : status === 'first-alert-captured' && lastCaptureDate
    ? tf('captureLatest', { date: shortDate(lastCaptureDate) })
    : active
      ? Platform.OS === 'ios' ? t('captureIosLocalPrivacy') : t('captureAndroidPrivate')
    : status === 'queue-warning'
      ? t('captureIosQueueWarningDetail')
    : status === 'migration-retry'
      ? t('captureIosMigrationRetryDetail')
    : Platform.OS === 'android'
      ? t('trackingPrivacy')
      : t('captureIosSetupDetail');
  const badge = status === 'paused'
    ? t('pausedBadge')
    : active
    ? t('captureReady')
    : status === 'queue-warning'
      ? t('captureRecover')
    : status === 'needs-automation' || status === 'migration-retry'
      ? t('captureFinish')
      : status === 'checking' || status === 'unsupported'
        ? null
        : t('captureEnable');

  return (
    <SpringPressable
      accessibilityRole="button"
      accessibilityLabel={[t('automaticCapture'), title, detail].filter(Boolean).join('. ')}
      disabled={status === 'checking' || status === 'unsupported'}
      onPress={() => {
        tapped();
        onPress();
      }}
      scaleTo={0.985}
      style={[
        styles.capture,
        active && styles.captureHealthy,
        {
          backgroundColor: 'transparent',
          borderColor: theme.cardBorder,
        },
      ]}>
      <View
        style={[
          styles.captureIcon,
          { backgroundColor: active ? theme.primarySoft : theme.backgroundSelected },
        ]}>
        <Icon name="mail" size={18} color={active ? theme.primary : theme.textSecondary} />
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
      {badge && !active ? (
        <ThemedText type="nano" style={{ color: active ? theme.primary : theme.warning }}>
          {badge}
        </ThemedText>
      ) : null}
      {status !== 'checking' && status !== 'unsupported' ? (
        <Icon name="chevron-right" size={15} color={theme.textTertiary} />
      ) : null}
    </SpringPressable>
  );
}

function HistoryImportNotice({
  progress,
  onRetry,
  onOpenSettings,
}: {
  progress: HistoryImportProgress | null;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  const theme = useTheme();
  if (!progress || progress.status === 'complete') return null;
  const failed = progress.status === 'failed';
  const accessFailed = progress.error === 'inbox-access';
  const title = failed ? t('historyImportSavedTitle') : t('historyImportRunningTitle');
  const detail = failed
    ? t(accessFailed ? 'historyImportAccessBody' : 'historyImportSavedBody')
    : tf('historyImportLiveProgress', { scanned: progress.scanned, found: progress.found });
  return (
    <View style={[styles.historyImport, {
        backgroundColor: failed ? theme.goldSoft : theme.primarySoft,
        borderColor: failed ? theme.cardBorderStrong : theme.primaryBorder,
      }]}>
      <Icon
        name={failed ? 'alert' : 'download'}
        size={17}
        color={failed ? theme.warning : theme.primary}
      />
      <View
        accessible
        accessibilityLiveRegion="polite"
        accessibilityRole={failed ? 'text' : 'progressbar'}
        accessibilityValue={failed ? undefined : { min: 0, now: progress.scanned }}
        accessibilityLabel={`${title}. ${detail}`}
        style={styles.historyImportCopy}>
        <ThemedText type="smallBold">{title}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{detail}</ThemedText>
      </View>
      {failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(accessFailed ? 'openPhoneSettings' : 'retryHistoryImport')}
          hitSlop={8}
          onPress={accessFailed ? onOpenSettings : onRetry}
          style={styles.historyImportRetry}>
          <ThemedText type="nano" style={{ color: theme.warning }}>
            {t(accessFailed ? 'openPhoneSettings' : 'retryHistoryImport')}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
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
  if (count === 0) return null;
  const label = tf('reviewAlertsHomeCount', { count, s: count === 1 ? '' : 's' });

  return (
    <SpringPressable
      accessibilityRole="button"
      accessibilityLabel={`${t('reviewAlertsTitle')}. ${label}`}
      accessibilityHint={t('reviewAlertsPrivacy')}
      onPress={() => {
        tapped();
        onPress();
      }}
      scaleTo={0.985}
      style={[
        styles.reviewPrompt,
        {
          borderColor: theme.cardBorder,
          backgroundColor: theme.backgroundElement,
        },
      ]}>
      <View style={[styles.reviewPromptIcon, { backgroundColor: theme.goldSoft }]}>
        <Icon name="alert" size={17} color={theme.warning} />
      </View>
      <ThemedText type="small" style={styles.reviewPromptCopy}>
        {label}
      </ThemedText>
      <Icon name="chevron-right" size={15} color={theme.textTertiary} />
    </SpringPressable>
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
  const same = c.deltaFils === 0;
  if (same) return t(c.partial ? 'homeVsSamePartial' : 'homeVsSameWhole').replace('{period}', period);
  const key = c.deltaFils > 0
    ? (c.partial ? 'homeVsMorePartial' : 'homeVsMoreWhole')
    : (c.partial ? 'homeVsLessPartial' : 'homeVsLessWhole');
  return tf(key, { amount, period });
}

/* ── Hero ─────────────────────────────────────────────────────────────── */

function Hero({
  netFils,
  incomeFils,
  expenseFils,
  comparison,
  onChangePeriod,
}: {
  netFils: number;
  incomeFils: number;
  expenseFils: number;
  comparison: PeriodComparison | null;
  onChangePeriod: () => void;
}) {
  const theme = useTheme();
  const router = useRouter();
  const largeText = useLargeTextLayout();

  const caption = t('totalOut');

  return (
    <View style={styles.heroPanel}>
      <View style={styles.heroHeading}>
        <ThemedText type="meta" style={[styles.heroLabel, { color: theme.textSecondary }]}>
          {caption}
        </ThemedText>
        <PeriodPill onPress={onChangePeriod} />
      </View>

      <SpringPressable
        accessibilityRole="button"
        accessibilityLabel={`${caption}, ${formatAED(expenseFils, { decimals: false })}`}
        onPress={() => { tapped(); router.push('/transactions?type=expense'); }}
        scaleTo={0.99}
        style={styles.heroSpendTarget}>
        <Money fils={expenseFils} type="display" color={theme.text} style={styles.heroAmount} />
      </SpringPressable>

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
              color: theme.textSecondary,
            },
          ]}>
          {comparisonSentence(comparison)}
        </ThemedText>
      )}

      <View style={[styles.split, largeText && styles.splitLarge]}>
        <SpringPressable
          accessibilityRole="button"
          accessibilityLabel={`${t('inLabel')}, ${formatAED(incomeFils, { decimals: false })}`}
          onPress={() => { tapped(); router.push('/transactions?type=income'); }}
          scaleTo={0.985}
          style={[styles.splitCell, { borderTopColor: theme.cardBorder }]}>
          <View style={styles.splitTop}>
            <View style={[styles.dot, { backgroundColor: theme.income }]} />
            <ThemedText type="nano" style={{ color: theme.textSecondary }}>{t('inLabel')}</ThemedText>
          </View>
          <ThemedText type="small" tabular style={[styles.splitFigure, { color: theme.text }]}>
            {formatAmount(incomeFils, { decimals: false })}
          </ThemedText>
        </SpringPressable>
        <View
          accessible
          accessibilityLabel={`${t('netAfterSpending')}, ${formatAED(netFils, { decimals: false })}`}
          style={[styles.splitCell, { borderTopColor: theme.cardBorder },
            !largeText && { borderStartWidth: StyleSheet.hairlineWidth, borderStartColor: theme.cardBorder, paddingStart: Spacing.three }]}>
          <ThemedText type="nano" style={{ color: theme.textSecondary }}>{t('netAfterSpending')}</ThemedText>
          <ThemedText type="small" tabular style={[styles.splitFigure, { color: theme.text }]}>
            {formatAmount(netFils, { decimals: false })}
          </ThemedText>
        </View>
      </View>
    </View>
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
/** Home prioritises dated obligations; detected recurring charges stay in Bills. */
export function homePaymentGroups(items: readonly Outgoing[]): { due: Outgoing[]; upcoming: Outgoing[] } {
  const due: Outgoing[] = [];
  const upcoming: Outgoing[] = [];
  for (const item of items) {
    if (item.kind === 'subscription') continue;
    (item.overdue || item.urgent ? due : upcoming).push(item);
  }
  return { due, upcoming };
}

function LeavingSoon({
  items,
  title,
  onOpen,
}: {
  items: Outgoing[];
  title: string;
  onOpen: (item: Outgoing) => void;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  // Keep individual obligations visible without treating a mixed list as one bill.
  const shown = expanded ? items : items.slice(0, 3);
  const hidden = items.length - shown.length;

  return (
    <View style={styles.section}>
      <SectionHeader
        title={title}
      />
      {shown.map((x, i) => {
        const alarming = x.overdue || x.urgent;
        return (
          <SpringPressable
            key={x.id}
            accessibilityRole="button"
            accessibilityLabel={x.title}
            onPress={() => onOpen(x)}
            scaleTo={0.99}
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
          </SpringPressable>
        );
      })}
      {hidden > 0 && (
        <SpringPressable
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
          scaleTo={0.99}
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

        </SpringPressable>
      )}
    </View>
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

export default function LedgerHomeScreen() {
  const theme = useTheme();
  const focused = useIsFocused();
  const privacyGateCleared = usePrivacyGateCleared();
  const router = useRouter();
  const toast = useToast();
  const { state, applyFxUpdates, setCaptureOptOut, beginHistoryImport } = useStore();
  const { period } = usePeriod();
  // The tabs shell owns launch/foreground scanning so a restored Bills, Flow
  // or Wallet tab still runs parser migrations. Home owns only this visible
  // status surface and joins the shell's module-level in-flight scan on tap.
  const { runAutoImport, needsPermission, captureState } = useAutoImport(false, true);
  useEffect(() => {
    if (focused && privacyGateCleared && state.hydrated && state.onboarded) {
      markLaunchPhase('first-usable-home');
    }
  }, [focused, privacyGateCleared, state.hydrated, state.onboarded]);
  // One value for what the card SAYS and what tapping it DOES. They used to be
  // written out separately and drifted: the tap handler branched on the
  // platform alone, so a fully verified iOS user — card reading "Shortcut
  // connected", live dot, ON badge — tapped it and was dropped back into the
  // four-step setup they had finished weeks earlier, with no way to sync from
  // the surface whose whole job is syncing.
  const captureStatus: CaptureSurfaceState = state.captureOptOut || needsPermission
    ? 'off'
    : Platform.OS === 'android' && !isProActive(state)
      ? 'paused'
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
        dismissedInsightId: null,
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
    ],
  );

  const { due: duePayments, upcoming: upcomingPayments } = homePaymentGroups(dashboard.upcoming.items);

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

  const homeHeader: ScreenHeaderProps = {
    title: t('tabHome'),
    actions: [
      {
        label: t('searchMerchants'),
        icon: 'search',
        onPress: () => router.push('/transactions'),
      },
      {
        label: t('settingsTitle'),
        icon: 'sliders',
        onPress: () => router.push('/settings'),
      },
    ],
  };

  return (
    <>
      <ScreenScaffold
        tabbed
        headerMode="inline"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primary} />
        }
        header={homeHeader}>
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
          <MotionReveal delay={45} distance={22} scaleFrom={0.955}>
            <Hero
              comparison={dashboard.comparison}
              onChangePeriod={() => setPeriodSheetOpen(true)}
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
          </MotionReveal>

          <MotionReveal delay={115} distance={18} scaleFrom={0.97}>
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
                else if (Platform.OS === 'ios' &&
                  (captureStatus === 'off' || captureStatus === 'needs-automation')) {
                  router.push('/ios-setup');
                } else if (captureStatus === 'queue-warning') {
                  router.push('/settings');
                } else void runAutoImport(true);
              }}
            />
          </MotionReveal>
          <HistoryImportNotice
            progress={state.historyImport}
            onRetry={() => void beginHistoryImport()}
            onOpenSettings={() => void openSmsPermissionSettings()
              .then(() => beginHistoryImport())}
          />



          {/* One next action, not four competing notices. */}
          {(reviewAlertCount > 0 || dashboard.uncategorised.shouldPrompt || dashboard.unreadFormats.shouldPrompt) && (
          <MotionReveal delay={165} distance={16} scaleFrom={0.975}>
            {reviewAlertCount > 0 ? (
              <ReviewAlertsPrompt
                count={reviewAlertCount}
                onPress={() => router.push('/review-alerts')}
              />
            ) : dashboard.uncategorised.shouldPrompt ? (
              <CategorisePrompt summary={dashboard.uncategorised.summary} shouldPrompt />
            ) : dashboard.unreadFormats.shouldPrompt ? (
              <UnreadFormatsPrompt count={dashboard.unreadFormats.count} shouldPrompt />
            ) : null}
          </MotionReveal>
          )}

          {duePayments.length > 0 && (
          <MotionReveal delay={215} distance={18} scaleFrom={0.97}>
            <LeavingSoon
              items={duePayments}
              title={t('homeDuePayments')}
              onOpen={openOutgoing}
            />
          </MotionReveal>
          )}
          <MotionReveal delay={265} distance={20} scaleFrom={0.97} style={styles.section}>
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
                onAddManually={() => router.push('/add-transaction')}
              />
            )}
          </MotionReveal>

          {upcomingPayments.length > 0 && (
          <MotionReveal delay={215} distance={18} scaleFrom={0.97}>
            <LeavingSoon
              items={upcomingPayments}
              title={t('homeUpcomingPayments')}
              onOpen={openOutgoing}
            />
          </MotionReveal>
          )}
          </>
        )}
      </ScreenScaffold>
      <PeriodSheet visible={periodSheetOpen} onClose={() => setPeriodSheetOpen(false)} />
      <EntryDetailSheet transaction={entry} onClose={() => setEntry(null)} />
      <CardPaymentSheet due={cardDue} onClose={() => setCardDue(null)} />
      <BillDetailSheet subscription={recurring} onClose={() => setRecurring(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  homeLoading: { gap: 18, paddingTop: Spacing.one },

  capture: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 0,
    paddingVertical: 9,
    marginTop: Spacing.one,
  },
  captureHealthy: {
    borderWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 6,
    marginTop: 10,
  },
  captureIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureText: { flex: 1, gap: 2 },
  captureTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  captureTitle: { flexShrink: 1 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  historyImport: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: Spacing.one,
    padding: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control,
  },
  historyImportCopy: { flex: 1, gap: 2 },
  historyImportRetry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.two },
  reviewPrompt: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control,
    marginTop: Spacing.one,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  reviewPromptIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewPromptCopy: { flex: 1 },

  heroSpendTarget: { minHeight: 48, justifyContent: 'center' },
  heroPanel: { paddingVertical: 12, marginTop: 0 },
  heroHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two, marginBottom: 12 },
  heroLabel: { flex: 1, minWidth: 100 },
  heroCompare: { marginTop: 12 },
  heroAmount: { flexDirection: 'row', alignItems: 'baseline', flexShrink: 1, minWidth: 0 },
  aed: { fontSize: 15, lineHeight: 20 },
  split: { flexDirection: 'row', marginTop: Spacing.three },
  splitLarge: { flexDirection: 'column' },
  splitCell: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
    paddingTop: 9,
    paddingBottom: 6,
    paddingEnd: 12,
    paddingStart: 0,
    gap: 5,
  },
  splitTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  splitFigure: { fontSize: 22, lineHeight: 28 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  currencyPreview: {
    marginTop: Spacing.three,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sheet,
    padding: 12,
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

  section: { marginTop: 18 },

  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
    marginTop: 18,
    padding: 12,
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
    paddingVertical: 11,
  },
  leaveText: { flex: 1, gap: 1 },

  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: Radius.sheet + 2,
    padding: 18,
    gap: 6,
    alignItems: 'flex-start',
  },
  emptyFigure: { opacity: 0.35, marginBottom: Spacing.two },
  emptyBody: { maxWidth: 320 },
});

import { workflowCopy } from '@/components/workflows/workflow-copy';
import { useRouter } from 'expo-router';
import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BandScaffold, useBandBottomInset } from '@/components/ui/band-scaffold';
import { EButton } from '@/components/ui/band/e-button';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Icon, type IconName } from '@/components/ui/icon';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { useToast } from '@/components/ui/toast';
import { Fonts, Radius, Spacing, type BandPalette } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { detailsWords } from '@/lib/details-copy';
import { shortDate, toISODate } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import { t, tf, type StringKey } from '@/lib/i18n';
import { isIosApplePayReview, isIosNotificationReview, isUniversalReviewAlert, recentlyExpiredReviewCount, recentlyLostReviewCount, reviewCaptureBacklog, reviewExpiresInDays, reviewTrayCapacity, type ReviewAlert, type ReviewEntry, type UniversalReviewAlert } from '@/lib/alert-review-tray';
import { isOrdinaryUniversalPosting, reviewMoneyChoices, universalMoneyLabel } from '@/components/universal-review-fields';
import { reviewAlertCopy } from '@/lib/review-alert-copy';
import { reviewIsPurchase, reviewMerchant, reviewReason, type ReviewReason } from '@/lib/review-reasons';
import { transactionsWords } from '@/lib/transactions-copy';
import type { UniversalField, UniversalMoney } from '@/lib/universal-types';
import { useStore } from '@/lib/store';
import { localReviewAdvisor } from '@/lib/local-semantic-review';

const FAMILY_COPY: Record<ReviewAlert['family'], { label: StringKey; icon: IconName }> = {
  purchase: { label: 'reviewAlertPossiblePurchase', icon: 'cart' },
  transfer: { label: 'reviewAlertPossibleTransfer', icon: 'arrow-up-right' },
  'cash-withdrawal': { label: 'reviewAlertPossibleCash', icon: 'cash' },
  refund: { label: 'reviewAlertPossibleRefund', icon: 'repeat' },
  fee: { label: 'reviewAlertPossibleFee', icon: 'receipt' },
  utility: { label: 'reviewAlertPossibleUtility', icon: 'bolt' },
  'recurring-payment': { label: 'reviewAlertPossibleRecurring', icon: 'repeat' },
};

const ACRONYMS = new Map([
  ['abn', 'ABN'], ['abc', 'ABC'], ['bbk', 'BBK'], ['bbva', 'BBVA'], ['bnp', 'BNP'],
  ['cib', 'CIB'], ['hdfc', 'HDFC'], ['hsbc', 'HSBC'], ['icici', 'ICICI'], ['ing', 'ING'],
  ['nbb', 'NBB'], ['nbe', 'NBE'], ['nbk', 'NBK'], ['pnb', 'PNB'], ['qib', 'QIB'],
  ['qnb', 'QNB'], ['sbi', 'SBI'], ['uk', 'UK'], ['us', 'US'],
]);

/** Apple's product name, written as Apple writes it in both languages. */
const APPLE_PAY = 'Apple Pay';

function institutionLabel(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((word) => ACRONYMS.get(word) ?? (word === 'jpmorgan'
      ? 'JPMorgan'
      : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`))
    .join(' ');
}

function amountLabel(item: ReviewAlert): string {
  const { currency, minorUnits, exponent } = item.amount;
  if (exponent === 0) return `${currency} ${minorUnits}`;
  const padded = minorUnits.padStart(exponent + 1, '0');
  const split = padded.length - exponent;
  return `${currency} ${padded.slice(0, split)}.${padded.slice(split)}`;
}

function instrumentLabel(instrument: { kind: 'card' | 'account' | 'wallet'; last4: string | null } | null | undefined): string | null {
  if (!instrument?.last4) return null;
  const key: StringKey = instrument.kind === 'card'
    ? 'reviewAlertCardEnding'
    : instrument.kind === 'account'
      ? 'reviewAlertAccountEnding'
      : 'reviewAlertWalletEnding';
  return tf(key, { last4: instrument.last4 });
}

/** The one sentence that says why this item is waiting. Two reasons already have their own warning line. */
function reasonSentence(reason: ReviewReason, language: string): string {
  if (reason === 'apple-pay-duplicate') return t('reviewAlertPossibleApplePayDuplicate');
  if (reason === 'notification-replay') return t('reviewAlertPossibleNotificationReplay');
  return detailsWords(language).review.why[reason];
}

function reasonFor(item: ReviewEntry): ReviewReason {
  return reviewReason(item, isUniversalReviewAlert(item)
    ? { ordinaryPosting: isOrdinaryUniversalPosting(item.event), amountChoices: reviewMoneyChoices(item.event).length }
    : { ordinaryPosting: true, amountChoices: 1 });
}

/** What the card shows first: the stated amount, in the alert's own currency (never converted). */
function headlineAmount(item: ReviewEntry): { amount: string; fact: StringKey | null } {
  if (!isUniversalReviewAlert(item)) return { amount: amountLabel(item), fact: null };
  const event = item.event;
  const facts: [StringKey, UniversalField<UniversalMoney>][] = [
    ['genericAmount', event.amount], ['genericStatementTotal', event.statementTotal],
    ['genericBalance', event.balance], ['genericCreditLimit', event.creditLimit],
    ['genericMinimumDue', event.minimumDue],
  ];
  const fact = facts.find(([, field]) => field.evidence === 'explicit' && field.value !== null);
  return {
    amount: fact?.[1].value ? universalMoneyLabel(fact[1].value) : t('genericAmountNeedsReview'),
    fact: fact?.[0] ?? null,
  };
}

/** Where the capture came from, as the card's small print. No message text is stored to quote. */
function sourceLabel(item: ReviewEntry): string | null {
  if (isIosApplePayReview(item)) return APPLE_PAY;
  if (isIosNotificationReview(item)) return t('reviewAlertNotificationSource');
  return null;
}

/** Logo tile only for a merchant the alert named; otherwise the family glyph on the sheet's one glyph ground. */
function ReviewTile({ item, merchant, palette, size = 40 }: { item: ReviewEntry; merchant: string | null; palette: BandPalette; size?: number }) {
  if (merchant) return <View testID="review-merchant-tile"><MerchantAvatar title={merchant} category="other" size={size} /></View>;
  const icon = isUniversalReviewAlert(item) ? 'receipt' : FAMILY_COPY[item.family].icon;
  return <View testID="review-family-tile" style={[styles.glyph, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: palette.glyphGround }]}>
    <Icon name={icon} size={Math.round(size * 0.45)} color={palette.text} />
  </View>;
}

function ExpiryNotice({ item, palette }: { item: ReviewEntry; palette: BandPalette }) {
  const days = reviewExpiresInDays(item, Date.now());
  if (days === null) return null;
  return <ThemedText testID="review-alert-expiry" type="meta" style={{ color: palette.statusNear }}>{tf('reviewAlertExpiresIn', { count: days })}</ThemedText>;
}

/** The on-device model's advisory line. It only ever suggests; the person still confirms in Add. */
function LocalAdvisory({ item, palette }: { item: UniversalReviewAlert; palette: BandPalette }) {
  const language = useLanguage();
  const aiCopy = reviewAlertCopy[language === 'ar' ? 'ar' : 'en'].localAi;
  const advisory = useSyncExternalStore(localReviewAdvisor.subscribe,
    () => localReviewAdvisor.get(item), () => null);
  if (!advisory) return null;
  return <View testID="review-local-ai-advisory" accessibilityLiveRegion="polite" style={{ gap: Spacing.half }}>
    <ThemedText type="small" style={{ color: palette.textSecondary }}>
      {advisory.kind === 'parser-family-advisory'
        ? `${aiCopy.suggestion}: ${t(FAMILY_COPY[advisory.family as ReviewAlert['family']]?.label ?? 'genericReviewTitle')}`
        : advisory.kind === 'pending' ? aiCopy.pending : aiCopy.unavailable}
    </ThemedText>
    {advisory.kind === 'parser-family-advisory' ?
      <ThemedText type="meta" style={{ color: palette.textSecondary }}>{aiCopy.confirm}</ThemedText> : null}
  </View>;
}

function UniversalAlertRow({ item, busy, onAdd, onDismiss, palette }: {
  item: UniversalReviewAlert; busy: boolean; onAdd: () => void; onDismiss: () => void; palette: BandPalette;
}) {
  const language = useLanguage();
  const words = reviewAlertCopy[language === 'ar' ? 'ar' : 'en'];
  const event = item.event;
  const informational = !isOrdinaryUniversalPosting(event);
  const key = event.family === 'statement' ? 'genericStatement'
    : event.family === 'balance' ? 'genericBalanceUpdate'
    : event.family === 'card-payment' ? 'genericCardPayment'
    : event.family === 'bill' ? 'genericBill' : 'genericReviewTitle';
  const { amount, fact } = headlineAmount(item);
  const merchant = reviewMerchant(item);
  const reason = reasonFor(item);
  const source = sourceLabel(item);
  const identity = [t(key), merchant, fact ? `${t(fact)}: ${amount}` : amount].filter(Boolean).join('. ');
  return (
    <View testID="review-alert-row" style={[styles.alertRow, { borderColor: palette.rule }]}>
      <View style={styles.alertMain}>
        <ReviewTile item={item} merchant={merchant} palette={palette} />
        <View style={styles.alertCopy}>
          {source ? <ThemedText type="meta" style={{ color: palette.textSecondary }}>{source}</ThemedText> : null}
          {item.attentionReason === 'possible-notification-replay' && (
            <ThemedText type="smallBold" style={{ color: palette.statusNear }}>{t('reviewAlertPossibleNotificationReplay')}</ThemedText>
          )}
          {item.attentionReason === 'possible-apple-pay-duplicate' && (
            <ThemedText testID="review-alert-apple-pay-duplicate" type="smallBold" style={{ color: palette.statusNear }}>{t('reviewAlertPossibleApplePayDuplicate')}</ThemedText>
          )}
          <View style={styles.headline}>
            <ThemedText type="smallBold" style={[styles.headlineTitle, { color: palette.text }]} numberOfLines={2}>{merchant ?? t(key)}</ThemedText>
            <ThemedText type="smallBold" tabular style={{ color: palette.text }}>{amount}</ThemedText>
          </View>
          {merchant ? <ThemedText type="meta" style={{ color: palette.textSecondary }}>{t(key)}</ThemedText> : null}
          {fact ? <ThemedText type="meta" style={{ color: palette.textSecondary }}>{t(fact)}</ThemedText> : null}
          {reason !== 'apple-pay-duplicate' && reason !== 'notification-replay' ? (
            <ThemedText testID="review-alert-reason" type="small" style={{ color: palette.textSecondary }}>{reasonSentence(reason, language)}</ThemedText>
          ) : null}
          {informational ? <ThemedText type="meta" style={{ color: palette.textSecondary }}>{words.informationHint}</ThemedText> : null}
          <ThemedText type="meta" style={{ color: palette.textSecondary }}>{t('genericUnverifiedIssuer')} · {shortDate(toISODate(new Date(item.observedAt)))}</ThemedText>
          <ExpiryNotice item={item} palette={palette} />
          <LocalAdvisory item={item} palette={palette} />
        </View>
      </View>
      <View style={styles.rowActions}>
        <Pressable testID="review-alert-open" accessibilityRole="button" accessibilityLabel={`${t(informational ? 'genericReviewDetails' : 'reviewAlertReview')}. ${identity}`}
          accessibilityState={{ disabled: busy }} disabled={busy} onPress={onAdd}
          style={({ pressed }) => [styles.addButton, { opacity: busy ? 0.45 : pressed ? 0.78 : 1 }]}>
          <ThemedText type="smallBold" style={{ color: palette.tint }}>{t(informational ? 'genericReviewDetails' : 'reviewAlertReview')}</ThemedText>
          <Icon name="chevron-right" size={15} color={palette.tint} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${t('dismiss')}. ${identity}`}
          accessibilityHint={t('reviewAlertDismissBody')} accessibilityState={{ disabled: busy }}
          disabled={busy} onPress={onDismiss}
          style={({ pressed }) => [styles.dismissButton, { opacity: busy ? 0.45 : pressed ? 0.72 : 1 }]}>
          <ThemedText type="small" style={{ color: palette.textSecondary }}>{t('dismiss')}</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function AlertRow({
  item,
  busy,
  onAdd,
  onDismiss,
  palette,
}: {
  item: ReviewEntry;
  busy: boolean;
  onAdd: () => void;
  onDismiss: () => void;
  palette: BandPalette;
}) {
  const language = useLanguage();
  if (isUniversalReviewAlert(item)) return <UniversalAlertRow item={item} busy={busy} onAdd={onAdd} onDismiss={onDismiss} palette={palette} />;
  const family = FAMILY_COPY[item.family];
  const amount = amountLabel(item);
  const direction = t(item.direction === 'debit' ? 'reviewAlertMoneyOut' : 'reviewAlertMoneyIn');
  const instrument = instrumentLabel(item.instrument);
  const date = shortDate(toISODate(new Date(item.observedAt)));
  const bank = institutionLabel(item.institution);
  const reason = reasonFor(item);
  const source = sourceLabel(item);

  return (
    <View testID="review-alert-row" style={[styles.alertRow, { borderColor: palette.rule }]}>
      <View style={styles.alertMain}>
      <ReviewTile item={item} merchant={null} palette={palette} />
      <View style={styles.alertCopy}>
        {source ? <ThemedText type="meta" style={{ color: palette.textSecondary }}>{source}</ThemedText> : null}
        {item.attentionReason === 'possible-apple-pay-duplicate' && (
          <ThemedText testID="review-alert-apple-pay-duplicate" type="smallBold" style={{ color: palette.statusNear }}>{t('reviewAlertPossibleApplePayDuplicate')}</ThemedText>
        )}
        {item.attentionReason === 'possible-notification-replay' && (
          <ThemedText type="smallBold" style={{ color: palette.statusNear }}>{t('reviewAlertPossibleNotificationReplay')}</ThemedText>
        )}
        <ThemedText type="smallBold" style={{ color: palette.text }}>{t(family.label)}</ThemedText>
        <ThemedText type="title" tabular style={[styles.amount, { color: palette.text }]}>
          {amount}
        </ThemedText>
        {reason !== 'apple-pay-duplicate' && reason !== 'notification-replay' ? (
          <ThemedText testID="review-alert-reason" type="small" style={{ color: palette.textSecondary }}>{reasonSentence(reason, language)}</ThemedText>
        ) : null}
        <ThemedText type="meta" style={{ color: palette.textSecondary }}>
          {[bank, item.market, direction].join(' · ')}
        </ThemedText>
        <ThemedText type="meta" style={{ color: palette.textSecondary }}>
          {[instrument, date].filter(Boolean).join(' · ')}
        </ThemedText>
        <ExpiryNotice item={item} palette={palette} />
      </View>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          testID="review-alert-open"
          accessibilityRole="button"
          accessibilityLabel={`${t('reviewAlertReview')}. ${t(family.label)}. ${amount}. ${bank}`}
          accessibilityHint={t('reviewAlertAddHint')}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => {
            tapped();
            onAdd();
          }}
          style={({ pressed }) => [
            styles.addButton,
            { opacity: busy ? 0.45 : pressed ? 0.78 : 1 },
          ]}>
          <ThemedText type="smallBold" style={{ color: palette.tint }}>
            {t('reviewAlertReview')}
          </ThemedText>
          <Icon name="chevron-right" size={15} color={palette.tint} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('dismiss')}. ${t(family.label)}. ${amount}. ${bank}`}
          accessibilityHint={t('reviewAlertDismissBody')}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => {
            tapped();
            onDismiss();
          }}
          style={({ pressed }) => [
            styles.dismissButton,
            { opacity: busy ? 0.45 : pressed ? 0.72 : 1 },
          ]}>
          <ThemedText type="small" style={{ color: palette.textSecondary }}>
            {t('dismiss')}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The item being checked, one at a time: a card in the sheet's cream set on
 * the green band. Logo tile only for a merchant the alert named; the amount
 * is the alert's own (a foreign alert shows its original currency, never a
 * converted figure); the reason is the one sentence the tray's structured
 * fields support. The queue stores no bank message text, so none is shown.
 */
function StepCard({ item, palette }: { item: ReviewEntry; palette: BandPalette }) {
  const language = useLanguage();
  const d = detailsWords(language);
  const words = reviewAlertCopy[language === 'ar' ? 'ar' : 'en'];
  const merchant = reviewMerchant(item);
  const { amount, fact } = headlineAmount(item);
  const reason = reasonFor(item);
  const universal = isUniversalReviewAlert(item);
  const informational = universal && !isOrdinaryUniversalPosting(item.event);
  const instrument = instrumentLabel(universal ? item.event.instrument.value : item.instrument);
  const title = merchant ?? (universal ? t('genericReviewTitle') : t(FAMILY_COPY[item.family].label));
  const date = shortDate(toISODate(new Date(item.observedAt)));
  const meta = [sourceLabel(item), universal ? t('genericUnverifiedIssuer') : institutionLabel(item.institution), instrument, date]
    .filter(Boolean).join(' · ');
  const warned = reason === 'apple-pay-duplicate' || reason === 'notification-replay';
  return <View testID="review-step-card" style={[styles.stepCard, { backgroundColor: palette.sheet }]}>
    <View style={styles.alertMain}>
      <ReviewTile item={item} merchant={merchant} palette={palette} size={48} />
      <View style={styles.alertCopy}>
        <ThemedText type="subtitle" numberOfLines={2} style={{ color: palette.text }}>{title}</ThemedText>
        <ThemedText type="meta" style={{ color: palette.textSecondary }}>{meta}</ThemedText>
      </View>
    </View>
    <View style={styles.cardFigure}>
      <ThemedText testID="review-step-amount" style={[styles.cardAmount, { color: palette.text }]}>{amount}</ThemedText>
      <ThemedText type="meta" style={{ color: palette.textSecondary }}>
        {fact && fact !== 'genericAmount' ? `${t(fact)} · ${d.review.original}` : d.review.original}
      </ThemedText>
    </View>
    <View style={[styles.reasonTile, { backgroundColor: warned ? palette.statusNearSoft : palette.glyphGround }]}>
      <ThemedText testID="review-step-reason" type="small" style={{ color: warned ? palette.statusNear : palette.text }}>
        {reasonSentence(reason, language)}
      </ThemedText>
    </View>
    {informational ? <ThemedText type="meta" style={{ color: palette.textSecondary }}>{words.informationHint}</ThemedText> : null}
    <ExpiryNotice item={item} palette={palette} />
    {universal ? <LocalAdvisory item={item} palette={palette} /> : null}
  </View>;
}

/** Previous / next on the band: 44pt round controls in the band's own tone. */
function StepArrow({ label, icon, disabled, onPress, palette }: {
  label: string; icon: IconName; disabled: boolean; onPress: () => void; palette: BandPalette;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    accessibilityState={{ disabled }} onPress={onPress}
    style={({ pressed }) => [styles.stepArrow, { backgroundColor: palette.tile, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 }]}>
    <Icon name={icon} size={20} color={palette.onBand} strokeWidth={2} />
  </Pressable>;
}

export default function ReviewAlertsScreen() {
  const router = useRouter();
  const toast = useToast();
  const language = useLanguage();
  const d = detailsWords(language);
  const band = useBand('flow');
  const largeText = useLargeTextLayout();
  const { state, dismissReviewAlert } = useStore();
  const words = workflowCopy(state.language);
  const [target, setTarget] = useState<ReviewEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // One at a time is the default way in; the full list stays one tap away.
  const [stepping, setStepping] = useState(true);
  const [stepIndex, setStepIndex] = useState(0);
  const listBottom = useBandBottomInset();
  const now = Date.now();
  const pending = useMemo(
    () => state.reviewTray.pending
      .filter((item) => item.expiresAt > now)
      .sort((a, b) => b.observedAt - a.observedAt),
    [state.reviewTray.pending, now],
  );
  // An answered item leaves the queue; the index then already points at the next one.
  const step = pending.length > 0 ? Math.min(stepIndex, pending.length - 1) : 0;
  const stepMode = stepping && pending.length > 0;
  const current = stepMode ? pending[step] : null;

  // Deferred native records stay queued; the banner only explains the wait
  // while a Review lane is actually full, and clears once there is room.
  const backlog = useSyncExternalStore(reviewCaptureBacklog.subscribe,
    reviewCaptureBacklog.get, reviewCaptureBacklog.get);
  const capacity = reviewTrayCapacity(state.reviewTray, now);
  const waiting = capacity.protectedFull || capacity.legacyFull ? backlog.waiting : 0;
  const expired = recentlyExpiredReviewCount(state.reviewTray, now);
  // Auto-added rows are already in the ledger; this links to them so the
  // things to check live in one place without mixing them into this queue.
  const autoAdded = useMemo(() => state.transactions.reduce((n, tx) => (tx.bestEffort ? n + 1 : n), 0),
    [state.transactions]);
  // Durable, source-free counts of money reviews a full lane could not keep.
  const evicted = recentlyLostReviewCount(state.reviewTray, now, 'evicted');
  const currencyEvicted = recentlyLostReviewCount(state.reviewTray, now, 'currency-evicted');
  const notices = waiting > 0 || expired > 0 || evicted > 0 || currencyEvicted > 0 ||
    backlog.currencyConflicts > 0 || autoAdded > 0 ? (
    <View style={styles.notices} testID="review-alerts-notices" accessibilityLiveRegion="polite">
      {autoAdded > 0 ? <Pressable testID="review-alerts-auto-added" accessibilityRole="button"
        accessibilityLabel={tf('autoAddedCount', { count: autoAdded })}
        onPress={() => router.push({ pathname: '/transactions', params: { source: 'auto-added' } })}
        style={{ minHeight: 44, justifyContent: 'center' }}>
        <ThemedText type="smallBold" style={{ color: band.tint }}>
          {tf('autoAddedCount', { count: autoAdded })}
        </ThemedText>
      </Pressable> : null}
      {waiting > 0 ? <ThemedText testID="review-alerts-full" type="smallBold" style={{ color: band.statusNear }}>
        {tf('reviewAlertsFullWaiting', { count: waiting })}
      </ThemedText> : null}
      {expired > 0 ? <ThemedText testID="review-alerts-expired" type="small" style={{ color: band.textSecondary }}>
        {tf('reviewAlertsExpiredCount', { count: expired })}
      </ThemedText> : null}
      {evicted > 0 ? <ThemedText testID="review-alerts-evicted" type="small" style={{ color: band.textSecondary }}>
        {tf('reviewAlertsEvictedCount', { count: evicted })}
      </ThemedText> : null}
      {currencyEvicted > 0 ? <ThemedText testID="review-alerts-currency-evicted" type="small" style={{ color: band.textSecondary }}>
        {tf('reviewAlertsCurrencyEvictedCount', { count: currencyEvicted })}
      </ThemedText> : null}
      {backlog.currencyConflicts > 0 ? <ThemedText testID="review-alerts-currency" type="small" style={{ color: band.textSecondary }}>
        {tf('reviewAlertsCurrencySkipped', { count: backlog.currencyConflicts })}
      </ThemedText> : null}
    </View>
  ) : null;

  const dismiss = async (item: ReviewEntry) => {
    setBusyId(item.id);
    try {
      await dismissReviewAlert(item.id, 'dismissed');
      toast.show(t('reviewAlertDismissed'), { tone: 'info' });
    } catch {
      toast.show(t('reviewAlertDismissFailed'), { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  };
  const openAdd = (item: ReviewEntry) => router.push({ pathname: '/add-transaction', params: { reviewId: item.id } });

  const modeToggle = pending.length > 1 ? (
    <EButton testID="review-mode-toggle" variant="quiet" palette={band}
      label={stepMode ? d.review.showList : d.review.oneByOne}
      onPress={() => { setStepIndex(0); setStepping(!stepMode); }} />
  ) : null;
  const privacy = <ThemedText type="meta" style={[styles.privacyCopy, { color: band.textSecondary }]}>{t('reviewAlertsPrivacy')}</ThemedText>;

  // The band: the one figure ("1 of 3", or the count waiting) and one plain line.
  const countLine = tf('reviewAlertsSettingsCount', { count: pending.length });
  const behind = stepMode ? Math.min(2, pending.length - step - 1) : 0;
  const bandContent = pending.length > 0 ? <>
    <View testID="review-alerts-intro" style={styles.bandIntro}>
      {stepMode ? (
        <View testID="review-stepper" style={[styles.stepHead, largeText && styles.stepHeadStacked]}>
          <ThemedText testID="review-step-position" accessibilityLiveRegion="polite"
            style={[styles.figure, { color: band.onBand }]}>{d.review.position(step + 1, pending.length)}</ThemedText>
          {pending.length > 1 ? <View style={styles.stepArrows}>
            <StepArrow palette={band} label={d.review.previous} disabled={step === 0}
              icon={language === 'ar' ? 'chevron-right' : 'chevron-left'} onPress={() => setStepIndex(Math.max(0, step - 1))} />
            <StepArrow palette={band} label={d.review.next} disabled={step >= pending.length - 1}
              icon={language === 'ar' ? 'chevron-left' : 'chevron-right'} onPress={() => setStepIndex(Math.min(pending.length - 1, step + 1))} />
          </View> : null}
        </View>
      ) : (
        <ThemedText accessibilityLiveRegion="polite" style={[styles.bandHeadline, { color: band.onBand }]}>{countLine}</ThemedText>
      )}
      <ThemedText type="small" style={{ color: band.onBandSecondary }}>{stepMode ? countLine : words.reviewBody}</ThemedText>
    </View>
    {current ? (
      // Two band-tone cards peek from behind the current one while more wait.
      <View testID="review-stack" style={[styles.stack, behind > 0 && !largeText && { paddingBottom: behind * 12 }]}>
        {!largeText && behind >= 2 ? <View testID="review-stack-peek" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={[styles.peek, styles.peekFar, { backgroundColor: band.bandRule }]} /> : null}
        {!largeText && behind >= 1 ? <View testID="review-stack-peek" pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
          style={[styles.peek, styles.peekNear, { backgroundColor: band.bandMark }]} /> : null}
        <StepCard item={current} palette={band} />
      </View>
    ) : null}
  </> : null;

  const currentBusy = current ? busyId === current.id : false;
  const informationalCurrent = !!current && isUniversalReviewAlert(current) && !isOrdinaryUniversalPosting(current.event);
  const stepSheet = current ? <View style={styles.stepSheet}>
    <View style={[styles.answers, largeText && styles.answersStacked]}>
      <EButton testID="review-step-dismiss" variant="secondary" palette={band} style={!largeText && styles.answer}
        label={reviewIsPurchase(current) ? d.review.notPurchase : t('dismiss')}
        accessibilityHint={t('reviewAlertDismissBody')} disabled={currentBusy}
        onPress={() => { tapped(); setTarget(current); }} />
      <EButton testID="review-alert-open" palette={band} style={!largeText && styles.answer}
        label={informationalCurrent ? t('genericReviewDetails') : d.review.looksRight}
        accessibilityHint={informationalCurrent ? undefined : d.review.looksRightHint} disabled={currentBusy}
        onPress={() => { tapped(); openAdd(current); }} />
    </View>
    {!informationalCurrent ? <ThemedText type="meta" style={[styles.answerHint, { color: band.textSecondary }]}>{d.review.looksRightHint}</ThemedText> : null}
    {notices}
    {modeToggle}
    {privacy}
  </View> : null;

  return (
    <>
      <BandScaffold
        band="flow"
        // One card scrolls with its band; the list keeps its own virtualized scroll.
        scroll={stepMode}
        testID="review-alerts-screen"
        contentStyle={!stepMode && styles.listSheet}
        nav={{ back: true, title: transactionsWords(language).review }}
        bandContent={bandContent}>
        {stepMode ? stepSheet : (
        <FlatList
          data={pending}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.listContent, { paddingBottom: listBottom }, pending.length === 0 && styles.emptyContent]}
          scrollIndicatorInsets={{ top: 0, bottom: listBottom }}
          contentInsetAdjustmentBehavior="never"
          ListHeaderComponent={notices || modeToggle ? <View style={styles.listHeader}>{notices}{modeToggle}</View> : null}
          ListFooterComponent={privacy}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="check" size={28} color={band.statusOk} strokeWidth={2.1} />
              <ThemedText type="subtitle" accessibilityRole="header" style={{ color: band.text }}>
                {words.complete}
              </ThemedText>
              <ThemedText type="default" style={{ color: band.textSecondary }}>
                {t('reviewAlertsEmptyBody')}
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => (
            <AlertRow
              item={item}
              busy={busyId === item.id}
              onAdd={() => openAdd(item)}
              onDismiss={() => setTarget(item)}
              palette={band}
            />
          )}
        />
        )}
      </BandScaffold>

      <ConfirmSheet
        visible={target !== null}
        onClose={() => setTarget(null)}
        question={t('reviewAlertDismissQuestion')}
        body={t('reviewAlertDismissBody')}
        confirmLabel={t('dismiss')}
        destructive
        onConfirm={() => {
          if (target) void dismiss(target);
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bandIntro: { gap: Spacing.one },
  // Band figures: Geist SemiBold with tabular digits, never Geist Mono.
  figure: { fontFamily: Fonts.sansSemi, fontSize: 40, lineHeight: 46, letterSpacing: -1.6, fontVariant: ['tabular-nums'], flexShrink: 1 },
  bandHeadline: { fontFamily: Fonts.sansSemi, fontSize: 30, lineHeight: 36, letterSpacing: -1, fontVariant: ['tabular-nums'] },
  stepHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  stepHeadStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  stepArrows: { flexDirection: 'row', gap: Spacing.two },
  stepArrow: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  stack: { marginTop: Spacing.two },
  peek: { position: 'absolute', borderRadius: 26 },
  peekNear: { top: 12, bottom: -12, start: 10, end: 10 },
  peekFar: { top: 24, bottom: -24, start: 20, end: 20, opacity: 0.55 },
  stepCard: { borderRadius: 26, padding: 20, gap: Spacing.three },
  cardFigure: { gap: Spacing.half },
  cardAmount: { fontFamily: Fonts.sansSemi, fontSize: 40, lineHeight: 46, letterSpacing: -1.6, fontVariant: ['tabular-nums'] },
  reasonTile: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  stepSheet: { gap: Spacing.three },
  answers: { flexDirection: 'row', gap: 10 },
  answersStacked: { flexDirection: 'column' },
  answer: { flex: 1 },
  answerHint: { textAlign: 'center' },
  listSheet: { paddingTop: Spacing.two },
  listContent: { gap: 0 },
  listHeader: { gap: Spacing.two, paddingBottom: Spacing.two },
  emptyContent: { flexGrow: 1 },
  notices: { gap: Spacing.two, paddingBottom: Spacing.two },
  privacyCopy: { paddingVertical: Spacing.three },
  alertRow: {
    minHeight: 112,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.three,
  },
  glyph: { alignItems: 'center', justifyContent: 'center' },
  alertCopy: { flex: 1, minWidth: 0, gap: Spacing.half },
  amount: { marginVertical: Spacing.half },
  alertMain: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
  headline: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: Spacing.two },
  headlineTitle: { flexShrink: 1 },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  addButton: {
    flexGrow: 1,
    minWidth: 100,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dismissButton: {
    minWidth: 100,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.control,
  },
  empty: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.six,
  },
});

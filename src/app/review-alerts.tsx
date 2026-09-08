import { workflowCopy } from '@/components/workflows/workflow-copy';
import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Icon, type IconName } from '@/components/ui/icon';
import { ScreenScaffold, useScreenContentInsets } from '@/components/ui/screen-scaffold';
import type { ScreenHeaderProps } from '@/components/ui/screen-header';
import { useToast } from '@/components/ui/toast';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { shortDate, toISODate } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import { t, tf, type StringKey } from '@/lib/i18n';
import { isUniversalReviewAlert, type ReviewAlert, type ReviewEntry, type UniversalReviewAlert } from '@/lib/alert-review-tray';
import { isOrdinaryUniversalPosting, universalMoneyLabel } from '@/components/universal-review-fields';
import { reviewAlertCopy } from '@/lib/review-alert-copy';
import type { UniversalField, UniversalMoney } from '@/lib/universal-types';
import { useStore } from '@/lib/store';

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

function instrumentLabel(item: ReviewAlert): string | null {
  const instrument = item.instrument;
  if (!instrument?.last4) return null;
  const key: StringKey = instrument.kind === 'card'
    ? 'reviewAlertCardEnding'
    : instrument.kind === 'account'
      ? 'reviewAlertAccountEnding'
      : 'reviewAlertWalletEnding';
  return tf(key, { last4: instrument.last4 });
}

function UniversalAlertRow({ item, busy, onAdd, onDismiss }: {
  item: UniversalReviewAlert; busy: boolean; onAdd: () => void; onDismiss: () => void;
}) {
  const theme = useTheme();
  const language = useLanguage();
  const words = reviewAlertCopy[language === 'ar' ? 'ar' : 'en'];
  const event = item.event;
  const informational = !isOrdinaryUniversalPosting(event);
  const key = event.family === 'statement' ? 'genericStatement'
    : event.family === 'balance' ? 'genericBalanceUpdate'
    : event.family === 'card-payment' ? 'genericCardPayment'
    : event.family === 'bill' ? 'genericBill' : 'genericReviewTitle';
  const facts: [StringKey, UniversalField<UniversalMoney>][] = [
    ['genericAmount', event.amount], ['genericStatementTotal', event.statementTotal],
    ['genericBalance', event.balance], ['genericCreditLimit', event.creditLimit],
    ['genericMinimumDue', event.minimumDue],
  ];
  const fact = facts.find(([, field]) => field.evidence === 'explicit' && field.value !== null);
  const amount = fact?.[1].value ? universalMoneyLabel(fact[1].value) : t('genericAmountNeedsReview');
  const identity = [t(key), event.merchant.evidence === 'explicit' ? event.merchant.value : null,
    fact ? `${t(fact[0])}: ${amount}` : amount].filter(Boolean).join('. ');
  return (
    <View testID="review-alert-row" style={[styles.alertRow, { borderColor: theme.cardBorder }]}>
      <View style={styles.alertCopy}>
        <ThemedText type="smallBold">{t(key)}</ThemedText>
        {event.merchant.evidence === 'explicit' ? <ThemedText type="small">{event.merchant.value}</ThemedText> : null}
        {fact ? <ThemedText type="meta" themeColor="textSecondary">{t(fact[0])}</ThemedText> : null}
        <ThemedText type="title" tabular>{amount}</ThemedText>
        {informational ? <ThemedText type="meta" themeColor="textSecondary">{words.informationHint}</ThemedText> : null}
        <ThemedText type="meta" themeColor="textSecondary">{t('genericUnverifiedIssuer')} · {shortDate(toISODate(new Date(item.observedAt)))}</ThemedText>
        <View style={styles.rowActions}>
          <Pressable testID="review-alert-open" accessibilityRole="button" accessibilityLabel={`${t(informational ? 'genericReviewDetails' : 'reviewAlertReview')}. ${identity}`}
            accessibilityState={{ disabled: busy }} disabled={busy} onPress={onAdd} style={styles.addButton}>
            <ThemedText type="smallBold" style={{ color: theme.primary }}>{t(informational ? 'genericReviewDetails' : 'reviewAlertReview')}</ThemedText>
            <Icon name="chevron-right" size={15} color={theme.primary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t('dismiss')}. ${identity}`}
            accessibilityHint={t('reviewAlertDismissBody')} accessibilityState={{ disabled: busy }}
            disabled={busy} onPress={onDismiss} style={styles.dismissButton}>
            <ThemedText type="small" themeColor="textSecondary">{t('dismiss')}</ThemedText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function AlertRow({
  item,
  busy,
  onAdd,
  onDismiss,
}: {
  item: ReviewEntry;
  busy: boolean;
  onAdd: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  if (isUniversalReviewAlert(item)) return <UniversalAlertRow item={item} busy={busy} onAdd={onAdd} onDismiss={onDismiss} />;
  const family = FAMILY_COPY[item.family];
  const amount = amountLabel(item);
  const direction = t(item.direction === 'debit' ? 'reviewAlertMoneyOut' : 'reviewAlertMoneyIn');
  const instrument = instrumentLabel(item);
  const date = shortDate(toISODate(new Date(item.observedAt)));
  const bank = institutionLabel(item.institution);

  return (
    <View testID="review-alert-row" style={[styles.alertRow, { borderColor: theme.cardBorder }]}>
      <View style={styles.alertMain}>
      <View style={[styles.alertIcon, { backgroundColor: theme.backgroundSelected }]}>
        <Icon name={family.icon} size={18} color={theme.warning} />
      </View>
      <View style={styles.alertCopy}>
        <ThemedText type="smallBold">{t(family.label)}</ThemedText>
        <ThemedText type="title" tabular style={styles.amount}>
          {amount}
        </ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">
          {[bank, item.market, direction].join(' · ')}
        </ThemedText>
        <ThemedText type="meta" themeColor="textTertiary">
          {[instrument, date].filter(Boolean).join(' · ')}
        </ThemedText>
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
          <ThemedText type="smallBold" style={{ color: theme.primary }}>
            {t('reviewAlertReview')}
          </ThemedText>
          <Icon name="chevron-right" size={15} color={theme.primary} />
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
          <ThemedText type="small" themeColor="textSecondary">
            {t('dismiss')}
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

export default function ReviewAlertsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const toast = useToast();
  const { state, dismissReviewAlert } = useStore();
  const words = workflowCopy(state.language);
  const [target, setTarget] = useState<ReviewEntry | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const listInsets = useScreenContentInsets({ hasFooter: false });
  const now = Date.now();
  const pending = useMemo(
    () => state.reviewTray.pending
      .filter((item) => item.expiresAt > now)
      .sort((a, b) => b.observedAt - a.observedAt),
    [state.reviewTray.pending, now],
  );

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

  const reviewAlertsHeader: ScreenHeaderProps = {
    title: t('reviewAlertsTitle'),
    back: { label: t('back'), onPress: () => router.back() },
  };

  return (
    <>
      <ScreenScaffold
        scroll={false}
        virtualized
        headerMode="native"
        header={reviewAlertsHeader}>
        <FlatList
          data={pending}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[listInsets.contentContainerStyle, pending.length === 0 && styles.emptyContent]}
          contentInset={listInsets.contentInset}
          scrollIndicatorInsets={listInsets.scrollIndicatorInsets}
          contentInsetAdjustmentBehavior="automatic"
          ListHeaderComponent={pending.length > 0 ? (
            <View style={styles.intro} testID="review-alerts-intro">
              <ThemedText type="smallBold" accessibilityLiveRegion="polite">{tf('reviewAlertsSettingsCount', { count: pending.length })}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">{words.reviewBody}</ThemedText>
            </View>
          ) : null}
          ListFooterComponent={<ThemedText type="meta" themeColor="textSecondary" style={styles.privacyCopy}>{t('reviewAlertsPrivacy')}</ThemedText>}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="check" size={28} color={theme.income} strokeWidth={2.1} />
              <ThemedText type="subtitle" accessibilityRole="header">
                {words.complete}
              </ThemedText>
              <ThemedText type="default" themeColor="textSecondary">
                {t('reviewAlertsEmptyBody')}
              </ThemedText>
            </View>
          }
          renderItem={({ item }) => (
            <AlertRow
              item={item}
              busy={busyId === item.id}
              onAdd={() => router.push({ pathname: '/add-transaction', params: { reviewId: item.id } })}
              onDismiss={() => setTarget(item)}
            />
          )}
        />
      </ScreenScaffold>

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
  emptyContent: { flexGrow: 1 },
  intro: { gap: Spacing.two, paddingBottom: Spacing.three },
  privacyCopy: { paddingVertical: Spacing.three },
  alertRow: {
    minHeight: 112,
    gap: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.three,
  },
  alertIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertCopy: { flex: 1, minWidth: 0, gap: Spacing.half },
  amount: { marginVertical: Spacing.half },
  alertMain: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.three },
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
  },
  empty: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.six,
  },
});

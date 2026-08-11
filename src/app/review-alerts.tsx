import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ConfirmSheet } from '@/components/ui/confirm-sheet';
import { Icon, type IconName } from '@/components/ui/icon';
import { Block, ScreenHeader } from '@/components/ui/layout';
import { useToast } from '@/components/ui/toast';
import { MaxContentWidth, Radius, ScreenPadding, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { shortDate, toISODate } from '@/lib/format';
import { tapped } from '@/lib/haptics';
import { t, tf, type StringKey } from '@/lib/i18n';
import type { ReviewAlert } from '@/lib/alert-review-tray';
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

function AlertRow({
  item,
  busy,
  onAdd,
  onDismiss,
}: {
  item: ReviewAlert;
  busy: boolean;
  onAdd: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const family = FAMILY_COPY[item.family];
  const amount = amountLabel(item);
  const direction = t(item.direction === 'debit' ? 'reviewAlertMoneyOut' : 'reviewAlertMoneyIn');
  const instrument = instrumentLabel(item);
  const date = shortDate(toISODate(new Date(item.observedAt)));
  const bank = institutionLabel(item.institution);

  return (
    <View style={[styles.alertRow, { borderTopColor: theme.cardBorder }]}>
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
      <View style={styles.rowActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('reviewAlertAdd')}. ${t(family.label)}. ${amount}. ${bank}`}
          accessibilityHint={t('reviewAlertAddHint')}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={() => {
            tapped();
            onAdd();
          }}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: theme.primary, opacity: busy ? 0.45 : pressed ? 0.78 : 1 },
          ]}>
          <Icon name="plus" size={14} color={theme.onPrimary} />
          <ThemedText type="nano" style={{ color: theme.onPrimary }}>
            {t('reviewAlertAdd')}
          </ThemedText>
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
            { borderColor: theme.cardBorderStrong, opacity: busy ? 0.45 : pressed ? 0.72 : 1 },
          ]}>
          <Icon name="close" size={14} color={theme.textSecondary} />
          <ThemedText type="nano" themeColor="textSecondary">
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
  const [target, setTarget] = useState<ReviewAlert | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const now = Date.now();
  const pending = useMemo(
    () => state.reviewTray.pending
      .filter((item) => item.expiresAt > now)
      .sort((a, b) => b.observedAt - a.observedAt),
    [state.reviewTray.pending, now],
  );

  const dismiss = async (item: ReviewAlert) => {
    setBusyId(item.id);
    try {
      await dismissReviewAlert(item.id, 'dismissed');
      toast.show(t('reviewAlertDismissed'));
    } catch {
      toast.show(t('reviewAlertDismissFailed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.headerWrap}>
          <ScreenHeader title={t('reviewAlertsTitle')} onBack={() => router.back()} />
        </View>

        <FlatList
          data={pending}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, pending.length === 0 && styles.emptyContent]}
          ListHeaderComponent={
            <View style={styles.intro}>
              <ThemedText type="default" themeColor="textSecondary">
                {t('reviewAlertsIntro')}
              </ThemedText>
              <Block style={styles.privacyBlock}>
                <Icon name="lock" size={16} color={theme.textTertiary} />
                <ThemedText type="meta" themeColor="textSecondary" style={styles.privacyCopy}>
                  {t('reviewAlertsPrivacy')}
                </ThemedText>
              </Block>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="check" size={28} color={theme.income} strokeWidth={2.1} />
              <ThemedText type="subtitle" accessibilityRole="header">
                {t('reviewAlertsEmptyTitle')}
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
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center' },
  safe: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  headerWrap: { paddingHorizontal: ScreenPadding },
  content: {
    paddingHorizontal: ScreenPadding,
    paddingBottom: Spacing.six,
  },
  emptyContent: { flexGrow: 1 },
  intro: { gap: Spacing.three, paddingBottom: Spacing.four },
  privacyBlock: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  privacyCopy: { flex: 1, lineHeight: 19 },
  alertRow: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two + 2,
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
  rowActions: { gap: Spacing.one },
  addButton: {
    minWidth: 64,
    minHeight: 44,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.two,
  },
  dismissButton: {
    minWidth: 64,
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.half,
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

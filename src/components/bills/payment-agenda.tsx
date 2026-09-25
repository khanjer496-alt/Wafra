import { paymentAgendaCopy as copy } from '@/lib/reference-copy';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { BankAvatar } from '@/components/ui/bank-avatar';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { formatAED, shortDate } from '@/lib/format';
import { formatMinorUnits } from '@/lib/ledger-money';
import { measureRuntimeOperation } from '@/lib/runtime-performance';
import {
  groupPaymentAgendaWindow,
  paymentGroupFor,
  type PaymentAgendaItem,
  type PaymentGroup,
} from '@/lib/reference-presentation';
import type { Account } from '@/lib/types';

// A long imported history can produce many recurring candidates. Rendering
// every MerchantAvatar/row into one ScrollView on the first Bills mount blocks
// the JS/UI hand-off even when the underlying analysis is already cached.
const PAYMENT_AGENDA_PAGE_SIZE = 24;
const EMPTY_ACCOUNTS: readonly Account[] = [];

const groupIcons: Record<PaymentGroup, IconName> = {
  subscriptions: 'repeat', utilities: 'bolt', cards: 'wallet', loans: 'bank', other: 'receipt',
};

/** Bills filters choose the payment family; due timing remains the visual hierarchy inside the list. */
// Memoised: Bills re-renders for sheets, forms and segment taps; the agenda
// only needs to when its own inputs change.
export const PaymentAgenda = React.memo(function PaymentAgenda({ items, accounts = EMPTY_ACCOUNTS, includePaid, group: selectedGroup, onOpen }: {
  items: readonly PaymentAgendaItem[];
  accounts?: readonly Account[];
  includePaid: boolean;
  group?: PaymentGroup;
  onOpen: (item: PaymentAgendaItem) => void;
}) {
  const theme = useTheme(); const lang = useLanguage(); const large = useLargeTextLayout();
  const moneySpec = useLedgerMoney();
  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account] as const)),
    [accounts],
  );
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(Math.round(fils), moneySpec)}` : formatAED(fils);
  const w = copy[lang === 'ar' ? 'ar' : 'en'];
  const [renderLimit, setRenderLimit] = useState(PAYMENT_AGENDA_PAGE_SIZE);
  useEffect(() => {
    setRenderLimit(PAYMENT_AGENDA_PAGE_SIZE);
  }, [selectedGroup, includePaid]);
  // Filtering and date grouping both scan the agenda. Keep only the rows that
  // can enter this rendered window; fully sorting a large recurrence result and
  // discarding everything after row 24 can freeze the JS thread exactly when
  // the cooperative detector finishes.
  const visibleItems = useMemo(() => selectedGroup
    ? items.filter((item) => paymentGroupFor(item) === selectedGroup)
    : items, [selectedGroup, items]);
  const sections = useMemo(
    () => measureRuntimeOperation(
      'bills-agenda-window',
      () => groupPaymentAgendaWindow(visibleItems, includePaid, renderLimit),
    ),
    [visibleItems, includePaid, renderLimit],
  );
  const totalCount = useMemo(
    () => sections.reduce((sum, section) => sum + section.totalCount, 0),
    [sections],
  );
  // Preserve the approved urgency/date order and take only the first page
  // across sections. Past-due and next-seven-days rows therefore always win
  // over a long tail of later estimated renewals.
  const limitedSections = useMemo(() => {
    let remaining = renderLimit;
    return sections.map((section) => {
      if (remaining <= 0) return { ...section, items: [] };
      const items = section.items.slice(0, remaining);
      remaining -= items.length;
      return { ...section, items };
    }).filter((section) => section.items.length > 0);
  }, [sections, renderLimit]);
  const emptyFor = (key: PaymentGroup): string => key === 'subscriptions'
    ? w.emptySubscriptions
    : key === 'utilities'
      ? w.emptyUtilities
      : key === 'cards'
        ? w.emptyCards
        : key === 'loans'
          ? w.emptyLoans
          : w.emptyOther;
  const visibleCount = useMemo(
    () => limitedSections.reduce((sum, section) => sum + section.items.length, 0),
    [limitedSections],
  );
  const hiddenCount = Math.max(0, totalCount - visibleCount);
  return <View style={styles.root} testID="payment-agenda">
    {visibleCount === 0 && <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
        <Icon name={selectedGroup ? groupIcons[selectedGroup] : 'receipt'} size={20} color={theme.textSecondary} />
      </View>
      <ThemedText type="meta" themeColor="textSecondary" style={styles.empty}>
        {selectedGroup ? emptyFor(selectedGroup) : w.empty}
      </ThemedText>
      {!selectedGroup && <ThemedText type="meta" themeColor="textTertiary" style={styles.empty}>
        {w.emptyBody}
      </ThemedText>}
    </View>}
    {limitedSections.map((section) => <View key={section.key} style={styles.section} testID={`bills-${section.key}`}>
      <View style={styles.sectionHeading}>
        <ThemedText type="smallBold" themeColor={section.key === 'overdue' ? 'expense' : 'textSecondary'}>
          {w[section.key]}
        </ThemedText>
        <ThemedText type="micro" tabular themeColor="textTertiary">{section.items.length}</ThemedText>
      </View>
      {section.items.map((item) => {
        const date = item.paid ? `${item.kind === 'card' ? w.paidStatement : w.recorded} ${shortDate(item.dateISO)}`
          : item.daysLeft === 0 ? w.today : item.daysLeft === 1 ? w.tomorrow : shortDate(item.dateISO);
        const isOverdue = !item.paid && item.daysLeft < 0;
        const isToday = !item.paid && item.daysLeft === 0;
        const dateChipBg = isOverdue ? theme.expenseSoftBg : isToday ? theme.goldSoft : 'transparent';
        const dateChipBorder = isOverdue ? theme.expenseSoftBorder : isToday ? theme.goldSoft : 'transparent';
        const dateChipColor = isOverdue ? theme.expense : isToday ? theme.warning : theme.textSecondary;
        const cardAccount = item.kind === 'card' && item.accountId ? accountById.get(item.accountId) : undefined;
        return <Pressable key={item.id} accessibilityRole="button"
          accessibilityLabel={`${item.title}. ${date}. ${w[section.key]}. ${item.estimated ? w.estimate : ''} ${moneyLabel(item.amountFils)}`}
          onPress={() => onOpen(item)} style={({ pressed }) => [styles.row,
            { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          {cardAccount
            ? <BankAvatar account={cardAccount} size={36} />
            : <MerchantAvatar title={item.title} category={item.category} size={36} />}
          <View style={styles.content}>
            <View style={[styles.top, large && styles.stack]}>
              <ThemedText type="smallBold" style={styles.grow}>{item.title}</ThemedText>
              <Money fils={item.amountFils} type="smallBold" color={isOverdue ? theme.expense : theme.text} />
            </View>
            <View style={styles.metaRow}>
              <View style={[styles.dateChip, {
                backgroundColor: dateChipBg, borderColor: dateChipBorder,
                paddingHorizontal: isOverdue || isToday ? 8 : 0,
                paddingVertical: isOverdue || isToday ? 2 : 0,
              }]}>
                <ThemedText type="meta" style={{ color: dateChipColor }} tabular>{date}</ThemedText>
              </View>
              {item.estimated && <ThemedText type="meta" style={{ color: theme.gold }}>{w.estimate}</ThemedText>}
              {item.paid && <Icon name="check" size={15} color={theme.income} />}
            </View>
            {item.accountName && <ThemedText type="meta" themeColor="textTertiary">{item.accountName}</ThemedText>}
          </View>
        </Pressable>;
      })}
    </View>)}
    {hiddenCount > 0 && <Pressable
      accessibilityRole="button"
      accessibilityLabel={w.showMore(hiddenCount)}
      onPress={() => setRenderLimit((current) => current + PAYMENT_AGENDA_PAGE_SIZE)}
      style={({ pressed }) => [styles.showMore, {
        borderColor: theme.cardBorder,
        backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
      }]}>
      <ThemedText type="smallBold">{w.showMore(hiddenCount)}</ThemedText>
      <Icon name="chevron-down" size={16} color={theme.textSecondary} />
    </Pressable>}
    {visibleCount > 0 && <ThemedText type="meta" themeColor="textTertiary" style={styles.notice}>{w.noteBody}</ThemedText>}
  </View>;
});
const styles = StyleSheet.create({
  root: { gap: 18 }, section: { gap: 4 },
  sectionHeading: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { flex: 1, minWidth: 0, gap: 4 }, top: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0, gap: 3 }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  dateChip: { borderRadius: 999, borderWidth: 1 },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
  emptyState: { minHeight: 112, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  emptyIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', maxWidth: 280 },
  showMore: { minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  notice: { paddingVertical: 8, lineHeight: 20 },
});

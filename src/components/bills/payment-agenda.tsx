import { paymentAgendaCopy as copy } from '@/lib/reference-copy';
import React from 'react';
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
import {
  groupPaymentAgenda,
  paymentGroupFor,
  type PaymentAgendaItem,
  type PaymentGroup,
} from '@/lib/reference-presentation';
import type { Account } from '@/lib/types';

const groupIcons: Record<PaymentGroup, IconName> = {
  subscriptions: 'repeat', utilities: 'bolt', cards: 'wallet', loans: 'bank', other: 'receipt',
};

/** Bills filters choose the payment family; due timing remains the visual hierarchy inside the list. */
export function PaymentAgenda({ items, accounts = [], includePaid, group: selectedGroup, onOpen }: {
  items: readonly PaymentAgendaItem[];
  accounts?: readonly Account[];
  includePaid: boolean;
  group?: PaymentGroup;
  onOpen: (item: PaymentAgendaItem) => void;
}) {
  const theme = useTheme(); const lang = useLanguage(); const large = useLargeTextLayout();
  const moneySpec = useLedgerMoney();
  const accountById = new Map(accounts.map((account) => [account.id, account] as const));
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(Math.round(fils), moneySpec)}` : formatAED(fils);
  const w = copy[lang === 'ar' ? 'ar' : 'en'];
  const visibleItems = selectedGroup
    ? items.filter((item) => paymentGroupFor(item) === selectedGroup)
    : items;
  const sections = groupPaymentAgenda(visibleItems, includePaid);
  const emptyFor = (key: PaymentGroup): string => key === 'subscriptions'
    ? w.emptySubscriptions
    : key === 'utilities'
      ? w.emptyUtilities
      : key === 'cards'
        ? w.emptyCards
        : key === 'loans'
          ? w.emptyLoans
          : w.emptyOther;
  const visibleCount = sections.reduce((sum, section) => sum + section.items.length, 0);
  return <View style={styles.root} testID="payment-agenda">
    {visibleCount === 0 && selectedGroup && <View style={styles.emptyState}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
        <Icon name={groupIcons[selectedGroup]} size={20} color={theme.textSecondary} />
      </View>
      <ThemedText type="meta" themeColor="textSecondary" style={styles.empty}>
        {emptyFor(selectedGroup)}
      </ThemedText>
    </View>}
    {sections.map((section) => <View key={section.key} style={styles.section} testID={`bills-${section.key}`}>
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
    {visibleCount > 0 && <ThemedText type="meta" themeColor="textTertiary" style={styles.notice}>{w.noteBody}</ThemedText>}
  </View>;
}
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
  notice: { paddingVertical: 8, lineHeight: 20 },
});

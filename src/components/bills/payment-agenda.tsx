import { paymentAgendaCopy as copy } from '@/lib/reference-copy';
import React, { useMemo } from 'react';
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
  groupPaymentKinds,
  paymentGroupFor,
  type PaymentAgendaItem,
  type PaymentGroup,
} from '@/lib/reference-presentation';
import type { Account } from '@/lib/types';

const groupIcons: Record<PaymentGroup, IconName> = {
  subscriptions: 'repeat', utilities: 'bolt', cards: 'wallet', loans: 'bank', other: 'receipt',
};

/** Payment type is the main hierarchy; dates and verified status stay beside each charge. */
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
  // Five filters and sorts over the agenda. Bills re-renders on every
  // keystroke in its "add reminder" sheet; this must not run with them.
  const groups = useMemo(() => selectedGroup
    ? [{
        key: selectedGroup,
        sections: groupPaymentAgenda(items.filter((item) => paymentGroupFor(item) === selectedGroup), includePaid),
      }]
    : groupPaymentKinds(items, includePaid), [selectedGroup, items, includePaid]);
  const emptyFor = (key: PaymentGroup): string => key === 'subscriptions'
    ? w.emptySubscriptions
    : key === 'utilities'
      ? w.emptyUtilities
      : key === 'cards'
        ? w.emptyCards
        : key === 'loans'
          ? w.emptyLoans
          : w.emptyOther;
  const visibleCount = useMemo(() => groups.reduce((sum, itemGroup) =>
    sum + itemGroup.sections.reduce((sectionSum, section) => sectionSum + section.items.length, 0), 0), [groups]);
  return <View style={styles.root} testID="payment-agenda">
    {groups.map((group) => {
      const count = group.sections.reduce((sum, section) => sum + section.items.length, 0);
      return <View key={group.key} style={styles.section} testID={`bills-${group.key}`}>
        {!selectedGroup && <View style={styles.sectionHeading}>
          <View style={styles.sectionIcon}>
            <Icon name={groupIcons[group.key]} size={20} color={theme.textSecondary} /></View>
          <View style={styles.grow}>
            <ThemedText type="heading">{w[group.key]}</ThemedText>
            {(group.key === 'subscriptions' || group.key === 'utilities') &&
              <ThemedText type="meta" themeColor="textSecondary">
                {group.key === 'subscriptions' ? w.subscriptionsHint : w.utilitiesHint}</ThemedText>}
          </View>
          <ThemedText type="meta" tabular themeColor="textTertiary">{count}</ThemedText>
        </View>}
        {count === 0 && <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: theme.backgroundSelected }]}>
            <Icon name={groupIcons[group.key]} size={20} color={theme.textSecondary} />
          </View>
          <ThemedText type="meta" themeColor="textSecondary" style={styles.empty}>
            {emptyFor(group.key)}
          </ThemedText>
        </View>}
        {group.sections.map((section) => <View key={section.key}>
          <ThemedText type="meta" themeColor={section.key === 'overdue' ? 'expense' : 'textSecondary'} style={styles.statusHeading}>
            {w[section.key]}</ThemedText>
          {section.items.map((item) => {
            const date = item.paid ? `${item.kind === 'card' ? w.paidStatement : w.recorded} ${shortDate(item.dateISO)}`
              : item.daysLeft === 0 ? w.today : item.daysLeft === 1 ? w.tomorrow : shortDate(item.dateISO);
            const cardAccount = item.kind === 'card' && item.accountId ? accountById.get(item.accountId) : undefined;
            return <Pressable key={item.id} accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${date}. ${w[section.key]}. ${item.estimated ? w.estimate : ''} ${moneyLabel(item.amountFils)}`}
              onPress={() => onOpen(item)} style={({ pressed }) => [styles.row,
                { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
              {cardAccount
                ? <BankAvatar account={cardAccount} size={40} />
                : <MerchantAvatar title={item.title} category={item.category} size={40} />}
              <View style={styles.content}>
                <View style={[styles.top, large && styles.stack]}>
                  <ThemedText type="smallBold" style={styles.grow}>{item.title}</ThemedText>
                  <Money fils={item.amountFils} type="smallBold" color={section.key === 'overdue' ? theme.expense : theme.text} />
                </View>
                <View style={styles.metaRow}>
                  <ThemedText type="meta" themeColor="textSecondary">{date}</ThemedText>
                  {item.estimated && <ThemedText type="meta" style={{ color: theme.gold }}>{w.estimate}</ThemedText>}
                  {item.paid && <Icon name="check" size={15} color={theme.income} />}
                </View>
                {item.accountName && <ThemedText type="meta" themeColor="textTertiary">{item.accountName}</ThemedText>}
              </View>
            </Pressable>;
          })}
        </View>)}
      </View>;
    })}
    {visibleCount > 0 && <ThemedText type="meta" themeColor="textTertiary" style={styles.notice}>{w.noteBody}</ThemedText>}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 24 }, section: { gap: 8 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionIcon: { width: 32, height: 42, alignItems: 'center', justifyContent: 'center' },
  statusHeading: { paddingTop: 8, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { flex: 1, minWidth: 0, gap: 5 }, top: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0, gap: 3 }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
  emptyState: { minHeight: 112, alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  emptyIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', maxWidth: 280 },
  notice: { paddingVertical: 8, lineHeight: 20 },
});

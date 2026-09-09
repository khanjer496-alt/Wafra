import { paymentAgendaCopy as copy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { formatAED, shortDate } from '@/lib/format';
import { formatMinorUnits } from '@/lib/ledger-money';
import { groupPaymentKinds, type PaymentAgendaItem, type PaymentGroup } from '@/lib/reference-presentation';

const groupIcons: Record<PaymentGroup, IconName> = {
  subscriptions: 'repeat', utilities: 'bolt', cards: 'wallet', loans: 'bank', other: 'receipt',
};

/** Payment type is the main hierarchy; dates and verified status stay beside each charge. */
export function PaymentAgenda({ items, includePaid, onOpen }: {
  items: readonly PaymentAgendaItem[]; includePaid: boolean; onOpen: (item: PaymentAgendaItem) => void;
}) {
  const theme = useTheme(); const lang = useLanguage(); const large = useLargeTextLayout();
  const moneySpec = useLedgerMoney();
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(Math.round(fils), moneySpec)}` : formatAED(fils);
  const w = copy[lang === 'ar' ? 'ar' : 'en'];
  const groups = groupPaymentKinds(items, includePaid);
  return <View style={styles.root} testID="payment-agenda">
    {groups.map((group) => {
      const count = group.sections.reduce((sum, section) => sum + section.items.length, 0);
      return <View key={group.key} style={styles.section} testID={`bills-${group.key}`}>
        <View style={styles.sectionHeading}>
          <View style={styles.sectionIcon}>
            <Icon name={groupIcons[group.key]} size={20} color={theme.textSecondary} /></View>
          <View style={styles.grow}>
            <ThemedText type="heading">{w[group.key]}</ThemedText>
            {(group.key === 'subscriptions' || group.key === 'utilities') &&
              <ThemedText type="meta" themeColor="textSecondary">
                {group.key === 'subscriptions' ? w.subscriptionsHint : w.utilitiesHint}</ThemedText>}
          </View>
          <ThemedText type="meta" tabular themeColor="textTertiary">{count}</ThemedText>
        </View>
        {count === 0 && <ThemedText type="meta" themeColor="textSecondary" style={styles.empty}>
          {group.key === 'subscriptions' ? w.emptySubscriptions : w.emptyUtilities}</ThemedText>}
        {group.sections.map((section) => <View key={section.key}>
          <ThemedText type="meta" themeColor={section.key === 'overdue' ? 'expense' : 'textSecondary'} style={styles.statusHeading}>
            {w[section.key]}</ThemedText>
          {section.items.map((item) => {
            const date = item.paid ? `${item.kind === 'card' ? w.paidStatement : w.recorded} ${shortDate(item.dateISO)}`
              : item.daysLeft === 0 ? w.today : item.daysLeft === 1 ? w.tomorrow : shortDate(item.dateISO);
            return <Pressable key={item.id} accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${date}. ${w[section.key]}. ${item.estimated ? w.estimate : ''} ${moneyLabel(item.amountFils)}`}
              onPress={() => onOpen(item)} style={({ pressed }) => [styles.row,
                { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
              <MerchantAvatar title={item.title} category={item.category} size={40} />
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
    <ThemedText type="meta" themeColor="textTertiary" style={styles.notice}>{w.noteBody}</ThemedText>
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
  stack: { flexDirection: 'column', alignItems: 'flex-start' }, empty: { paddingVertical: 12 },
  notice: { paddingVertical: 8, lineHeight: 20 },
});

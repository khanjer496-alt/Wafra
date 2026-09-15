import { paymentAgendaCopy as copy } from '@/lib/reference-copy';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { BankAvatar } from '@/components/ui/bank-avatar';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { formatAED, shortDate } from '@/lib/format';
import { formatMinorUnits } from '@/lib/ledger-money';
import { groupPaymentAgenda, type PaymentAgendaItem } from '@/lib/reference-presentation';
import type { Account } from '@/lib/types';

/** Due timing is the main hierarchy; payment type stays secondary to "what is next?". */
export function PaymentAgenda({ items, accounts = [], includePaid, onOpen }: {
  items: readonly PaymentAgendaItem[]; accounts?: readonly Account[]; includePaid: boolean; onOpen: (item: PaymentAgendaItem) => void;
}) {
  const theme = useTheme(); const lang = useLanguage(); const large = useLargeTextLayout();
  const moneySpec = useLedgerMoney();
  const accountById = new Map(accounts.map((account) => [account.id, account] as const));
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(Math.round(fils), moneySpec)}` : formatAED(fils);
  const w = copy[lang === 'ar' ? 'ar' : 'en'];
  const sections = groupPaymentAgenda(items, includePaid);
  // Aggregate the whole agenda into a single hero: total sum, count of unpaid
  // items, and the two counts that change how the sum should be read — items
  // due today (act now) and items whose amount is only an estimate.
  const summary = useMemo(() => {
    let sum = 0; let upcoming = 0; let dueToday = 0; let overdue = 0; let estimated = 0;
    for (const item of items) {
      if (item.paid) continue;
      sum += item.amountFils; upcoming += 1;
      if (item.daysLeft < 0) overdue += 1;
      else if (item.daysLeft === 0) dueToday += 1;
      if (item.estimated) estimated += 1;
    }
    return { sum, upcoming, dueToday, overdue, estimated };
  }, [items]);
  // Format N with the localized {n} placeholder without a full templating pass.
  const withN = (s: string, n: number) => s.replace('{n}', String(n));

  return <View style={styles.root} testID="payment-agenda">
    <View style={[styles.hero, { borderColor: theme.cardBorder }]} testID="payment-agenda-summary">
      <ThemedText type="micro" themeColor="textSecondary">{w.summaryTitle}</ThemedText>
      {summary.upcoming > 0
        ? <Money fils={summary.sum} type="amount" />
        : <ThemedText type="heading" themeColor="textSecondary">{w.summaryEmpty}</ThemedText>}
      {summary.upcoming > 0 && <ThemedText type="meta" themeColor="textSecondary" tabular>
        {summary.upcoming} {w.summaryPayments}{summary.estimated > 0
          ? ` · ${summary.estimated === 1 ? w.summaryEstimatedOne : withN(w.summaryEstimatedMany, summary.estimated)}` : ''}
      </ThemedText>}
      {summary.upcoming > 0 && (summary.dueToday > 0 || summary.overdue > 0) && <View style={styles.heroChips}>
        {summary.overdue > 0 && <View style={[styles.heroChip, { backgroundColor: theme.expenseSoftBg, borderColor: theme.expenseSoftBorder }]}>
          <ThemedText type="meta" themeColor="expense" tabular>
            {summary.overdue === 1 ? w.summaryOverdueOne : withN(w.summaryOverdueMany, summary.overdue)}
          </ThemedText>
        </View>}
        {summary.dueToday > 0 && <View style={[styles.heroChip, { backgroundColor: theme.goldSoft, borderColor: theme.goldSoft }]}>
          <ThemedText type="meta" tabular style={{ color: theme.warning }}>
            {summary.dueToday === 1 ? w.summaryDueTodayOne : withN(w.summaryDueTodayMany, summary.dueToday)}
          </ThemedText>
        </View>}
      </View>}
    </View>

    {sections.map((section) => <View key={section.key} style={styles.section} testID={`bills-${section.key}`}>
      <View style={styles.sectionHeading}>
        <ThemedText type="smallBold" themeColor={section.key === 'overdue' ? 'expense' : 'textSecondary'}>
          {w[section.key]}
        </ThemedText>
        <ThemedText type="micro" tabular themeColor="textTertiary">{section.items.length}</ThemedText>
      </View>
      {section.items.map((item) => {
            const dateText = item.paid ? `${item.kind === 'card' ? w.paidStatement : w.recorded} ${shortDate(item.dateISO)}`
              : item.daysLeft === 0 ? w.today : item.daysLeft === 1 ? w.tomorrow : shortDate(item.dateISO);
            // Highlight rows the user has to act on right now: overdue in the
            // clay danger tone, due-today in the warning gold. Elsewhere the row
            // stays neutral, so a screenful of dates does not read as urgent.
            const isOverdue = !item.paid && item.daysLeft < 0;
            const isToday = !item.paid && item.daysLeft === 0;
            const dateChipBg = isOverdue ? theme.expenseSoftBg : isToday ? theme.goldSoft : 'transparent';
            const dateChipBorder = isOverdue ? theme.expenseSoftBorder : isToday ? theme.goldSoft : 'transparent';
            const dateChipColor = isOverdue ? theme.expense : isToday ? theme.warning : theme.textSecondary;
            const cardAccount = item.kind === 'card' && item.accountId ? accountById.get(item.accountId) : undefined;
            return <Pressable key={item.id} accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${dateText}. ${w[section.key]}. ${item.estimated ? w.estimate : ''} ${moneyLabel(item.amountFils)}`}
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
                  <View style={[styles.dateChip, { backgroundColor: dateChipBg, borderColor: dateChipBorder,
                    paddingHorizontal: isOverdue || isToday ? 8 : 0, paddingVertical: isOverdue || isToday ? 2 : 0 }]}>
                    <ThemedText type="meta" style={{ color: dateChipColor }} tabular>{dateText}</ThemedText>
                  </View>
                  {item.estimated && <ThemedText type="meta" style={{ color: theme.gold }} tabular>· {w.estimate}</ThemedText>}
                  {item.paid && <Icon name="check" size={15} color={theme.income} />}
                </View>
                {item.accountName && <ThemedText type="meta" themeColor="textTertiary">{item.accountName}</ThemedText>}
              </View>
            </Pressable>;
      })}
    </View>)}
    <ThemedText type="meta" themeColor="textTertiary" style={styles.notice}>{w.noteBody}</ThemedText>
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 18 }, section: { gap: 4 },
  hero: { paddingVertical: 14, paddingHorizontal: 16, gap: 7, borderWidth: 1, borderRadius: 14 },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heroChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  sectionHeading: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { flex: 1, minWidth: 0, gap: 4 }, top: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0, gap: 3 }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  dateChip: { borderRadius: 999, borderWidth: 1 },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
  notice: { paddingTop: 2, paddingBottom: 8, lineHeight: 20 },
});

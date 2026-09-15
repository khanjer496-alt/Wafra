import { paymentAgendaCopy as copy } from '@/lib/reference-copy';
import React, { useMemo } from 'react';
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
      <View style={styles.heroTop}>
        <View style={styles.grow}>
          <ThemedText type="micro" themeColor="textSecondary">{w.summaryTitle}</ThemedText>
          {summary.upcoming > 0
            ? <Money fils={summary.sum} type="amount" />
            : <ThemedText type="heading" themeColor="textSecondary">{w.summaryEmpty}</ThemedText>}
        </View>
        {summary.upcoming > 0 && <View style={styles.heroCount}>
          <ThemedText type="title" tabular>{summary.upcoming}</ThemedText>
          <ThemedText type="micro" themeColor="textSecondary">{w.summaryPayments}</ThemedText>
        </View>}
      </View>
      {summary.upcoming > 0 && (summary.dueToday > 0 || summary.overdue > 0 || summary.estimated > 0) && <View style={styles.heroChips}>
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
        {summary.estimated > 0 && <View style={[styles.heroChip, { backgroundColor: theme.backgroundSelected, borderColor: theme.cardBorder }]}>
          <ThemedText type="meta" themeColor="textSecondary" tabular>
            {summary.estimated === 1 ? w.summaryEstimatedOne : withN(w.summaryEstimatedMany, summary.estimated)}
          </ThemedText>
        </View>}
      </View>}
    </View>

    {groups.map((group) => {
      const count = group.sections.reduce((sum, section) => sum + section.items.length, 0);
      // Only count what is still due, so a group with 3 upcoming and 6 recently
      // paid subtotals as "AED 437 · 3" not "AED 437 · 9". Recently-paid stays
      // visible below in its own status row.
      const subtotalFils = group.sections.reduce((sum, section) =>
        sum + section.items.reduce((s, item) => s + (item.paid ? 0 : item.amountFils), 0), 0);
      const upcomingCount = group.sections.reduce((sum, section) =>
        sum + section.items.filter((item) => !item.paid).length, 0);
      return <View key={group.key} style={styles.section} testID={`bills-${group.key}`}>
        <View style={[styles.sectionHeading, large && styles.stack]}>
          <View style={styles.sectionIcon}>
            <Icon name={groupIcons[group.key]} size={20} color={theme.textSecondary} /></View>
          <View style={styles.grow}>
            <ThemedText type="heading">{w[group.key]}</ThemedText>
            {(group.key === 'subscriptions' || group.key === 'utilities') &&
              <ThemedText type="meta" themeColor="textSecondary">
                {group.key === 'subscriptions' ? w.subscriptionsHint : w.utilitiesHint}</ThemedText>}
          </View>
          {upcomingCount > 0 ? <View style={styles.sectionTotal}>
            <Money fils={subtotalFils} type="smallBold" />
            <ThemedText type="micro" themeColor="textSecondary">
              {upcomingCount === count ? String(count) : `${upcomingCount} · ${count}`}
            </ThemedText>
          </View> : <ThemedText type="meta" tabular themeColor="textTertiary">{count}</ThemedText>}
        </View>
        {count === 0 && <ThemedText type="meta" themeColor="textSecondary" style={styles.empty}>
          {group.key === 'subscriptions' ? w.emptySubscriptions : w.emptyUtilities}</ThemedText>}
        {group.sections.map((section) => <View key={section.key}>
          <ThemedText type="meta" themeColor={section.key === 'overdue' ? 'expense' : 'textSecondary'} style={styles.statusHeading}>
            {w[section.key]}</ThemedText>
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
            return <Pressable key={item.id} accessibilityRole="button"
              accessibilityLabel={`${item.title}. ${dateText}. ${w[section.key]}. ${item.estimated ? w.estimate : ''} ${moneyLabel(item.amountFils)}`}
              onPress={() => onOpen(item)} style={({ pressed }) => [styles.row,
                { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
              <MerchantAvatar title={item.title} category={item.category} size={40} />
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
                  {item.estimated && <View style={[styles.estimatedChip, { borderColor: theme.goldSoft }]}>
                    <ThemedText type="meta" style={{ color: theme.gold }} tabular>{w.estimate}</ThemedText>
                  </View>}
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
  hero: { paddingVertical: 14, paddingHorizontal: 16, gap: 12, borderWidth: 1, borderRadius: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  heroCount: { alignItems: 'flex-end', gap: 2 },
  heroChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  heroChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sectionIcon: { width: 32, height: 42, alignItems: 'center', justifyContent: 'center' },
  sectionTotal: { alignItems: 'flex-end', gap: 2 },
  statusHeading: { paddingTop: 8, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 72, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  content: { flex: 1, minWidth: 0, gap: 5 }, top: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0, gap: 3 }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  dateChip: { borderRadius: 999, borderWidth: 1 },
  estimatedChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  stack: { flexDirection: 'column', alignItems: 'flex-start' }, empty: { paddingVertical: 12 },
  notice: { paddingVertical: 8, lineHeight: 20 },
});

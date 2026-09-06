import { paymentAgendaCopy as copy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { formatAED, shortDate } from '@/lib/format';
import { groupPaymentAgenda, type PaymentAgendaItem } from '@/lib/reference-presentation';


export function PaymentAgenda({ items, includePaid, onOpen }: {
  items: readonly PaymentAgendaItem[]; includePaid: boolean; onOpen: (item: PaymentAgendaItem) => void;
}) {
  const theme = useTheme(); const lang = useLanguage(); const large = useLargeTextLayout();
  const w = copy[lang === 'ar' ? 'ar' : 'en'];
  const groups = groupPaymentAgenda(items, includePaid);
  return <View style={styles.root} testID="payment-agenda">
    {groups.map((group) => <View key={group.key} style={styles.section}>
      <ThemedText type="heading" themeColor={group.key === 'overdue' ? 'expense' : 'text'}>{w[group.key]}</ThemedText>
      <View style={[styles.group, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
        {group.items.map((item, index) => {
          const date = item.paid ? `${item.kind === 'card' ? w.paidStatement : w.recorded} ${shortDate(item.dateISO)}`
            : item.daysLeft === 0 ? w.today : item.daysLeft === 1 ? w.tomorrow : shortDate(item.dateISO);
          return <Pressable key={item.id} accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${date}. ${item.estimated ? w.estimate : ''} ${formatAED(item.amountFils)}`}
            onPress={() => onOpen(item)} style={({ pressed }) => [styles.row, index > 0 && styles.rule,
              { borderColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
            <MerchantAvatar title={item.title} category={item.category} size={38} />
            <View style={styles.content}>
              <View style={[styles.top, large && styles.stack]}>
                <ThemedText type="smallBold" style={styles.grow}>{item.title}</ThemedText>
                <Money fils={item.amountFils} type="smallBold" color={group.key === 'overdue' ? theme.expense : theme.text} />
              </View>
              <View style={styles.metaRow}>
                <ThemedText type="meta" themeColor="textSecondary">{date}</ThemedText>
                {item.estimated && <View style={[styles.badge, { backgroundColor: theme.goldSoft }]}>
                  <ThemedText type="meta" style={{ color: theme.gold, fontSize: 12, lineHeight: 18 }}>{w.estimate}</ThemedText>
                </View>}
                {item.paid && <Icon name="check" size={15} color={theme.income} />}
              </View>
              {item.accountName && <ThemedText type="meta" themeColor="textTertiary">{item.accountName}</ThemedText>}
            </View>
          </Pressable>;
        })}
      </View>
    </View>)}
    {groups.length === 0 && <View style={[styles.empty, { borderColor: theme.cardBorder, backgroundColor: theme.card }]}>
      <Icon name="calendar" size={32} color={theme.primary} />
      <ThemedText type="heading">{w.empty}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">{w.emptyBody}</ThemedText>
    </View>}
    <View style={[styles.notice, { backgroundColor: theme.primarySoft }]}>
      <View style={[styles.noticeIcon, { backgroundColor: theme.card }]}><Icon name="calendar" size={22} color={theme.primary} /></View>
      <View style={styles.grow}><ThemedText type="smallBold">{w.note}</ThemedText>
        <ThemedText type="meta" themeColor="textSecondary">{w.noteBody}</ThemedText></View>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 24 }, section: { gap: 12 }, group: { paddingHorizontal: 14, borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 80, paddingVertical: 16 }, rule: { borderTopWidth: StyleSheet.hairlineWidth },
  content: { flex: 1, minWidth: 0, gap: 5 }, top: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grow: { flex: 1, minWidth: 0, gap: 4 }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  badge: { paddingHorizontal: 6, borderRadius: 6 }, stack: { flexDirection: 'column', alignItems: 'flex-start' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, padding: 16 },
  noticeIcon: { width: 42, height: 42, borderRadius: 21, justifyContent: 'center', alignItems: 'center' },
  empty: { padding: 24, borderRadius: 18, borderWidth: 1, gap: 12 },
});

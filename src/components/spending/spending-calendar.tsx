import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { useLanguage } from '@/hooks/use-language';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import type { DailySpend } from '@/lib/analytics';
import { formatAED } from '@/lib/format';
import { formatMinorUnits } from '@/lib/ledger-money';

const copy = {
  en: { weekdays: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], darker: 'Darker means more spent. Rent and fixed costs are left out.',
    noSpend: (n: number) => `${n} no-spend ${n === 1 ? 'day' : 'days'}`, showing: 'Showing', all: 'Show all days', nothing: 'nothing spent' },
  ar: { weekdays: ['ن', 'ث', 'ر', 'خ', 'ج', 'س', 'ح'], darker: 'اللون الأغمق يعني إنفاقاً أكبر. الإيجار والتكاليف الثابتة غير محسوبة.',
    noSpend: (n: number) => `${n} أيام بلا إنفاق`, showing: 'عرض', all: 'عرض كل الأيام', nothing: 'لا إنفاق' },
} as const;

type Props = {
  days: readonly DailySpend[];
  /** Local YYYY-MM-DD; days after it are not yet lived and stay unshaded. */
  todayISO: string;
  selected: string | null;
  onSelect: (dateISO: string | null) => void;
};

/** One money month as a grid; tapping a day filters the activity list below. */
export function SpendingCalendar({ days, todayISO, selected, onSelect }: Props) {
  const theme = useTheme();
  const lang = useLanguage();
  const w = copy[lang === 'ar' ? 'ar' : 'en'];
  const moneySpec = useLedgerMoney();
  const moneyLabel = (fils: number) => moneySpec ? `${moneySpec.currency} ${formatMinorUnits(Math.round(fils), moneySpec)}` : formatAED(fils);
  if (days.length === 0) return null;

  const lived = days.filter((day) => day.dateISO <= todayISO);
  const max = Math.max(1, ...lived.map((day) => day.fils));
  const noSpend = lived.filter((day) => day.fils === 0).length;
  // Monday-first columns. getUTCDay: 0 = Sunday.
  const first = new Date(`${days[0]!.dateISO}T12:00:00Z`).getUTCDay();
  const lead = (first + 6) % 7;
  const cells: (DailySpend | null)[] = [...Array.from({ length: lead }, () => null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const label = (iso: string) => new Date(`${iso}T12:00:00Z`)
    .toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  return <View style={styles.root} testID="spending-calendar">
    <View style={styles.row}>{w.weekdays.map((d, i) =>
      <ThemedText key={i} type="micro" themeColor="textSecondary" style={styles.head}>{d}</ThemedText>)}</View>
    {Array.from({ length: cells.length / 7 }, (_, r) => <View key={r} style={styles.row}>
      {cells.slice(r * 7, r * 7 + 7).map((day, c) => {
        if (!day) return <View key={c} style={styles.cell} />;
        const future = day.dateISO > todayISO;
        const t = future ? 0 : day.fils / max;
        const isSelected = selected === day.dateISO;
        const strong = t > 0.55;
        const background = future || day.fils === 0 ? 'transparent'
          : `${theme.primary}${Math.round((0.14 + 0.76 * t) * 255).toString(16).padStart(2, '0')}`;
        return <Pressable key={day.dateISO} disabled={future}
          accessibilityRole="button" accessibilityState={{ selected: isSelected, disabled: future }}
          accessibilityLabel={`${label(day.dateISO)}, ${day.fils > 0 ? moneyLabel(day.fils) : w.nothing}`}
          onPress={() => onSelect(isSelected ? null : day.dateISO)}
          style={[styles.cell, styles.day, {
            backgroundColor: background,
            borderColor: isSelected ? theme.text : day.dateISO === todayISO ? theme.primary : theme.cardBorder,
            borderWidth: isSelected ? 2 : 1,
            opacity: future ? 0.4 : 1,
          }]}>
          <ThemedText type="meta" style={{ color: strong ? theme.onPrimary : theme.text }}>{Number(day.dateISO.slice(8))}</ThemedText>
        </Pressable>;
      })}
    </View>)}
    <View style={styles.legend}>
      <ThemedText type="meta" themeColor="textSecondary" style={styles.grow}>{w.darker}</ThemedText>
      <ThemedText type="meta" themeColor="textSecondary">{w.noSpend(noSpend)}</ThemedText>
    </View>
    {selected && <Pressable accessibilityRole="button" onPress={() => onSelect(null)} style={styles.clear}>
      <ThemedText type="meta" themeColor="primary">{`${w.showing} ${label(selected)} · ${w.all}`}</ThemedText>
    </Pressable>}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 5 },
  row: { flexDirection: 'row', gap: 5 },
  head: { flex: 1, textAlign: 'center' },
  cell: { flex: 1, aspectRatio: 1, minHeight: 40 },
  day: { borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  grow: { flex: 1, minWidth: 160 },
  clear: { minHeight: 44, justifyContent: 'center' },
});

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import type { DailySpend } from '@/lib/analytics';
import { everydayBandCopy } from '@/lib/everyday-band-copy';
import { formatAED } from '@/lib/format';
import { formatMinorUnits } from '@/lib/ledger-money';
import { tapped } from '@/lib/haptics';
import { calendarTileColors, minTileAlpha } from '@/lib/spending-calendar-tiles';

import { spendingTrendsCopy } from '@/lib/reference-copy';

type Props = {
  days: readonly DailySpend[];
  /** Local YYYY-MM-DD; days after it are not yet lived and stay unshaded. */
  todayISO: string;
  selected: string | null;
  onSelect: (dateISO: string | null) => void;
  /** The Spending band the grid is drawn on. */
  palette: BandPalette;
  /** The period the grid shows, for its spoken name. */
  periodLabel: string;
};

/** A day's short spoken date ("10 Sept"). */
export function calendarDayLabel(iso: string, language: string): string {
  return new Date(`${iso}T12:00:00Z`)
    .toLocaleDateString(language === 'ar' ? 'ar-AE' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/**
 * Daily spending as calendar-month grids on Spending's band. A tile's strength is
 * the day's everyday spending against the busiest lived day (one tone, the
 * band's own text colour); a lived day with nothing spent is a dashed outline;
 * days still to come are faint and not selectable; the selected day wears a
 * ring. Tapping a day shows its rows on the sheet below; tapping it again
 * shows the recent rows. Rent-only days are not counted as no-spend days.
 */
export function SpendingCalendar({ days, todayISO, selected, onSelect, palette, periodLabel }: Props) {
  const lang = useLanguage();
  const w = spendingTrendsCopy[lang === 'ar' ? 'ar' : 'en'];
  const words = everydayBandCopy(lang);
  const moneySpec = useLedgerMoney();
  const moneyLabel = (fils: number) => moneySpec ? `${moneySpec.currency} ${formatMinorUnits(Math.round(fils), moneySpec)}` : formatAED(fils);
  const minAlpha = useMemo(() => minTileAlpha(palette), [palette]);
  if (days.length === 0) return null;

  const lived = days.filter((day) => day.dateISO <= todayISO);
  const max = Math.max(1, ...lived.map((day) => day.fils));
  // A rent-only day is not a no-spend day: the list below still shows the payment.
  const noSpend = lived.filter((day) => day.fils === 0 && day.fixedFils === 0).length;
  // A salary month or custom range can cross calendar months. Restart each
  // month's weekday columns so repeated day numbers never lose their date.
  const groups = new Map<string, DailySpend[]>();
  for (const day of days) {
    const key = day.dateISO.slice(0, 7);
    const group = groups.get(key) ?? [];
    group.push(day); groups.set(key, group);
  }
  const chosen = days.find(day => day.dateISO === selected);

  return <View style={styles.root} testID="spending-calendar" accessibilityLabel={words.calendarGrid(periodLabel)}>
    {chosen ? <View style={styles.selection}>
      <ThemedText type="smallBold" style={{ color: palette.onBand }}>{calendarDayLabel(chosen.dateISO, lang)}</ThemedText>
      <ThemedText type="smallBold" tabular testID="spending-calendar-selected-total" style={{ color: palette.onBand }}>
        {moneyLabel(chosen.fils + chosen.fixedFils)}
      </ThemedText>
    </View> : <ThemedText type="meta" style={{ color: palette.onBandSecondary }}>
      {words.calendarSelectDay}
    </ThemedText>}
    {[...groups].map(([key, group]) => {
      const first = new Date(`${group[0]!.dateISO}T12:00:00Z`).getUTCDay();
      const cells: (DailySpend | null)[] = [...Array.from({ length: (first + 6) % 7 }, () => null), ...group];
      while (cells.length % 7 !== 0) cells.push(null);
      const monthName = new Date(`${key}-01T12:00:00Z`).toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB',
        { month: 'long', year: 'numeric', timeZone: 'UTC' });
      return <View key={key} style={styles.month}>
        <ThemedText type="smallBold" accessibilityRole="header" testID={`spending-calendar-month-${key}`}
          style={{ color: palette.onBand }}>{monthName}</ThemedText>
        <View style={styles.row} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {[0, 1, 2, 3, 4, 5, 6].map((column) =>
            <ThemedText key={column} type="micro" style={[styles.head, { color: palette.onBandSecondary }]}>{w.calendarWeekday(column)}</ThemedText>)}
        </View>
        {Array.from({ length: cells.length / 7 }, (_, r) => <View key={r} style={styles.row}>
          {cells.slice(r * 7, r * 7 + 7).map((day, c) => {
            if (!day) return <View key={c} style={styles.cell} />;
            const future = day.dateISO > todayISO;
            const empty = !future && day.fils === 0;
            const isSelected = selected === day.dateISO;
            const tile = calendarTileColors(palette, future ? 0 : day.fils / max, minAlpha);
            const spoken = day.fils + day.fixedFils > 0 ? moneyLabel(day.fils + day.fixedFils) : w.calendarNothing;
            return <Pressable key={day.dateISO} disabled={future} testID={`spending-calendar-day-${day.dateISO}`}
              accessibilityRole="button" accessibilityState={{ selected: isSelected, disabled: future }}
              accessibilityLabel={`${calendarDayLabel(day.dateISO, lang)}, ${spoken}`}
              onPress={() => { tapped(); onSelect(isSelected ? null : day.dateISO); }}
              style={[styles.cell, styles.day, {
                backgroundColor: tile.background ?? 'transparent',
                borderColor: isSelected ? palette.onBand : empty ? palette.onBandSecondary : 'transparent',
                borderWidth: isSelected ? 2 : empty ? 1 : 0,
                borderStyle: empty && !isSelected ? 'dashed' : 'solid',
                opacity: future ? 0.4 : 1,
              }]}>
              <ThemedText type="meta" style={[styles.number, { color: tile.text },
                day.dateISO === todayISO && styles.today]}>{Number(day.dateISO.slice(8))}</ThemedText>
              {day.fils === 0 && day.fixedFils > 0 ? <View style={[styles.fixedDot, { backgroundColor: palette.onBandSecondary }]} /> : null}
            </Pressable>;
          })}
        </View>)}
      </View>;
    })}
    <View style={styles.legend}>
      <ThemedText type="meta" style={[styles.grow, { color: palette.onBandSecondary }]}>{`${words.calendarKey} · ${words.fixedLeftOut}`}</ThemedText>
      <ThemedText type="meta" testID="spending-calendar-no-spend" style={{ color: palette.onBand }}>{w.calendarNoSpend(noSpend)}</ThemedText>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 16 },
  month: { gap: 5 },
  selection: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  row: { flexDirection: 'row', gap: 5 },
  head: { flex: 1, textAlign: 'center' },
  cell: { flex: 1, aspectRatio: 1, minHeight: 44 },
  fixedDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  day: { borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  number: { fontFamily: Fonts.sansSemi },
  today: { textDecorationLine: 'underline' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6, justifyContent: 'space-between' },
  grow: { flexShrink: 1, minWidth: 140 },
});

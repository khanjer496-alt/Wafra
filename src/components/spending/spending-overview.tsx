import { spendingCopy } from '@/lib/reference-copy';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { CategoryAvatar } from '@/components/ui/category-avatar';
import { CategoryDonut, useCategoricalPalette, type DonutSlice } from '@/components/ui/charts';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Button } from '@/components/ui/controls';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { DataViz } from '@/constants/theme';
import { categoryLabel } from '@/lib/categories';
import { formatAED } from '@/lib/format';
import { formatMinorUnits } from '@/lib/ledger-money';
import { ledgerCurrencyDisplay } from '@/lib/markets';
import { limitedCategorySummary, spendingShare, spendingShareLabel, type SpendingCategoryRow } from '@/lib/reference-presentation';
import type { CategoryId } from '@/lib/types';

export type CategoryFilter = 'all' | 'limited' | 'unlimited';

export { spendingCopy } from '@/lib/reference-copy';

/**
 * The donut deliberately collapses the long tail into one neutral "Other"
 * wedge. The list must not inherit that neutral colour: in dark mode the
 * neutral is intentionally close to the surface colour and becomes almost
 * invisible when used as text/icon ink. Give every real category a stable,
 * readable categorical accent instead.
 */
function categoryPaletteIndex(category: CategoryId, paletteSize: number): number {
  if (paletteSize <= 1) return 0;
  let hash = 0;
  for (let index = 0; index < category.length; index += 1) {
    hash = (hash * 31 + category.charCodeAt(index)) >>> 0;
  }
  return hash % paletteSize;
}

type Props = {
  periodLabel: string;
  totalFils: number;
  rows: readonly SpendingCategoryRow[];
  monthScoped: boolean;
  filter: CategoryFilter;
  onFilter: (filter: CategoryFilter) => void;
  onPeriod: () => void;
  onCategory: (category: CategoryId) => void;
  onNewLimit: () => void;
  /** Optional secondary action rendered between the donut summary and the
   *  category list — the natural place for a follow-up like the assistant
   *  ghost. Rendering it as a sibling in the parent buried it beneath the
   *  whole list, which read as a footer, not a companion to the summary. */
  assistantSlot?: React.ReactNode;
};

/** Categories and their limits are ONE list. No repeated category chart below it. */
export function SpendingOverview(p: Props) {
  const theme = useTheme(); const language = useLanguage(); const large = useLargeTextLayout();
  const { width } = useWindowDimensions();
  const donutSize = Math.round(Math.min(184, Math.max(164, width * 0.46)));
  const donutThickness = donutSize <= 170 ? 15 : 16;
  const moneySpec = useLedgerMoney();
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(Math.round(fils), moneySpec)}` : formatAED(fils);
  const w = spendingCopy[language === 'ar' ? 'ar' : 'en'];
  const limited = limitedCategorySummary(p.rows);
  const rows = p.rows.filter((row) => p.filter === 'all' ||
    (p.filter === 'limited' ? row.limitFils !== null : row.limitFils === null));
  const health = (ratio: number | null) => ratio !== null && ratio > 1 ? theme.expenseGraphic
    : ratio !== null && ratio >= 0.85 ? theme.warningGraphic : theme.primary;
  const palette = useCategoricalPalette();
  const scheme = useColorScheme();
  const neutral = DataViz[scheme === 'dark' ? 'dark' : 'light'].neutral;
  const [selectedSliceKey, setSelectedSliceKey] = useState<string | null>(null);
  // The pie carries the top slices in the multi-hue categorical palette, then a
  // single neutral "Other" wedge for the tail so five distinct hues do not have
  // to explain twelve categories. Colour keyed by category id, not row index,
  // so a filter change on the list below does not repaint the pie.
  const donutColors = useMemo(() => {
    const map = new Map<CategoryId, string>();
    const ranked = [...p.rows].filter((row) => row.spentFils > 0);
    const head = ranked.slice(0, palette.length);
    head.forEach((row, i) => map.set(row.category, palette[i]!));
    return map;
  }, [p.rows, palette]);
  const slices: DonutSlice[] = useMemo(() => {
    const drawn: DonutSlice[] = [];
    let tail = 0;
    for (const row of p.rows) {
      if (row.spentFils <= 0) continue;
      const color = donutColors.get(row.category);
      if (color) drawn.push({ key: row.category, label: categoryLabel(row.category, language), value: row.spentFils, color });
      else tail += row.spentFils;
    }
    if (tail > 0) drawn.push({ key: '__tail', label: w.otherCategories, value: tail, color: neutral });
    return drawn;
  }, [p.rows, donutColors, neutral, language, w.otherCategories]);
  // Legend rows for the picture the donut is drawing: the same slices, in the
  // same order, with the same colours and their share of the total. Uses the
  // slices array rather than re-deriving from rows so the legend can never
  // disagree with the pie. `category` is null for the __tail wedge, and the
  // legend renders it as a generic receipt glyph rather than pretending the
  // aggregation is a real category id.
  const legendItems = useMemo(() => [...slices]
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
    .map((slice) => ({
      key: slice.key,
      label: slice.label,
      color: slice.color,
      category: slice.key === '__tail' ? null : (slice.key as CategoryId),
      share: p.totalFils > 0 ? slice.value / p.totalFils : 0,
    })), [slices, p.totalFils]);
  const selectedSlice = selectedSliceKey ? slices.find((slice) => slice.key === selectedSliceKey) ?? null : null;
  const centerAmount = selectedSlice?.value ?? p.totalFils;
  const centerShare = selectedSlice && p.totalFils > 0 ? selectedSlice.value / p.totalFils : null;
  const currency = moneySpec?.currency ?? ledgerCurrencyDisplay();
  const compactAmount = useMemo(() => {
    const exponent = moneySpec?.exponent ?? 2;
    const major = Math.abs(centerAmount) / (10 ** exponent);
    // Four/five-digit totals still fit comfortably in the hole and are more
    // useful shown exactly. Compact only the genuinely wide figures that caused
    // the original overflow (hundreds of thousands and above).
    if (major < 100_000) return moneySpec
      ? formatMinorUnits(Math.round(Math.abs(centerAmount)), moneySpec)
      : formatAED(Math.abs(centerAmount)).replace(/^\S+\s+/, '');
    const unit = major >= 1_000_000_000 ? 1_000_000_000 : major >= 1_000_000 ? 1_000_000 : 1000;
    const suffix = unit === 1_000_000_000 ? 'B' : unit === 1_000_000 ? 'M' : 'k';
    const scaled = major / unit;
    const maximumFractionDigits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
    return `${new Intl.NumberFormat(language === 'ar' ? 'ar-AE' : 'en', {
      maximumFractionDigits,
      minimumFractionDigits: 0,
    }).format(scaled)}${suffix}`;
  }, [centerAmount, language, moneySpec]);
  return <View style={styles.root} testID="spending-categories">
    <View style={styles.hero}>
      <Pressable accessibilityRole="button" accessibilityLabel={p.periodLabel} onPress={p.onPeriod} style={styles.period}>
        <ThemedText type="smallBold">{w.spent}</ThemedText>
        <View style={styles.periodRight}><ThemedText type="meta" themeColor="textSecondary">{p.periodLabel}</ThemedText>
          <Icon name="chevron-down" size={15} color={theme.textSecondary} /></View>
      </Pressable>
      <View style={styles.donutWrap}>
        <CategoryDonut
          slices={slices}
          size={donutSize}
          thickness={donutThickness}
          centerLabel={selectedSlice?.label ?? w.spent}
          centerValue={<View accessible accessibilityRole="text"
            accessibilityLabel={`${currency} ${moneySpec
              ? formatMinorUnits(Math.round(Math.abs(centerAmount)), moneySpec)
              : formatAED(Math.abs(centerAmount)).replace(/^\S+\s+/, '')}`}
            style={styles.centerMoney}>
            <ThemedText type="micro" themeColor="textSecondary">{currency}</ThemedText>
            <ThemedText type="subtitle" tabular numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
              {compactAmount}
            </ThemedText>
          </View>}
          centerMeta={centerShare === null ? p.periodLabel : `${spendingShareLabel(centerShare, language)} ${w.share}`}
          accessibilityLabel={selectedSlice
            ? `${selectedSlice.label}. ${moneyLabel(centerAmount)}. ${spendingShareLabel(centerShare ?? 0, language)} ${w.share}`
            : `${w.spent}. ${moneyLabel(centerAmount)}. ${p.periodLabel}`}
          selectedKey={selectedSlice?.key ?? null}
          onPressCenter={selectedSlice ? () => setSelectedSliceKey(null) : undefined}
          onPressSlice={(key) => {
            // The chart is for quick inspection; the complete list below owns
            // navigation. Keeping a ring tap local also avoids a tiny segment
            // unexpectedly opening a sheet while the user is trying to scroll.
            setSelectedSliceKey((current) => current === key ? null : key);
          }}
        />
      </View>
      {legendItems.length > 0 && <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {legendItems.map((item) => <View key={item.key} style={styles.legendItem}>
          <View style={styles.legendIdentity}>
            {item.category !== null
              ? <CategoryAvatar category={item.category} size={18} color={item.color} />
              : <Icon name="receipt" size={16} color={item.color} strokeWidth={2} />}
            <ThemedText type="meta" numberOfLines={1} style={styles.legendLabel}>{item.label}</ThemedText>
          </View>
          <ThemedText type="meta" tabular themeColor="textSecondary">{spendingShareLabel(item.share, language)}</ThemedText>
        </View>)}
      </View>}
      <ThemedText type="meta" themeColor="textSecondary" style={styles.heroNote}>{w.shareNote}</ThemedText>
    </View>

    {p.assistantSlot}
    <ThemedText type="heading">{w.breakdown}</ThemedText>
    {p.monthScoped && <View style={styles.filters} accessibilityLabel={w.categories}>
      {([{ key: 'all', label: w.all }, { key: 'limited', label: w.withLimits }, { key: 'unlimited', label: w.noLimits }] as const)
        .map(({ key, label }) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={label}
          accessibilityState={{ selected: p.filter === key }} onPress={() => p.onFilter(key)}
          style={[styles.filter, { backgroundColor: p.filter === key ? theme.inverseSurface : theme.backgroundSelected }]}>
          <ThemedText type="meta" style={{ color: p.filter === key ? theme.inverseText : theme.textSecondary }}>{label}</ThemedText>
        </Pressable>)}
    </View>}

    <View style={styles.categories}>
      {rows.map((row) => {
        const share = spendingShare(row.spentFils, p.totalFils);
        const shareLabel = spendingShareLabel(share, language);
        const sliceColor = donutColors.get(row.category) ??
          palette[categoryPaletteIndex(row.category, palette.length)] ?? theme.primary;
        return <Pressable key={row.category} accessibilityRole="button" testID={`spending-category-${row.category}`}
        accessibilityLabel={`${categoryLabel(row.category, language)}. ${moneyLabel(row.spentFils)}. ${shareLabel} ${w.share}. ${row.limitFils === null ? w.noLimit : `${w.withLimits}: ${moneyLabel(row.limitFils)}`}`}
        onPress={() => p.onCategory(row.category)}
        style={({ pressed }) => [styles.category, { borderTopColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
        <CategoryAvatar category={row.category} size={36} color={sliceColor} />
        <View style={styles.categoryContent}>
          <View style={[styles.categoryTop, large && styles.stack]}>
            <ThemedText type="smallBold" style={styles.grow}>{categoryLabel(row.category, language)}</ThemedText>
            <Money fils={row.spentFils} type="smallBold" />
          </View>
          <View style={styles.categoryBottom}>
            <ThemedText type="meta" tabular style={{ color: sliceColor }} testID={`spending-share-${row.category}`}>
              {shareLabel} {w.share}</ThemedText>
            <Icon name="chevron-right" size={14} color={theme.textSecondary} />
          </View>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <ProgressBar ratio={share} color={sliceColor} height={3}
              trackColor={scheme === 'dark' ? theme.cardBorderStrong : theme.track} />
          </View>
          {row.limitFils !== null && <>
            <View style={[styles.categoryBottom, large && styles.stack]}>
              <ThemedText type="meta" themeColor={row.remainingFils! < 0 ? 'expense' : 'textSecondary'} style={styles.caption}>
                {moneyLabel(Math.abs(row.remainingFils!))} {row.remainingFils! < 0 ? w.over : w.left}</ThemedText>
              <ThemedText type="meta" tabular themeColor="textSecondary" style={styles.caption}>
                {Math.round(row.ratio! * 100)}% {w.budgetUsed}</ThemedText>
            </View>
          </>}
        </View>
      </Pressable>; })}
      {rows.length === 0 && <View style={[styles.empty, { backgroundColor: 'transparent', borderColor: theme.cardBorder }]}>
        <Icon name="chart" size={28} color={theme.primary} />
        <ThemedText type="smallBold">{p.rows.length === 0 ? w.empty : w.emptyFilter}</ThemedText>
        {p.rows.length === 0 && <ThemedText type="meta" themeColor="textSecondary">{w.emptyBody}</ThemedText>}
      </View>}
    </View>
    {limited.count > 0 && <View style={[styles.budgetSummary, { backgroundColor: 'transparent', borderColor: theme.cardBorder }]} testID="limited-category-summary">
      <ThemedText type="smallBold">{w.limited} · {limited.count}</ThemedText>
      <View style={[styles.summaryLine, large && styles.stack]}>
        <ThemedText type="meta" tabular>{moneyLabel(limited.spentFils)} {w.of} {moneyLabel(limited.limitFils)}</ThemedText>
        <ThemedText type="meta" tabular themeColor={limited.ratio! > 1 ? 'expense' : 'textSecondary'}>
          {Math.round(limited.ratio! * 100)}% {w.used}</ThemedText>
      </View>
      <ProgressBar ratio={limited.ratio!} color={health(limited.ratio)} height={5} />
    </View>}
    {p.monthScoped && <Button label={w.newLimit} variant="outline" icon="plus" onPress={p.onNewLimit} />}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 10 },
  hero: { paddingVertical: 4, gap: 8, alignItems: 'stretch' },
  donutWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 0 },
  centerMoney: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: 5, maxWidth: '100%' },
  heroNote: { textAlign: 'center' },
  legend: { gap: 5, paddingHorizontal: 6 },
  legendItem: { minHeight: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  legendIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendLabel: { flexShrink: 1, minWidth: 0 },
  period: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44, flexWrap: 'wrap' },
  periodRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  budgetSummary: { gap: 10, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1 }, summaryLine: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, filter: { paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, borderRadius: 4, justifyContent: 'center' },
  categories: { gap: 0 }, category: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 0, borderTopWidth: 1 },
  categoryContent: { flex: 1, minWidth: 0, gap: 5 }, categoryTop: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  categoryBottom: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1, minWidth: 0 }, caption: { fontSize: 12, lineHeight: 18 }, stack: { flexDirection: 'column', alignItems: 'flex-start' },
  empty: { paddingVertical: 24, gap: 12 },
});

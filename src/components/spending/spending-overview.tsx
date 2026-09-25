import { spendingCopy } from '@/lib/reference-copy';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { CategoryAvatar } from '@/components/ui/category-avatar';
import { useCategoricalPalette } from '@/components/ui/charts';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { PeriodPill } from '@/components/ui/period-pill';
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

type ShareSegment = { key: string; label: string; value: number; color: string };

/**
 * The share bar deliberately collapses the long tail into one neutral "Other
 * categories" segment. The list must not inherit that neutral colour: in dark
 * mode the neutral is intentionally close to the surface colour and becomes
 * almost invisible when used as text/icon ink. Give every real category a
 * stable, readable categorical accent instead.
 */
function categoryPaletteIndex(category: CategoryId, paletteSize: number): number {
  if (paletteSize <= 1) return 0;
  let hash = 0;
  for (let index = 0; index < category.length; index += 1) {
    hash = (hash * 31 + category.charCodeAt(index)) >>> 0;
  }
  return hash % paletteSize;
}

/** Amber from 85% of a limit, red once it is exceeded (the shared health rule). */
export function limitHealth(ratio: number | null): 'ok' | 'warning' | 'over' {
  return ratio !== null && ratio > 1 ? 'over' : ratio !== null && ratio >= 0.85 ? 'warning' : 'ok';
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
  /** "day 12 of 30" for the running money month only; omitted otherwise. */
  paceLabel?: string | null;
  /** Optional secondary action rendered between the summary and the
   *  category list — the natural place for a follow-up like the assistant
   *  ghost. Rendering it as a sibling in the parent buried it beneath the
   *  whole list, which read as a footer, not a companion to the summary. */
  assistantSlot?: React.ReactNode;
};

/** Categories and their limits are ONE list, under one stacked share bar. */
export function SpendingOverview(p: Props) {
  const theme = useTheme(); const language = useLanguage(); const large = useLargeTextLayout();
  const moneySpec = useLedgerMoney();
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(Math.round(fils), moneySpec)}` : formatAED(fils);
  const w = spendingCopy[language === 'ar' ? 'ar' : 'en'];
  const limited = limitedCategorySummary(p.rows);
  const rows = p.rows.filter((row) => p.filter === 'all' ||
    (p.filter === 'limited' ? row.limitFils !== null : row.limitFils === null));
  const health = (ratio: number | null) => {
    const state = limitHealth(ratio);
    return state === 'over' ? theme.expenseGraphic : state === 'warning' ? theme.warningGraphic : theme.primary;
  };
  const palette = useCategoricalPalette();
  const scheme = useColorScheme();
  const neutral = DataViz[scheme === 'dark' ? 'dark' : 'light'].neutral;
  // The bar carries the top categories in the multi-hue categorical palette,
  // then one neutral segment for the tail so five hues do not have to explain
  // twelve categories. Colour is keyed by category id, not row index, so a
  // filter change on the list below does not repaint the bar.
  const segmentColors = useMemo(() => {
    const map = new Map<CategoryId, string>();
    const ranked = [...p.rows].filter((row) => row.spentFils > 0);
    ranked.slice(0, palette.length).forEach((row, i) => map.set(row.category, palette[i]!));
    return map;
  }, [p.rows, palette]);
  const segments: ShareSegment[] = useMemo(() => {
    const drawn: ShareSegment[] = [];
    let tail = 0;
    for (const row of p.rows) {
      if (row.spentFils <= 0) continue;
      const color = segmentColors.get(row.category);
      if (color) drawn.push({ key: row.category, label: categoryLabel(row.category, language), value: row.spentFils, color });
      else tail += row.spentFils;
    }
    if (tail > 0) drawn.push({ key: '__tail', label: w.otherCategories, value: tail, color: neutral });
    return drawn;
  }, [p.rows, segmentColors, neutral, language, w.otherCategories]);
  const currency = moneySpec?.currency ?? ledgerCurrencyDisplay();
  // Exact, never abbreviated: the headline carries every minor unit.
  const exactAmount = moneySpec
    ? formatMinorUnits(Math.round(Math.abs(p.totalFils)), moneySpec)
    : formatAED(Math.abs(p.totalFils)).replace(/^\S+\s+/, '');
  const shareSummary = segments.map((segment) =>
    `${segment.label} ${spendingShareLabel(p.totalFils > 0 ? segment.value / p.totalFils : 0, language)}`).join(', ');
  return <View style={styles.root} testID="spending-categories">
    <View style={styles.hero}>
      <View style={styles.period}>
        <ThemedText type="smallBold">{w.spent}</ThemedText>
        <PeriodPill onPress={p.onPeriod} />
      </View>
      <View style={styles.totalLine} accessible accessibilityRole="text"
        accessibilityLabel={[`${w.spent}. ${currency} ${exactAmount}. ${p.periodLabel}`, p.paceLabel].filter(Boolean).join('. ')}>
        <ThemedText type="subtitle" tabular style={styles.exactAmount} testID="spending-total">
          {currency} {exactAmount}
        </ThemedText>
        {p.paceLabel ? <ThemedText type="meta" themeColor="textSecondary" testID="spending-pace">{p.paceLabel}</ThemedText> : null}
      </View>
      {segments.length > 0 && <View testID="spending-share-bar" accessible accessibilityRole="image"
        accessibilityLabel={`${w.shareBar}. ${shareSummary}`} style={styles.shareBar}>
        {segments.map((segment) => <View key={segment.key} testID={`spending-share-segment-${segment.key}`}
          style={[styles.shareSegment, { flexGrow: segment.value, backgroundColor: segment.color }]} />)}
      </View>}
      <ThemedText type="meta" themeColor="textSecondary">{w.shareNote}</ThemedText>
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
        const sliceColor = segmentColors.get(row.category) ??
          palette[categoryPaletteIndex(row.category, palette.length)] ?? theme.primary;
        const limitState = limitHealth(row.ratio);
        const limitCaption = row.limitFils !== null && row.ratio !== null
          ? w.limitOf(Math.round(row.ratio * 100), moneyLabel(row.limitFils)) : null;
        const limitSpoken = row.limitFils === null || row.remainingFils === null ? w.noLimit
          : `${limitCaption}. ${moneyLabel(Math.abs(row.remainingFils))} ${row.remainingFils < 0 ? w.over : w.left}`;
        return <Pressable key={row.category} accessibilityRole="button" testID={`spending-category-${row.category}`}
          accessibilityLabel={`${categoryLabel(row.category, language)}. ${moneyLabel(row.spentFils)}. ${shareLabel} ${w.share}. ${limitSpoken}`}
          onPress={() => p.onCategory(row.category)}
          style={({ pressed }) => [styles.category, { borderTopColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          <CategoryAvatar category={row.category} size={36} color={sliceColor} />
          <View style={styles.categoryContent}>
            <View style={[styles.categoryTop, large && styles.stack]}>
              <ThemedText type="smallBold" style={styles.grow}>{categoryLabel(row.category, language)}</ThemedText>
              <Money fils={row.spentFils} type="smallBold" />
            </View>
            <View style={[styles.categoryBottom, large && styles.stack]}>
              <ThemedText type="meta" tabular themeColor="textSecondary" testID={`spending-share-${row.category}`}>
                {shareLabel} {w.share}</ThemedText>
              {limitCaption ? <ThemedText type="meta" tabular testID={`spending-limit-${row.category}`} style={styles.caption}
                themeColor={limitState === 'over' ? 'expense' : limitState === 'warning' ? 'warning' : 'textSecondary'}>
                {limitCaption}</ThemedText> : <Icon name="chevron-right" size={14} color={theme.textSecondary} />}
            </View>
            <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {row.ratio !== null
                ? <ProgressBar ratio={Math.min(1, row.ratio)} color={health(row.ratio)} height={3}
                  trackColor={scheme === 'dark' ? theme.cardBorderStrong : theme.track} />
                : <ProgressBar ratio={share} color={sliceColor} height={3}
                  trackColor={scheme === 'dark' ? theme.cardBorderStrong : theme.track} />}
            </View>
          </View>
        </Pressable>;
      })}
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
  totalLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  exactAmount: { flexShrink: 1 },
  shareBar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 },
  shareSegment: { flexBasis: 0, minWidth: 3, height: '100%' },
  period: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44, flexWrap: 'wrap' },
  budgetSummary: { gap: 10, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1 }, summaryLine: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, filter: { paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, borderRadius: 4, justifyContent: 'center' },
  categories: { gap: 0 }, category: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 0, borderTopWidth: 1 },
  categoryContent: { flex: 1, minWidth: 0, gap: 5 }, categoryTop: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  categoryBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1, minWidth: 0 }, caption: { fontSize: 12, lineHeight: 18 }, stack: { flexDirection: 'column', alignItems: 'flex-start' },
  empty: { paddingVertical: 24, gap: 12 },
});

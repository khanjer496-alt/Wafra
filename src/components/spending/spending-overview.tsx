import { spendingCopy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { CategoryAvatar } from '@/components/ui/category-avatar';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Button } from '@/components/ui/controls';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useTheme } from '@/hooks/use-theme';
import { categoryLabel } from '@/lib/categories';
import { formatAED } from '@/lib/format';
import { limitedCategorySummary, type SpendingCategoryRow } from '@/lib/reference-presentation';
import type { CategoryId } from '@/lib/types';

export type CategoryFilter = 'all' | 'limited' | 'unlimited';

export { spendingCopy } from '@/lib/reference-copy';

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
};

/** Categories and their limits are ONE list. No repeated category chart below it. */
export function SpendingOverview(p: Props) {
  const theme = useTheme(); const language = useLanguage(); const large = useLargeTextLayout();
  const w = spendingCopy[language === 'ar' ? 'ar' : 'en'];
  const limited = limitedCategorySummary(p.rows);
  const rows = p.rows.filter((row) => p.filter === 'all' ||
    (p.filter === 'limited' ? row.limitFils !== null : row.limitFils === null));
  const health = (ratio: number | null) => ratio !== null && ratio > 1 ? theme.expenseGraphic
    : ratio !== null && ratio >= 0.85 ? theme.warningGraphic : theme.primary;
  return <View style={styles.root} testID="spending-categories">
    <View style={[styles.overview, { backgroundColor: 'transparent', borderColor: theme.cardBorder }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={p.periodLabel} onPress={p.onPeriod} style={styles.period}>
        <ThemedText type="smallBold">{w.spent}</ThemedText>
        <View style={styles.periodRight}><ThemedText type="meta" themeColor="textSecondary">{p.periodLabel}</ThemedText>
          <Icon name="chevron-down" size={15} color={theme.textSecondary} /></View>
      </Pressable>
      <Money fils={p.totalFils} type="amount" />
      {limited.count > 0 ? <View style={styles.budgetSummary} testID="limited-category-summary">
        <ThemedText type="meta" themeColor="textSecondary">{w.limited} · {limited.count}</ThemedText>
        <View style={[styles.summaryLine, large && styles.stack]}>
          <ThemedText type="small" tabular>{formatAED(limited.spentFils)} {w.of} {formatAED(limited.limitFils)}</ThemedText>
          <ThemedText type="meta" tabular themeColor={limited.ratio! > 1 ? 'expense' : 'textSecondary'}>
            {Math.round(limited.ratio! * 100)}% {w.used}</ThemedText>
        </View>
        <ProgressBar ratio={limited.ratio!} color={health(limited.ratio)} height={7} />
      </View> : <ThemedText type="meta" themeColor="textSecondary">
        {p.monthScoped ? w.noLimit : w.monthlyOnly}</ThemedText>}
    </View>

    {p.monthScoped && <View style={styles.filters} accessibilityLabel={w.categories}>
      {([{ key: 'all', label: w.all }, { key: 'limited', label: w.withLimits }, { key: 'unlimited', label: w.noLimits }] as const)
        .map(({ key, label }) => <Pressable key={key} accessibilityRole="button" accessibilityLabel={label}
          accessibilityState={{ selected: p.filter === key }} onPress={() => p.onFilter(key)}
          style={[styles.filter, { backgroundColor: p.filter === key ? theme.inverseSurface : theme.backgroundSelected }]}>
          <ThemedText type="meta" style={{ color: p.filter === key ? theme.inverseText : theme.textSecondary }}>{label}</ThemedText>
        </Pressable>)}
    </View>}

    <View style={styles.categories}>
      {rows.map((row) => <Pressable key={row.category} accessibilityRole="button"
        accessibilityLabel={`${categoryLabel(row.category, language)}. ${formatAED(row.spentFils)}. ${row.limitFils === null ? w.noLimit : `${w.withLimits}: ${formatAED(row.limitFils)}`}`}
        onPress={() => p.onCategory(row.category)}
        style={({ pressed }) => [styles.category, { borderTopColor: theme.cardBorder, backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
        <CategoryAvatar category={row.category} size={44} />
        <View style={styles.categoryContent}>
          <View style={[styles.categoryTop, large && styles.stack]}>
            <ThemedText type="smallBold" style={styles.grow}>{categoryLabel(row.category, language)}</ThemedText>
            <Money fils={row.spentFils} type="smallBold" />
          </View>
          {row.limitFils !== null ? <>
            <ProgressBar ratio={row.ratio!} color={health(row.ratio)} height={5} />
            <View style={[styles.categoryBottom, large && styles.stack]}>
              <ThemedText type="meta" themeColor={row.remainingFils! < 0 ? 'expense' : 'textSecondary'} style={styles.caption}>
                {formatAED(Math.abs(row.remainingFils!))} {row.remainingFils! < 0 ? w.over : w.left}</ThemedText>
              <ThemedText type="meta" tabular themeColor="textTertiary" style={styles.caption}>
                {Math.round(row.ratio! * 100)}%</ThemedText>
            </View>
          </> : <View style={styles.categoryBottom}>
            <ThemedText type="meta" themeColor="textTertiary">{p.monthScoped ? w.noLimit : w.details}</ThemedText>
            <Icon name="chevron-right" size={14} color={theme.textTertiary} />
          </View>}
        </View>
      </Pressable>)}
      {rows.length === 0 && <View style={[styles.empty, { backgroundColor: 'transparent', borderColor: theme.cardBorder }]}>
        <Icon name="chart" size={28} color={theme.primary} />
        <ThemedText type="smallBold">{p.rows.length === 0 ? w.empty : w.emptyFilter}</ThemedText>
        {p.rows.length === 0 && <ThemedText type="meta" themeColor="textSecondary">{w.emptyBody}</ThemedText>}
      </View>}
    </View>
    {p.monthScoped && <Button label={w.newLimit} variant="outline" icon="plus" onPress={p.onNewLimit} />}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 16 }, overview: { paddingVertical: 18, gap: 12 },
  period: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 44, flexWrap: 'wrap' },
  periodRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  budgetSummary: { gap: 8 }, summaryLine: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, filter: { paddingHorizontal: 16, paddingVertical: 10, minHeight: 44, borderRadius: 4, justifyContent: 'center' },
  categories: { gap: 0 }, category: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 0, borderTopWidth: 1 },
  categoryContent: { flex: 1, minWidth: 0, gap: 7 }, categoryTop: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  categoryBottom: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1, minWidth: 0 }, caption: { fontSize: 12, lineHeight: 18 }, stack: { flexDirection: 'column', alignItems: 'flex-start' },
  empty: { paddingVertical: 24, gap: 12 },
});

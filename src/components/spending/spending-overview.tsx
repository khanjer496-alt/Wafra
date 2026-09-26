import { spendingCopy } from '@/lib/reference-copy';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { EButton } from '@/components/ui/band/e-button';
import { GlyphTile } from '@/components/ui/band/glyph-tile';
import { LimitStatusBar, limitStatusColor } from '@/components/ui/band/status-bar';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Fonts } from '@/constants/theme';
import { useBand } from '@/hooks/use-band';
import { useLanguage } from '@/hooks/use-language';
import { useLargeTextLayout } from '@/hooks/use-large-text-layout';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import { categoryLabel } from '@/lib/categories';
import { everydayBandCopy } from '@/lib/everyday-band-copy';
import { formatAED } from '@/lib/format';
import { formatMinorUnits } from '@/lib/ledger-money';
import { limitStatus } from '@/lib/limit-status';
import { limitedCategorySummary, spendingShare, spendingShareLabel, type SpendingCategoryRow } from '@/lib/reference-presentation';
import type { CategoryId } from '@/lib/types';

export type CategoryFilter = 'all' | 'limited' | 'unlimited';

export { spendingCopy } from '@/lib/reference-copy';

/** Amber from 85% of a limit, red once it is exceeded (the shared health rule). */
export function limitHealth(ratio: number | null): 'ok' | 'warning' | 'over' {
  return ratio !== null && ratio > 1 ? 'over' : ratio !== null && ratio >= 0.85 ? 'warning' : 'ok';
}

type Props = {
  totalFils: number;
  rows: readonly SpendingCategoryRow[];
  monthScoped: boolean;
  filter: CategoryFilter;
  onFilter: (filter: CategoryFilter) => void;
  onCategory: (category: CategoryId) => void;
  onNewLimit: () => void;
  /** A follow-up for the figure above (Explain this), at the head of the list. */
  assistantSlot?: React.ReactNode;
};

/**
 * Spending · Categories on the sheet: every category behind the band's figure,
 * each a glyph tile in one tone with its amount and share. A row with a limit
 * carries the limit bar, coloured by status only (green within, amber from
 * 85%, red over); a row without one says so. Categories and their limits are
 * one list.
 */
export function SpendingOverview(p: Props) {
  const band = useBand('spending');
  const language = useLanguage(); const large = useLargeTextLayout();
  const moneySpec = useLedgerMoney();
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(Math.round(fils), moneySpec)}` : formatAED(fils);
  const w = spendingCopy[language === 'ar' ? 'ar' : 'en'];
  const words = everydayBandCopy(language);
  const limited = limitedCategorySummary(p.rows);
  const rows = p.rows.filter((row) => p.filter === 'all' ||
    (p.filter === 'limited' ? row.limitFils !== null : row.limitFils === null));
  return <View style={styles.root} testID="spending-categories">
    {p.assistantSlot}
    <View style={[styles.heading, large && styles.stack]}>
      <ThemedText type="smallBold" accessibilityRole="header" style={styles.sectionTitle}>{w.breakdown}</ThemedText>
      {p.monthScoped && <View style={styles.filters} accessibilityLabel={w.categories}>
        {([{ key: 'all', label: w.all }, { key: 'limited', label: w.withLimits }, { key: 'unlimited', label: w.noLimits }] as const)
          .map(({ key, label }) => {
            const on = p.filter === key;
            return <Pressable key={key} accessibilityRole="button" accessibilityLabel={label}
              accessibilityState={{ selected: on }} onPress={() => p.onFilter(key)}
              style={({ pressed }) => [styles.filter, {
                backgroundColor: on ? band.text : band.card, borderColor: on ? band.text : band.rule, opacity: pressed ? 0.8 : 1,
              }]}>
              <ThemedText type="meta" style={{ color: on ? band.sheet : band.text }}>{label}</ThemedText>
            </Pressable>;
          })}
      </View>}
    </View>

    <View>
      {rows.map((row, index) => {
        const share = spendingShare(row.spentFils, p.totalFils);
        const shareLabel = spendingShareLabel(share, language);
        const status = row.limitFils !== null ? limitStatus(row.spentFils, row.limitFils) : null;
        const limitCaption = row.limitFils !== null && row.ratio !== null
          ? [w.limitOf(Math.round(row.ratio * 100), moneyLabel(row.limitFils)),
            status === 'near' ? words.nearLimit : status === 'over' ? words.overLimit : null].filter(Boolean).join(' · ')
          : null;
        const remainingSpoken = row.remainingFils === null ? ''
          : ` ${moneyLabel(Math.abs(row.remainingFils))} ${row.remainingFils < 0 ? w.over : w.left}`;
        return <Pressable key={row.category} accessibilityRole="button" testID={`spending-category-${row.category}`}
          accessibilityLabel={`${categoryLabel(row.category, language)}. ${moneyLabel(row.spentFils)}. ${shareLabel} ${w.share}. ${row.limitFils === null ? w.noLimit : `${limitCaption}.${remainingSpoken}`}`}
          onPress={() => p.onCategory(row.category)}
          style={({ pressed }) => [styles.category, large && styles.categoryStacked,
            { borderTopColor: band.rule, borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth, opacity: pressed ? 0.7 : 1 }]}>
          <GlyphTile category={row.category} palette={band} size={40} />
          <View style={[styles.categoryContent, large && styles.categoryContentStacked]}>
            <View style={[styles.categoryTop, large && styles.stack]}>
              <ThemedText type="smallBold" style={[styles.grow, styles.name]}>{categoryLabel(row.category, language)}</ThemedText>
              <Money fils={row.spentFils} type="smallBold" />
            </View>
            <View style={[styles.categoryBottom, large && styles.stack]}>
              <ThemedText type="meta" tabular testID={`spending-share-${row.category}`} style={{ color: band.textSecondary }}>
                {row.limitFils === null ? words.shareNoLimit(shareLabel) : `${shareLabel} ${w.share}`}</ThemedText>
              {limitCaption ? <ThemedText type="meta" tabular testID={`spending-limit-${row.category}`}
                style={[styles.caption, { color: status === 'ok' ? band.textSecondary : limitStatusColor(band, status!) },
                  status !== 'ok' && styles.captionStrong]}>
                {limitCaption}</ThemedText> : null}
            </View>
            {row.limitFils !== null ? <LimitStatusBar spentMinor={row.spentFils} limitMinor={row.limitFils} palette={band} height={6}
              testID={`spending-limit-bar-${row.category}`} /> : null}
          </View>
        </Pressable>;
      })}
      {rows.length === 0 && <View style={styles.empty}>
        <Icon name="chart" size={28} color={band.tint} />
        <ThemedText type="smallBold">{p.rows.length === 0 ? w.empty : w.emptyFilter}</ThemedText>
        {p.rows.length === 0 && <ThemedText type="meta" style={{ color: band.textSecondary }}>{w.emptyBody}</ThemedText>}
      </View>}
    </View>
    {limited.count > 0 && <View style={[styles.budgetSummary, { borderColor: band.rule }]} testID="limited-category-summary">
      <ThemedText type="smallBold">{w.limited} · {limited.count}</ThemedText>
      <View style={[styles.summaryLine, large && styles.stack]}>
        <ThemedText type="meta" tabular>{moneyLabel(limited.spentFils)} {w.of} {moneyLabel(limited.limitFils)}</ThemedText>
        <ThemedText type="meta" tabular style={{ color: limited.ratio! > 1 ? band.statusOver : band.textSecondary }}>
          {Math.round(limited.ratio! * 100)}% {w.used}</ThemedText>
      </View>
      <LimitStatusBar spentMinor={limited.spentFils} limitMinor={limited.limitFils} palette={band} />
    </View>}
    {p.monthScoped && <EButton palette={band} variant="secondary" icon="plus" label={w.newLimit} onPress={p.onNewLimit}
      testID="spending-new-limit" />}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 12 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  sectionTitle: { fontSize: 17, lineHeight: 24 },
  budgetSummary: { gap: 10, paddingVertical: 16, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  summaryLine: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filter: { paddingHorizontal: 14, minHeight: 44, borderRadius: 22, borderWidth: 1, justifyContent: 'center' },
  category: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  // At the accessibility sizes the tile sits above the name, so a long
  // single word ("Entertainment") gets the row's full width instead of
  // breaking mid-word beside it.
  categoryStacked: { flexDirection: 'column', alignItems: 'stretch' },
  categoryContent: { flex: 1, minWidth: 0, gap: 5 },
  categoryContentStacked: { flex: 0, flexBasis: 'auto', alignSelf: 'stretch' },
  categoryTop: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  categoryBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  grow: { flex: 1, minWidth: 0 }, name: { fontSize: 16 },
  caption: { fontSize: 12.5, lineHeight: 18 }, captionStrong: { fontFamily: Fonts.sansSemi },
  stack: { flexDirection: 'column', alignItems: 'flex-start' },
  empty: { paddingVertical: 24, gap: 12 },
});

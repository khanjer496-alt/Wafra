import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { BandFigure } from '@/components/ui/band/band-figure';
import { ShareBar } from '@/components/ui/band/share-bar';
import { Fonts, type BandPalette } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useLedgerMoney } from '@/hooks/use-ledger-money';
import type { ComparableSpend } from '@/lib/analytics';
import { categoryLabel } from '@/lib/categories';
import { everydayBandCopy } from '@/lib/everyday-band-copy';
import { formatAED } from '@/lib/format';
import { formatMinorUnits } from '@/lib/ledger-money';
import { spendingTrendsCopy } from '@/lib/reference-copy';
import type { SpendingCategoryRow } from '@/lib/reference-presentation';
import { compareDirection } from '@/lib/spending-compare';

/**
 * Spending · Categories on the clay band: the period's total as the band's one
 * figure, the running month's "Day X of Y", then the share bar (one cream tone,
 * the three biggest named, "+N more"). The rows that add up to the figure are
 * on the sheet below.
 */
export function SpendingCategoriesBand({ palette, label, totalFils, paceLabel, rows }: {
  palette: BandPalette;
  /** "Spent this month", or "Spent in Aug 2026" for another period. */
  label: string;
  totalFils: number;
  /** "Day 25 of 30" for the running money month only. */
  paceLabel: string | null;
  rows: readonly SpendingCategoryRow[];
}) {
  const language = useLanguage();
  const w = spendingTrendsCopy[language === 'ar' ? 'ar' : 'en'];
  return <View style={styles.block} testID="spending-hero">
    <View style={styles.figure}>
      <BandFigure testID="spending-total" label={label} fils={totalFils} palette={palette} />
      {paceLabel ? <ThemedText type="meta" testID="spending-pace" style={{ color: palette.onBandSecondary }}>{paceLabel}</ThemedText> : null}
    </View>
    <ShareBar testID="spending-share-bar" palette={palette} label={w.spending}
      segments={rows.map((row) => ({ key: row.category, label: categoryLabel(row.category, language), value: row.spentFils }))} />
  </View>;
}

/**
 * Spending · Compare on the band: one plain sentence from the existing
 * like-for-like comparison ("AED 640 more than by this point in August"),
 * then which days and costs it covers. No sentence when there is nothing
 * comparable; the view says why instead.
 */
export function SpendingCompareBand({ palette, comparison, otherName, partial, paceDay, noiseFloorFils }: {
  palette: BandPalette;
  comparison: ComparableSpend | null;
  /** The earlier period's name ("Aug 2026"); null when there is none. */
  otherName: string | null;
  /** The current period is still running, so both sides stop at the same day. */
  partial: boolean;
  /** Day of the running money month, when known. */
  paceDay: number | null;
  noiseFloorFils: number;
}) {
  const language = useLanguage();
  const words = everydayBandCopy(language);
  const w = spendingTrendsCopy[language === 'ar' ? 'ar' : 'en'];
  const moneySpec = useLedgerMoney();
  const moneyLabel = (fils: number) => moneySpec
    ? `${moneySpec.currency} ${formatMinorUnits(Math.round(fils), moneySpec)}` : formatAED(fils);
  if (!comparison || !otherName) {
    return <View style={styles.block} testID="spending-compare-band">
      <ThemedText type="small" style={{ color: palette.onBand }}>{w.missingComparison}</ThemedText>
    </View>;
  }
  const direction = compareDirection(comparison, noiseFloorFils);
  const amount = moneyLabel(Math.abs(comparison.deltaFils));
  const sentence = direction === 'same' ? words.compareSame(otherName, partial)
    : direction === 'more' ? words.compareMore(amount, otherName, partial)
      : words.compareLess(amount, otherName, partial);
  const joined = [partial && paceDay ? words.compareWindow(paceDay) : null, words.fixedLeftOut].filter(Boolean).join(' · ');
  const detail = joined.charAt(0).toLocaleUpperCase() + joined.slice(1);
  return <View style={styles.block} testID="spending-compare-band" accessible accessibilityRole="text"
    accessibilityLabel={`${sentence}. ${detail}`}>
    <ThemedText type="title" accessibilityRole="header" testID="spending-compare-sentence"
      style={[styles.sentence, { color: palette.onBand }]}>{sentence}</ThemedText>
    <ThemedText type="small" style={{ color: palette.onBandSecondary }}>{detail}</ThemedText>
  </View>;
}

const styles = StyleSheet.create({
  block: { gap: 14 },
  figure: { gap: 4 },
  sentence: { fontFamily: Fonts.sansSemi, fontSize: 30, lineHeight: 36, letterSpacing: -1 },
});

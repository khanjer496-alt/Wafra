import { useCategoryCatalog } from '@/hooks/use-category-catalog';
/**
 * Structured parts of an Ask Wafra answer: upcoming payment rows with their
 * merchant logos, and a bar per recorded month. Both draw only what the
 * executor computed (AssistantAnswer.payments / monthlySeries); nothing here
 * derives a figure of its own.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { GrowBar } from '@/components/ui/grow-bar';
import { MerchantAvatar } from '@/components/ui/merchant-avatar';
import { Spacing, type BandPalette } from '@/constants/theme';
import { assistantScreenCopy } from '@/lib/assistant-screen-copy';

import { structuralTitleLabel } from '@/lib/i18n';
import { formatMinorUnits, formatMoneyText, type LedgerMoneySpec } from '@/lib/ledger-money';
import type { AssistantMonthTotal, AssistantPaymentRow } from '@/lib/wafra-assistant';

function shortDate(iso: string, language: 'en' | 'ar'): string {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  try {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-AE' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      .format(new Date(year, month - 1, day));
  } catch {
    return iso;
  }
}

function monthLabel(key: string, language: 'en' | 'ar'): string {
  const [year, month] = key.split('-').map(Number);
  if (!year || !month) return key;
  try {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-AE' : 'en-GB', { month: 'short' })
      .format(new Date(year, month - 1, 1));
  } catch {
    return key;
  }
}

/** Exact value for a visible monthly row, including zero and minor units. */
export function monthBarValue(totalFils: number, money: LedgerMoneySpec): string {
  return formatMinorUnits(totalFils, money);
}

export function AssistantPaymentRows({ payments, money, language, palette }: {
  payments: AssistantPaymentRow[];
  money: LedgerMoneySpec;
  language: 'en' | 'ar';
  palette: BandPalette;
}) {
  const { categoryLabel } = useCategoryCatalog();
  const copy = assistantScreenCopy(language);
  return (
    <View testID="assistant-payment-rows" style={[styles.rows, { borderColor: palette.rule }]}>
      {payments.map((payment, index) => {
        const title = structuralTitleLabel(payment.title, language);
        const when = payment.daysLeft < 0
          ? copy.dueLate(Math.abs(payment.daysLeft))
          : payment.daysLeft === 0 ? copy.dueToday : copy.dueIn(payment.daysLeft);
        const detail = [categoryLabel(payment.category, language), shortDate(payment.dateISO, language), when].join(' · ');
        const amount = formatMoneyText(payment.amountFils, money);
        return (
          <View
            key={`${payment.title}-${payment.dateISO}-${index}`}
            accessible
            accessibilityLabel={`${title}, ${detail}, ${amount}`}
            style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.rule }]}>
            <MerchantAvatar title={payment.title} category={payment.category} size={32} />
            <View style={styles.rowText}>
              <ThemedText type="small" numberOfLines={1} style={{ color: palette.text }}>{title}</ThemedText>
              <ThemedText type="meta" numberOfLines={1} style={{ color: palette.textSecondary }}>{detail}</ThemedText>
            </View>
            <ThemedText type="smallBold" tabular style={{ color: palette.text }}>{amount}</ThemedText>
          </View>
        );
      })}
    </View>
  );
}

/** Exact monthly values stay visible at every text size, above equal-width tracks. */
export function AssistantMonthChart({ series, highlight, money, language, palette, largeText = false }: {
  series: AssistantMonthTotal[];
  /** The month the answer names. No bar is emphasised when it is absent. */
  highlight?: string;
  money: LedgerMoneySpec;
  language: 'en' | 'ar';
  palette: BandPalette;
  largeText?: boolean;
}) {
  const copy = assistantScreenCopy(language);
  const largest = series.reduce((max, month) => Math.max(max, month.totalFils), 0);
  if (series.length < 2 || largest <= 0) return null;
  return (
    <View testID="assistant-month-chart" accessibilityLabel={copy.monthlyChartLabel} style={styles.chart}>
      {series.map((month, index) => {
        const amount = formatMoneyText(month.totalFils, money);
        const label = monthLabel(month.month, language);
        const named = highlight !== undefined && month.month === highlight;
        return (
          <View key={month.month} style={styles.column} accessible accessibilityLabel={`${label} ${month.month.slice(0, 4)}, ${amount}`}>
            <View style={[styles.chartHeading, largeText && styles.chartHeadingStacked]}>
              <ThemedText type="meta" style={{ color: named ? palette.text : palette.textSecondary }}>{label} {month.month.slice(0, 4)}</ThemedText>
              <ThemedText type="meta" tabular maxFontSizeMultiplier={1.5} style={[styles.value, { color: palette.text }]}>{amount}</ThemedText>
            </View>
            <View style={styles.barTrack}>
              <GrowBar axis="width" size={Math.max(0, month.totalFils) / largest * 100} delay={index * 50}
                style={[styles.bar, { backgroundColor: named ? palette.tint : palette.rule }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + 2, paddingVertical: Spacing.two + 2 },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  chart: { gap: 14, paddingTop: Spacing.two },
  column: { gap: 6 },
  chartHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 },
  chartHeadingStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  value: { fontVariant: ['tabular-nums'], writingDirection: 'ltr', flexShrink: 1 },
  barTrack: { height: 8, width: '100%', borderRadius: 4 },
  bar: { height: 8, borderRadius: 4 },
});
